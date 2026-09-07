/**
 * Level 3 challenge configuration.
 *
 * The Level 3 target application is a SEPARATE system from this portal. This
 * portal owns identity, scoring and the leaderboard; the challenge site hosts
 * the vulnerable application participants investigate.
 *
 * The URL is read from `LEVEL3_CHALLENGE_URL` so it can be repointed per
 * environment — the event-day host is unlikely to be the one used in rehearsal,
 * and a hardcoded address would mean a redeploy to change it. The default is the
 * address specified for this event.
 *
 * NOTE ON CREDENTIALS: this is a link only. Squad credentials are never appended
 * to it, never placed in a query string, and never forwarded from here — the
 * participant authenticates on the challenge site itself with the same squad name
 * and squad password they already hold.
 */
export const LEVEL3_CHALLENGE_URL =
  process.env['LEVEL3_CHALLENGE_URL'] ?? 'http://100.59.255.15:5000/participant-login';
