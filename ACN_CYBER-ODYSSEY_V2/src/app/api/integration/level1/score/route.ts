import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyLevel1Signature,
  LEVEL1_SIGNATURE_HEADER,
  LEVEL1_TIMESTAMP_HEADER,
} from '@/lib/integration/hmac';
import { getLevelState } from '@/lib/event/level-state';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import { lockTeamRow, recomputeTeamScore } from '@/lib/evaluation/approval';
import { safeRevalidate } from '@/lib/utils/revalidate';
import {
  isLevel1EventType,
  isValidLevel1HintNumber,
  level1HintPenaltyFor,
  combineLevel1Score,
} from '@/lib/level1/scoring-policy';

export const dynamic = 'force-dynamic';

/**
 * Level 1 → Cyber Odyssey: a verified challenge result.
 *
 * ===========================================================================
 * THE ONE RULE
 * ===========================================================================
 * LEVEL 1 REPORTS WHAT HAPPENED. CYBER ODYSSEY DECIDES WHAT IT IS WORTH.
 *
 * The payload names a squad and a question. It does not — and cannot — carry a
 * point value, a team id, or a score. Those are resolved here, from this
 * database:
 *
 *   externalTeamRef      -> Team.externalRef      -> Team.id
 *   externalChallengeRef -> Level1Challenge.externalRef -> .id and .points
 *   hintNumber           -> LEVEL1_HINT_PENALTIES  (portal policy, not payload)
 *
 * A field named `points`, `score` or `awardedPoints` in the request body is
 * ignored. This matters because Level 1 is an intentionally vulnerable
 * application: if a participant ever achieves code execution there, the blast
 * radius must stop at "can claim a question they did not solve", not extend to
 * "can set their own score".
 *
 * ===========================================================================
 * WHY EVERY REJECTION IS RECORDED
 * ===========================================================================
 * Accepted and rejected events both write an IntegrationEvent row. A silent
 * rejection is indistinguishable from a delivery that never arrived, which is
 * exactly the ambiguity you do not want when a squad says their score is wrong.
 *
 * The one exception is a request that fails signature verification: it gets no
 * row, because an unauthenticated caller must not be able to fill the table (and
 * with it the unique nonce space) by spraying requests.
 *
 * ===========================================================================
 * IDEMPOTENCY VS REPLAY
 * ===========================================================================
 * `eventId` and `nonce` answer different questions. eventId asks "is this the
 * same event?" — a delivery retried after a timeout legitimately reuses it, and
 * is absorbed as an idempotent success. nonce asks "is this the same REQUEST?" —
 * nothing legitimately reuses one, so a repeat is a replayed HTTP request and is
 * refused outright. Both are unique-indexed, because two copies delivered
 * concurrently both pass any read-then-write check and only an index can
 * arbitrate.
 */

interface ScorePayload {
  eventId?: unknown;
  nonce?: unknown;
  eventType?: unknown;
  externalTeamRef?: unknown;
  externalChallengeRef?: unknown;
  hintNumber?: unknown;
  solvedAt?: unknown;
}

