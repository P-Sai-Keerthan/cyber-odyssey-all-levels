import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@/lib/integration/hmac';
import { getLevelState } from '@/lib/event/level-state';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import { recomputeTeamScore, lockTeamRow } from '@/lib/evaluation/approval';
import { safeRevalidate } from '@/lib/utils/revalidate';

export const dynamic = 'force-dynamic';

/**
 * ORION → Cyber Odyssey: a verified Level 3 bug discovery.
 *
 * ===========================================================================
 * THE ONE RULE
 * ===========================================================================
 * ORION reports WHAT HAPPENED. Cyber Odyssey decides WHAT IT IS WORTH.
 *
 * The payload names a squad and a bug. It does not — and cannot — carry a point
 * value, a team id, or a score. Those are resolved here, from this database:
 *
 *   externalTeamRef -> Team.externalRef -> Team.id
 *   externalBugRef  -> Level3Bug.externalRef -> Level3Bug.id and .points
 *
 * A field named `points` in the request body is ignored. This matters because
 * ORION is an intentionally vulnerable application: if a participant ever
 * achieves code execution there, the blast radius must stop at "can claim a bug
 * they did not solve", not extend to "can set their own score".
 *
 * ===========================================================================
 * WHY EVERY REJECTION IS RECORDED
 * ===========================================================================
 * Accepted and rejected events both write an IntegrationEvent row. A silent
 * rejection is indistinguishable from a delivery that never arrived, which is
 * exactly the ambiguity you do not want at 3pm on event day when a squad says
 * their score is wrong.
 *
 * The one exception is a request that fails signature verification: it gets no
 * row, because an unauthenticated caller must not be able to fill the table (and
 * with it the unique nonce space) by spraying requests.
 */

interface DiscoveryPayload {
  eventId?: unknown;
  nonce?: unknown;
  eventType?: unknown;
  externalTeamRef?: unknown;
  externalBugRef?: unknown;
}

