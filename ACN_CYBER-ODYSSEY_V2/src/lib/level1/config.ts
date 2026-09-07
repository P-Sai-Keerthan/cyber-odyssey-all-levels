/**
 * Level 1 challenge application configuration.
 *
 * The Level 1 target is a SEPARATE system from this portal. This portal owns
 * squad identity, the point catalogue, the official score and the leaderboard;
 * the Level 1 application hosts the investigation itself and decides whether an
 * answer was correct.
 *
 * The URL is read from the environment so it can be repointed per deployment —
 * the event-day host is not the rehearsal host, and a hardcoded address would
 * mean a redeploy to change it. There is no default: an unset value disables the
 * launch control rather than sending participants to somewhere that is probably
 * wrong. `LEVEL3_CHALLENGE_URL` carries a default for historical reasons; new
 * configuration does not repeat that.
 *
 * NOTE ON CREDENTIALS: no squad credential is ever appended to this URL. What
 * travels is a single-use ticket that expires in two minutes and cannot be
 * redeemed without the shared integration secret. See lib/level1/tickets.ts.
 */

/** Where a participant is sent to enter Level 1, or null when unconfigured. */
export function level1ChallengeUrl(): string | null {
  const value = process.env['LEVEL1_CHALLENGE_URL']?.trim();
  if (!value) return null;
  return value.replace(/\/+$/, '');
}

/**
 * The full entry URL for one ticket.
 *
 * The ticket rides in a query parameter because the destination is a plain
 * browser navigation to another origin — there is no way to send a header. That
 * is acceptable only because of what the ticket is: single-use, two-minute-lived,
 * and worthless without a server-to-server redemption signed with a secret the
 * browser does not hold. The Level 1 entry route strips it from the address bar
 * immediately after redeeming.
 */
export function level1EntryUrl(ticket: string): string | null {
  const base = level1ChallengeUrl();
  if (!base) return null;
  return `${base}/api/enter?ticket=${encodeURIComponent(ticket)}`;
}
