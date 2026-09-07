import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';

/**
 * One-time access tickets for the external challenge applications.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * A participant authenticated in this portal clicks "Enter Level 1" and lands in
 * a different application on a different origin. That application has to learn
 * WHICH squad just arrived, and it must not be able to be told by the browser —
 * a squad reference in a query string is a squad reference an attacker can edit.
 *
 * It also must not learn a credential. Squad passwords are stored as scrypt
 * hashes and this portal deliberately has no capability to reveal a plaintext one
 * (see lib/auth/temporary-credential.ts), so there is nothing to forward even if
 * forwarding were acceptable.
 *
 * A ticket resolves both. The browser carries an opaque value that identifies
 * nothing by itself; the receiving application exchanges it, server to server
 * over an HMAC-signed request, for the squad's identity.
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY A HASH IS STORED
 * ---------------------------------------------------------------------------
 * The ticket travels in a URL, so it will end up in a browser history and
 * possibly a proxy log. Storing it verbatim would mean a database read yields
 * redeemable tickets. The row holds SHA-256 of the value; redemption hashes what
 * was presented and looks that up.
 *
 * A plain SHA-256 is right here where it would be wrong for a password: the input
 * is 256 bits of CSPRNG output, not a human-chosen secret, so there is no
 * dictionary to run and no salt or work factor to add. The property needed is
 * pre-image resistance, which SHA-256 has.
 *
 * ---------------------------------------------------------------------------
 * WHY REDEMPTION IS AN ATOMIC UPDATE
 * ---------------------------------------------------------------------------
 * "Read the ticket, check it is unspent, mark it spent" is three steps, and two
 * concurrent redemptions both pass step two. `updateMany` with
 * `redeemedAt: null` in the WHERE clause makes the check and the write one
 * statement: the database reports how many rows it changed, and exactly one
 * caller can see 1. That is the whole single-use guarantee, and it is a database
 * guarantee rather than an application one for the same reason every other
 * uniqueness rule in this schema is.
 */

/** Bytes of entropy in a ticket. 256 bits — unguessable within its lifetime. */
const TICKET_BYTES = 32;

/**
 * How long a ticket stays redeemable.
 *
 * Two minutes covers a browser redirect and a server-to-server round trip with
 * room for a slow network, and nothing else. It is deliberately far shorter than
 * a session: the ticket's whole job is to survive one hop. A longer window buys
 * no usability and widens the race an observer of the URL could try to win.
 */
export const TICKET_TTL_MS = 2 * 60 * 1000;

export type TicketRejection =
  'TICKET_MALFORMED' | 'TICKET_UNKNOWN' | 'TICKET_SPENT' | 'TICKET_EXPIRED' | 'TICKET_WRONG_LEVEL';

export interface RedeemedTicket {
  teamId: string;
  level: number;
  issuedToUserId: string | null;
}

export type RedeemResult =
  { ok: true; ticket: RedeemedTicket } | { ok: false; reason: TicketRejection };

/** SHA-256 hex of a ticket value. The only form that reaches the database. */
export function hashTicket(ticket: string): string {
  return createHash('sha256').update(ticket, 'utf8').digest('hex');
}

/** Hex, so the value survives a URL, a log line and a shell argument unescaped. */
function generateTicketValue(): string {
  return randomBytes(TICKET_BYTES).toString('hex');
}

/**
 * Issues a ticket for one squad and one level.
 *
 * Returns the plaintext ticket exactly once, to the caller that will put it in a
 * redirect. It is never returned again, never logged, and never persisted — only
 * its hash is.
 *
 * Any unredeemed ticket the squad already holds for this level is expired first.
 * A participant who clicks twice should not leave a live ticket behind in the
 * first tab's URL; the newest click is the one that counts.
 */
export async function issueTicket(params: {
  teamId: string;
  level: number;
  issuedToUserId?: string | null;
  now?: Date;
}): Promise<{ ticket: string; expiresAt: Date }> {
  const now = params.now ?? new Date();
  const ticket = generateTicketValue();
  const expiresAt = new Date(now.getTime() + TICKET_TTL_MS);

  await prisma.integrationTicket.updateMany({
    where: { teamId: params.teamId, level: params.level, redeemedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });

  await prisma.integrationTicket.create({
    data: {
      tokenHash: hashTicket(ticket),
      teamId: params.teamId,
      level: params.level,
      issuedToUserId: params.issuedToUserId ?? null,
      expiresAt,
    },
  });

  return { ticket, expiresAt };
}

/**
 * Redeems a ticket, once.
 *
 * The order of the checks matters. The atomic claim runs FIRST, against the
 * unspent-and-unexpired predicate, so the winner is decided by the database
 * before any interpretation happens. Only when the claim fails does this read the
 * row back to explain why — and that read is safe precisely because the claim
 * already failed, so nothing it learns can be turned into a second redemption.
 */
export async function redeemTicket(
  ticketValue: string,
  expectedLevel: number,
  now: Date = new Date(),
): Promise<RedeemResult> {
  const trimmed = ticketValue?.trim();
  if (!trimmed || !/^[0-9a-f]{64}$/.test(trimmed)) {
    return { ok: false, reason: 'TICKET_MALFORMED' };
  }

  const tokenHash = hashTicket(trimmed);

  const claimed = await prisma.integrationTicket.updateMany({
    where: {
      tokenHash,
      level: expectedLevel,
      redeemedAt: null,
      expiresAt: { gt: now },
    },
    data: { redeemedAt: now },
  });

  if (claimed.count === 1) {
    const row = await prisma.integrationTicket.findUnique({
      where: { tokenHash },
      select: { teamId: true, level: true, issuedToUserId: true },
    });
    // Deleted between the claim and this read — vanishingly unlikely, and the
    // honest answer is that the ticket is no longer usable rather than a crash.
    if (!row) return { ok: false, reason: 'TICKET_UNKNOWN' };
    return { ok: true, ticket: row };
  }

  // The claim failed. Work out which of the four reasons applies, for a useful
  // error and an accurate audit record.
  const existing = await prisma.integrationTicket.findUnique({
    where: { tokenHash },
    select: { level: true, redeemedAt: true, expiresAt: true },
  });

  if (!existing) return { ok: false, reason: 'TICKET_UNKNOWN' };
  if (existing.level !== expectedLevel) return { ok: false, reason: 'TICKET_WRONG_LEVEL' };
  if (existing.redeemedAt) return { ok: false, reason: 'TICKET_SPENT' };
  return { ok: false, reason: 'TICKET_EXPIRED' };
}

/**
 * Removes tickets that expired more than an hour ago.
 *
 * Redeemed tickets are kept for that hour so a duplicate redemption still reports
 * TICKET_SPENT rather than the less useful TICKET_UNKNOWN — the difference
 * between "you already used this" and "that never existed" is exactly what an
 * operator needs when a participant says the link did not work.
 */
export async function reapExpiredTickets(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
  const { count } = await prisma.integrationTicket.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}