function reject(status: number, code: string, message: string) {
  return NextResponse.json({ accepted: false, code, message }, { status });
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  // Read the body as text. Parsing first would mean verifying a signature over
  // something other than what arrived.
  const rawBody = await request.text();

  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const verdict = verifySignature(rawBody, signature, timestamp);

  if (!verdict.ok) {
    if (verdict.reason === 'MISSING_SECRET') {
      // The bridge is not configured. Say so plainly in the log, not in the
      // response — a caller does not need to learn our deployment state.
      console.error('[integration] ODYSSEY_INTEGRATION_SECRET is not set; bridge disabled.');
      return reject(503, 'BRIDGE_DISABLED', 'Integration bridge is not configured.');
    }
    // Deliberately uniform for a bad signature and a stale timestamp: telling a
    // caller which half failed helps them work out whether they hold the secret.
    return reject(401, 'UNAUTHENTICATED', 'Request signature could not be verified.');
  }

  let payload: DiscoveryPayload;
  try {
    payload = JSON.parse(rawBody) as DiscoveryPayload;
  } catch {
    return reject(400, 'MALFORMED_BODY', 'Body is not valid JSON.');
  }

  const eventId = asString(payload.eventId);
  const nonce = asString(payload.nonce);
  const eventType = asString(payload.eventType) ?? 'BUG_DISCOVERED';
  const externalTeamRef = asString(payload.externalTeamRef);
  const externalBugRef = asString(payload.externalBugRef);

  if (!eventId || !nonce || !externalTeamRef || !externalBugRef) {
    return reject(
      400,
      'MISSING_FIELDS',
      'eventId, nonce, externalTeamRef and externalBugRef are all required.',
    );
  }
  if (eventType !== 'BUG_DISCOVERED') {
    return reject(400, 'UNSUPPORTED_EVENT', 'Unsupported event type.');
  }

  /** Records the attempt and returns the response. */
  async function record(outcome: string, response: NextResponse) {
    await prisma.integrationEvent
      .create({
        data: {
          eventId: eventId!,
          nonce: nonce!,
          eventType,
          source: 'ORION',
          externalTeamRef: externalTeamRef!,
          externalBugRef,
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
    select: { eventId: true, nonce: true, outcome: true },
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

  // -- Level 3 must be open ---------------------------------------------------
  const levelState = await getLevelState(3);
  if (!levelState || levelState.status !== 'LIVE' || levelState.isExpired) {
    return record(
      `REJECTED_LEVEL_${levelState?.status ?? 'UNKNOWN'}`,
      reject(409, 'LEVEL_NOT_LIVE', 'Level 3 is not currently accepting discoveries.'),
    );
  }

  // -- Resolve squad and bug from OUR records ---------------------------------
  const [team, bug] = await Promise.all([
    prisma.team.findUnique({
      where: { externalRef: externalTeamRef },
      select: { id: true, name: true, status: true },
    }),
    prisma.level3Bug.findUnique({
      where: { externalRef: externalBugRef },
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
  if (!bug) {
    return record(
      'REJECTED_UNKNOWN_BUG',
      reject(404, 'UNKNOWN_BUG', 'No bug matches that reference.'),
    );
  }
  if (!bug.isActive) {
    return record('REJECTED_BUG_INACTIVE', reject(409, 'BUG_INACTIVE', 'That bug is retired.'));
  }

  // -- Award ------------------------------------------------------------------
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // FIRST statement, before anything touches the Team row.
      //
      // WHY THE ORDER MATTERS: inserting a Level3Discovery takes an implicit FK
      // lock (FOR KEY SHARE) on the referenced Team row. `recomputeTeamScore`
      // then wants that row EXCLUSIVELY. Taking the shared lock first and
      // upgrading it later is a textbook deadlock: two concurrent discoveries
      // for the same squad each hold the share lock and each wait for the
      // other's to clear, and PostgreSQL kills one with 40P01. Measured on the
      // Level 1 bridge, which had exactly this shape: 64 of 300 concurrent
      // callbacks returned 500 and 38 squads finished with a wrong total.
      //
      // Acquiring the exclusive lock up front removes the upgrade entirely — the
      // second delivery simply waits at the door.
      await lockTeamRow(tx, team.id);

      // INSERT ... ON CONFLICT DO NOTHING, not create-and-catch.
      //
      // The squad may already hold this bug — ORION legitimately re-reports, and
      // the unique index is what makes the second report worth nothing. On
      // PostgreSQL that duplicate must not RAISE: a raised statement aborts the
      // whole transaction, and the aggregate below would then fail with
      // `current transaction is aborted`, turning an idempotent re-delivery into
      // a 500 that ORION would retry forever. Same defect and same fix as the
      // Level 1 score bridge.
      const inserted = await tx.level3Discovery.createMany({
        data: [
          {
            teamId: team.id,
            bugId: bug.id,
            // No submitting user: this discovery was established by ORION, not by
            // a participant action inside this portal. The squad is the actor.
            discoveredById: null,
            // From OUR bug record. Any `points` in the request body is ignored.
            awardedPoints: bug.points,
          },
        ],
        skipDuplicates: true,
      });
      const created = inserted.count === 1;

      const aggregate = await tx.level3Discovery.aggregate({
        where: { teamId: team.id },
        _sum: { awardedPoints: true },
        _count: { _all: true },
      });

      // Same reason as the Level 1 bridge: `Team.score` is the stored official
      // total behind the participant dashboard and the rank widget, so a
      // verified discovery has to update it in the transaction that recorded it.
      await recomputeTeamScore(tx, team.id);

      return {
        fresh: created,
        automaticScore: aggregate._sum.awardedPoints ?? 0,
        verifiedBugCount: aggregate._count._all,
      };
    }, CRITICAL_WRITE_TX);

    await prisma.auditLog
      .create({
        data: {
          action: outcome.fresh ? 'LEVEL3_DISCOVERY_INGESTED' : 'LEVEL3_DISCOVERY_DUPLICATE',
          details:
            `ORION reported bug ${bug.code} for squad "${team.name}" ` +
            (outcome.fresh
              ? `(+${bug.points} pts, event ${eventId}).`
              : `— already credited, no points awarded (event ${eventId}).`),
        },
      })
      .catch(() => {});

    safeRevalidate('/event/level-3', '/leaderboard', '/dashboard');

    return record(
      outcome.fresh ? 'ACCEPTED' : 'DUPLICATE_DISCOVERY',
      NextResponse.json(
        {
          accepted: true,
          duplicate: !outcome.fresh,
          bugCode: bug.code,
          // Echoed so ORION can reconcile, never accepted as input.
          awardedPoints: outcome.fresh ? bug.points : 0,
          automaticScore: outcome.automaticScore,
          verifiedBugCount: outcome.verifiedBugCount,
        },
        { status: 200 },
      ),
    );
  } catch (err) {
    console.error('[integration] discovery ingest failed:', err);
    return record(
      'REJECTED_INTERNAL_ERROR',
      reject(500, 'INTERNAL_ERROR', 'Could not record the discovery.'),
    );
  }
}
