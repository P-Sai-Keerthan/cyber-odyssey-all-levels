'use server';

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import { issueTicket } from '@/lib/level1/tickets';
import { level1ChallengeUrl, level1EntryUrl } from '@/lib/level1/config';
import type { ActionResult } from './auth-actions';

/**
 * How long to wait for Level 1 to prove it is alive before giving up on it.
 *
 * Short on purpose: this runs on the click path, so it is latency the
 * participant feels. Two seconds is far longer than a healthy loopback or
 * same-network response and short enough not to read as a hang.
 */
const REACHABILITY_TIMEOUT_MS = 2_000;

/**
 * Is the Level 1 application answering at all?
 *
 * ANY HTTP response counts as reachable — including 404 or 500. The question is
 * whether something is listening and speaking HTTP, not whether that particular
 * path is happy. Treating a 404 as "down" would make this fail whenever Level 1
 * changed its routes, which is exactly the kind of brittle check that gets
 * deleted six months later.
 *
 * Only a transport-level failure (connection refused, DNS failure, timeout)
 * counts as down.
 */
async function isLevel1Reachable(): Promise<boolean> {
  const base = level1ChallengeUrl();
  if (!base) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);

  try {
    await fetch(base, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server Action: mint a one-time Level 1 access ticket and return where to go.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS AN ACTION AND NOT A LINK
 * ---------------------------------------------------------------------------
 * The obvious implementation is an anchor with the ticket already in its href.
 * That would mean minting a ticket on every page render — including renders
 * nobody acts on — so a squad's Level 1 workspace page would leave a trail of
 * live tickets in the address bar and the page source, each one a two-minute
 * window somebody else could try to win.
 *
 * A ticket is minted only when a participant actually asks to enter, and any
 * earlier unredeemed ticket for that squad is expired at the same moment (see
 * `issueTicket`). One live ticket per squad, created on a real click.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT SUPPLIES
 * ---------------------------------------------------------------------------
 * Nothing. There is no parameter. The squad is read from the server session, so
 * a participant cannot request entry as another squad by editing a form field —
 * which is the whole reason team identity never travels from the browser.
 */
export async function startLevel1SessionAction(): Promise<
  ActionResult<{ entryUrl: string; expiresAt: string }>
> {
  const user = await getSessionUser();
  if (!user) {
    return { success: false, error: 'Your session has expired. Please sign in again.' };
  }

  if (user.role !== 'PARTICIPANT') {
    return { success: false, error: 'Only event participants can enter competition levels.' };
  }

  if (!user.membership) {
    return {
      success: false,
      error: 'You must belong to a squad before entering Level 1. Create or join one first.',
    };
  }

  const team = user.membership.team;

  if (team.status !== 'ACTIVE') {
    return {
      success: false,
      error:
        'Your squad is not active, so it cannot enter Level 1. Please contact an event marshal.',
    };
  }

  // Authoritative gate. The same LevelState the ingest endpoint checks, so a
  // participant cannot be admitted to a level that will then refuse their score.
  const access = await checkAuthoritativeLevelAccess(1, true);
  if (!access.allowed) {
    return {
      success: false,
      error: access.reason ?? 'Level 1 is not currently open.',
    };
  }

  if (!level1ChallengeUrl()) {
    // Unconfigured is an operations problem, not a participant one. Say something
    // true and actionable rather than sending them to a broken address.
    console.error('[level1] LEVEL1_CHALLENGE_URL is not set; entry is unavailable.');
    return {
      success: false,
      error:
        'The Level 1 application address has not been configured yet. ' +
        'Please tell an event marshal — this is a setup issue, not a problem with your squad.',
    };
  }

  // Is Level 1 actually answering?
  //
  // Without this, a stopped or unreachable Level 1 means the browser navigates
  // away and lands on its own "This site can't be reached" page: the participant
  // is off the portal entirely, with no message that means anything to them and
  // no way back except the back button. Checking first keeps them here and lets
  // us say something true.
  //
  // It also avoids burning a single-use ticket on a destination that cannot
  // redeem it.
  const reachable = await isLevel1Reachable();
  if (!reachable) {
    console.error('[level1] challenge application is not reachable at', level1ChallengeUrl());
    return {
      success: false,
      error:
        'The Level 1 application is not responding right now, so entry has not been started. ' +
        'Your squad has done nothing wrong — tell an event marshal, then try again.',
    };
  }

  try {
    const { ticket, expiresAt } = await issueTicket({
      teamId: team.id,
      level: 1,
      issuedToUserId: user.id,
    });

    const entryUrl = level1EntryUrl(ticket);
    if (!entryUrl) {
      return { success: false, error: 'The Level 1 application address is not configured.' };
    }

    await prisma.auditLog
      .create({
        data: {
          actorId: user.id,
          action: 'LEVEL1_TICKET_ISSUED',
          // The ticket value is never written down — only that one was issued.
          details: `Participant @${user.username} requested Level 1 entry for squad "${team.name}".`,
        },
      })
      .catch(() => {});

    return {
      success: true,
      data: { entryUrl, expiresAt: expiresAt.toISOString() },
    };
  } catch (err) {
    console.error('[level1] ticket issue failed:', err);
    return {
      success: false,
      error: 'Could not open Level 1 because of a server error. Please try again.',
    };
  }
}
