import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyLevel1Signature,
  LEVEL1_SIGNATURE_HEADER,
  LEVEL1_TIMESTAMP_HEADER,
} from '@/lib/integration/hmac';
import { getLevelState } from '@/lib/event/level-state';
import { redeemTicket } from '@/lib/level1/tickets';

export const dynamic = 'force-dynamic';

/**
 * Level 1 → Cyber Odyssey: redeem a one-time access ticket for squad identity.
 *
 * ===========================================================================
 * WHAT THE CALLER LEARNS AND WHAT IT DOES NOT
 * ===========================================================================
 * On success this returns the squad's EXTERNAL reference, its display name, and
 * the current Level 1 state. It does not return the internal team id, the private
 * join code, the squad password hash, any member's email, or anything else the
 * Level 1 application has no use for. Level 1 is a system participants attack;
 * every field returned here is a field that leaks when it is compromised.
 *
 * ===========================================================================
 * TWO INDEPENDENT THINGS MUST BE TRUE
 * ===========================================================================
 *   1. The REQUEST is authentic — a valid HMAC over the raw body proves the
 *      caller holds the shared secret, i.e. it is the Level 1 server and not a
 *      browser. Without this, anyone who saw a ticket in a URL could redeem it.
 *   2. The TICKET is valid — unspent, unexpired, and issued for Level 1.
 *
 * Neither substitutes for the other. A correctly-signed request bearing a spent
 * ticket is refused; a valid ticket presented without a signature is refused.
 *
 * ===========================================================================
 * WHY SIGNATURE FAILURES LEAVE NO ROW
 * ===========================================================================
 * Every other rejection is recorded. A signature failure is not — an
 * unauthenticated caller must not be able to fill the audit table, or the unique
 * nonce space, by spraying requests. This matches the ORION bridge exactly.
 */

interface SessionPayload {
  requestId?: unknown;
  nonce?: unknown;
  ticket?: unknown;
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

  const verdict = verifyLevel1Signature(
    rawBody,
    request.headers.get(LEVEL1_SIGNATURE_HEADER),
    request.headers.get(LEVEL1_TIMESTAMP_HEADER),
  );

  if (!verdict.ok) {
    if (verdict.reason === 'MISSING_SECRET') {
      // The bridge is not configured. Say so in the log, not in the response — a
      // caller does not need to learn our deployment state.
      console.error('[integration:level1] ODYSSEY_LEVEL1_SECRET is not set; bridge disabled.');
      return reject(503, 'BRIDGE_DISABLED', 'Level 1 integration bridge is not configured.');
    }
    // Deliberately uniform for a bad signature and a stale timestamp: telling a
    // caller which half failed helps them work out whether they hold the secret.
    return reject(401, 'UNAUTHENTICATED', 'Request signature could not be verified.');
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(rawBody) as SessionPayload;
  } catch {
    return reject(400, 'MALFORMED_BODY', 'Body is not valid JSON.');
  }

  const requestId = asString(payload.requestId);
  const nonce = asString(payload.nonce);
  const ticket = asString(payload.ticket);

  if (!requestId || !nonce || !ticket) {
    return reject(400, 'MISSING_FIELDS', 'requestId, nonce and ticket are all required.');
  }

  /**
   * Records the attempt and returns the response.
   *
   * A redemption is an event worth auditing on its own — "which squad entered
   * Level 1, when, and did it work" is the first question asked when a
   * participant says they could not get in. `externalTeamRef` is the ticket
   * value's hash prefix rather than a squad reference, because at rejection time
   * there may be no squad to name.
   */
  async function record(outcome: string, teamRefOrTicketTag: string, response: NextResponse) {
    await prisma.integrationEvent
      .create({
        data: {
          eventId: requestId!,
          nonce: nonce!,
          eventType: 'LEVEL1_SESSION_REDEEM',
          source: 'LEVEL1',
          externalTeamRef: teamRefOrTicketTag,
          externalBugRef: null,
          outcome,
        },
      })
      .catch(() => {
        // A collision means a concurrent request already claimed this requestId
        // or nonce. The replay branch below has already decided the outcome.
      });
    return response;
  }