function reject(status: number, code: string, message: string) {
  return NextResponse.json({ accepted: false, code, message }, { status });
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Parses an ISO timestamp the sender supplied. Advisory only — never trusted for authorisation. */
function asDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  const verdict = verifyLevel1Signature(
    rawBody,
    request.headers.get(LEVEL1_SIGNATURE_HEADER),
    request.headers.get(LEVEL1_TIMESTAMP_HEADER),
  );

  if (!verdict.ok) {
    if (verdict.reason === 'MISSING_SECRET') {
      console.error('[integration:level1] ODYSSEY_LEVEL1_SECRET is not set; bridge disabled.');
      return reject(503, 'BRIDGE_DISABLED', 'Level 1 integration bridge is not configured.');
    }
    return reject(401, 'UNAUTHENTICATED', 'Request signature could not be verified.');
  }

  let payload: ScorePayload;
  try {
    payload = JSON.parse(rawBody) as ScorePayload;
  } catch {
    return reject(400, 'MALFORMED_BODY', 'Body is not valid JSON.');
  }

  const eventId = asString(payload.eventId);
  const nonce = asString(payload.nonce);
  const eventType = asString(payload.eventType);
  const externalTeamRef = asString(payload.externalTeamRef);
  const externalChallengeRef = asString(payload.externalChallengeRef);
  const solvedAt = asDate(payload.solvedAt);

  if (!eventId || !nonce || !eventType || !externalTeamRef || !externalChallengeRef) {
    return reject(
      400,
      'MISSING_FIELDS',
      'eventId, nonce, eventType, externalTeamRef and externalChallengeRef are all required.',
    );
  }

  if (!isLevel1EventType(eventType)) {
    return reject(400, 'UNSUPPORTED_EVENT', 'Unsupported event type.');
  }

  const isHint = eventType === 'LEVEL1_HINT_UNLOCKED';
  const hintNumber = isHint ? Number(payload.hintNumber ?? 1) : 0;

  if (isHint && !isValidLevel1HintNumber(hintNumber)) {
    return reject(400, 'INVALID_HINT_NUMBER', 'hintNumber is not a recognised hint tier.');
  }

  /** Records the attempt and returns the response. */
  async function record(outcome: string, response: NextResponse) {
    await prisma.integrationEvent
      .create({
        data: {
          eventId: eventId!,
          nonce: nonce!,
          eventType: eventType!,
          source: 'LEVEL1',
          externalTeamRef: externalTeamRef!,
          externalBugRef: externalChallengeRef,
          outcome,
        },
      })
      .catch(() => {
        // A collision here means a concurrent request already claimed this
        // eventId or nonce — the duplicate path below has already handled the
        // outcome, so there is nothing to add.
      });
    return response;
  }

  // -- Replay and idempotency -------------------------------------------------
  // Checked before any resolution work so a replayed event costs nothing.
  const seen = await prisma.integrationEvent.findFirst({
    where: { OR: [{ eventId }, { nonce }] },
    select: { eventId: true, nonce: true },
  });

  if (seen) {
    if (seen.nonce === nonce && seen.eventId !== eventId) {
      // A reused nonce under a different event id is a replayed HTTP request,
      // not a retry. Never absorbed as success.
      return reject(409, 'NONCE_REUSED', 'This request has already been seen.');
    }
    // Same eventId: a redelivery. Idempotent success — the first delivery already
    // did whatever this event was going to do.
    return NextResponse.json(
      { accepted: true, duplicate: true, message: 'Event already processed.' },
      { status: 200 },
    );
  }

  // -- Level 1 must be open ---------------------------------------------------
  const levelState = await getLevelState(1);
  if (!levelState || levelState.status !== 'LIVE' || levelState.isExpired) {
    return record(
      `REJECTED_LEVEL_${levelState?.status ?? 'UNKNOWN'}`,
      reject(409, 'LEVEL_NOT_LIVE', 'Level 1 is not currently accepting results.'),
    );
  }

  // -- Resolve squad and challenge from OUR records ---------------------------
  const [team, challenge] = await Promise.all([
    prisma.team.findUnique({
      where: { externalRef: externalTeamRef },
      select: { id: true, name: true, status: true },
    }),
    prisma.level1Challenge.findUnique({
      where: { externalRef: externalChallengeRef },
      select: { id: true, code: true, points: true, isActive: true },
    }),
  ]);

  if (!team) {
    return record(
      'REJECTED_UNKNOWN_TEAM',
      reject(404, 'UNKNOWN_TEAM', 'No squad matches that reference.'),
    );
  }
  if (team.status !== 'ACTIVE') {
    return record(
      'REJECTED_TEAM_INACTIVE',
      reject(409, 'TEAM_INACTIVE', 'That squad is not active.'),
    );
  }
  if (!challenge) {
    return record(
      'REJECTED_UNKNOWN_CHALLENGE',
      reject(404, 'UNKNOWN_CHALLENGE', 'No challenge matches that reference.'),
    );
  }
  if (!challenge.isActive) {
    return record(
      'REJECTED_CHALLENGE_INACTIVE',
      reject(409, 'CHALLENGE_INACTIVE', 'That challenge is retired.'),
    );
  }

  // -- Award or charge --------------------------------------------------------
  // The point value comes from OUR catalogue for an award and from OUR policy for
  // a deduction. Nothing in the request body influences either.
  const awardPoints = challenge.points;
  const penaltyPoints = level1HintPenaltyFor(hintNumber);

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // FIRST statement in the transaction, before anything touches the Team row.
      //
      // The insert below takes an implicit FK share lock on this squad's Team
      // row; the recompute at the end needs it exclusively. Asking for the
      // exclusive lock afterwards is a lock UPGRADE, and two concurrent
      // deliveries for the same squad deadlock on it — 64 of 300 concurrent
      // callbacks failed exactly that way under load. Taking it up front means
      // the second delivery waits here instead.
      await lockTeamRow(tx, team.id);

      let fresh: boolean;

      // INSERT ... ON CONFLICT DO NOTHING, not create-and-catch.
      //
      // This used to `create()` and swallow P2002 to mean "already awarded".
      // That works on SQLite and is BROKEN on PostgreSQL: a statement error
      // inside a transaction aborts the whole transaction, and every later
      // statement fails with `current transaction is aborted, commands ignored
      // until end of transaction block`. So catching the duplicate did not
      // rescue anything — the aggregate two lines below failed instead, and the
      // bridge answered 500 to a delivery it should have absorbed as an
      // idempotent success. The Portal would then keep the score while Level 1
      // saw a failure and retried forever.
      //
      // `createMany({ skipDuplicates: true })` compiles to ON CONFLICT DO
      // NOTHING: no error is raised, the transaction stays healthy, and `count`
      // says whether this delivery was the first. The unique index is still what
      // guarantees single-award — this only changes how the collision is
      // reported, never whether it is caught.
      if (isHint) {
        const inserted = await tx.level1Penalty.createMany({
          data: [
            {
              teamId: team.id,
              challengeId: challenge.id,
              hintNumber,
              points: penaltyPoints,
            },
          ],
          skipDuplicates: true,
        });
        fresh = inserted.count === 1;
      } else {
        const inserted = await tx.level1Result.createMany({
          data: [
            {
              teamId: team.id,
              challengeId: challenge.id,
              // From OUR challenge record. Any `points` in the body is ignored.
              awardedPoints: awardPoints,
              solvedAt,
            },
          ],
          skipDuplicates: true,
        });
        fresh = inserted.count === 1;
      }

      const [results, penalties] = await Promise.all([
        tx.level1Result.aggregate({
          where: { teamId: team.id },
          _sum: { awardedPoints: true },
          _count: { _all: true },
        }),
        tx.level1Penalty.aggregate({
          where: { teamId: team.id },
          _sum: { points: true },
        }),
      ]);

      // Keep the squad's STORED total in step, in the same transaction that
      // recorded the award. `Team.score` is what the participant dashboard
      // prints and what its rank widget counts against; without this the squad
      // solved a Level 1 question and watched their own dashboard stay at zero
      // while the leaderboard moved.
      await recomputeTeamScore(tx, team.id);

      return {
        fresh,
        solvedCount: results._count._all,
        level1Score: combineLevel1Score(
          results._sum.awardedPoints ?? 0,
          penalties._sum.points ?? 0,
        ),
      };
    }, CRITICAL_WRITE_TX);

    await prisma.auditLog
      .create({
        data: {
          action: outcome.fresh
            ? isHint
              ? 'LEVEL1_HINT_CHARGED'
              : 'LEVEL1_RESULT_INGESTED'
            : 'LEVEL1_EVENT_DUPLICATE',
          details:
            `Level 1 reported ${challenge.code} for squad "${team.name}" ` +
            (outcome.fresh
              ? isHint
                ? `(-${penaltyPoints} pts, hint ${hintNumber}, event ${eventId}).`
                : `(+${awardPoints} pts, event ${eventId}).`
              : `— already recorded, no change (event ${eventId}).`),
        },
      })
      .catch(() => {});

    safeRevalidate('/event/level-1', '/leaderboard', '/dashboard');

    return record(
      outcome.fresh ? 'ACCEPTED' : isHint ? 'DUPLICATE_HINT' : 'DUPLICATE_RESULT',
      NextResponse.json(
        {
          accepted: true,
          duplicate: !outcome.fresh,
          challengeCode: challenge.code,
          // Echoed so Level 1 can reconcile, never accepted as input.
          awardedPoints: outcome.fresh && !isHint ? awardPoints : 0,
          penaltyPoints: outcome.fresh && isHint ? penaltyPoints : 0,
          level1Score: outcome.level1Score,
          solvedCount: outcome.solvedCount,
        },
        { status: 200 },
      ),
    );
  } catch (err) {
    console.error('[integration:level1] score ingest failed:', err);
    return record(
      'REJECTED_INTERNAL_ERROR',
      reject(500, 'INTERNAL_ERROR', 'Could not record the result.'),
    );
  }
}