  // -- Replay and idempotency -------------------------------------------------
  // Checked before the ticket is touched so a replayed request cannot consume a
  // ticket that the original request already legitimately consumed.
  const seen = await prisma.integrationEvent.findFirst({
    where: { OR: [{ eventId: requestId }, { nonce }] },
    select: { eventId: true, nonce: true },
  });

  if (seen) {
    // Unlike a score event, a session redemption is NOT idempotently replayable.
    // Returning the squad's identity again for a repeated requestId would turn a
    // captured request into a reusable identity oracle, which is exactly what the
    // single-use ticket exists to prevent. Both cases are refused.
    return reject(409, 'REQUEST_REPLAYED', 'This request has already been seen.');
  }

  // -- The ticket -------------------------------------------------------------
  const redemption = await redeemTicket(ticket, 1);

  if (!redemption.ok) {
    // Tag the audit row by ticket hash prefix — there is no squad to name yet,
    // and the raw ticket must never be written down.
    const tag = `ticket:${ticket.slice(0, 8)}`;
    const status = redemption.reason === 'TICKET_EXPIRED' ? 410 : 409;
    return record(
      `REJECTED_${redemption.reason}`,
      tag,
      reject(status, redemption.reason, 'That access ticket is not usable.'),
    );
  }

  // -- Resolve the squad from OUR records -------------------------------------
  const team = await prisma.team.findUnique({
    where: { id: redemption.ticket.teamId },
    select: { externalRef: true, name: true, status: true, _count: { select: { members: true } } },
  });

  if (!team) {
    return record(
      'REJECTED_UNKNOWN_TEAM',
      `team:${redemption.ticket.teamId}`,
      reject(404, 'UNKNOWN_TEAM', 'The squad on this ticket no longer exists.'),
    );
  }

  if (!team.externalRef) {
    // A squad without an external reference cannot be addressed by the bridge, so
    // its results could never be attributed back. Refuse rather than admit it and
    // silently drop its score later.
    console.error('[integration:level1] squad has no externalRef; run the backfill.');
    return record(
      'REJECTED_TEAM_NO_EXTERNAL_REF',
      `team:${redemption.ticket.teamId}`,
      reject(409, 'TEAM_NOT_PROVISIONED', 'That squad is not provisioned for external levels.'),
    );
  }

  if (team.status !== 'ACTIVE') {
    return record(
      'REJECTED_TEAM_INACTIVE',
      team.externalRef,
      reject(409, 'TEAM_INACTIVE', 'That squad is not active.'),
    );
  }

  // -- Level 1 must be open ---------------------------------------------------
  const levelState = await getLevelState(1);
  const levelIsLive = Boolean(levelState && levelState.status === 'LIVE' && !levelState.isExpired);

  if (!levelIsLive) {
    return record(
      `REJECTED_LEVEL_${levelState?.status ?? 'UNKNOWN'}`,
      team.externalRef,
      reject(409, 'LEVEL_NOT_LIVE', 'Level 1 is not currently open.'),
    );
  }

  await prisma.auditLog
    .create({
      data: {
        actorId: redemption.ticket.issuedToUserId,
        action: 'LEVEL1_SESSION_GRANTED',
        details: `Squad "${team.name}" entered Level 1 (request ${requestId}).`,
      },
    })
    .catch(() => {});

  return record(
    'ACCEPTED',
    team.externalRef,
    NextResponse.json(
      {
        accepted: true,
        externalTeamRef: team.externalRef,
        teamName: team.name,
        memberCount: team._count.members,
        level: {
          number: 1,
          status: levelState?.status ?? 'UNKNOWN',
          endsAt: levelState?.endsAt ?? null,
        },
      },
      { status: 200 },
    ),
  );
}
