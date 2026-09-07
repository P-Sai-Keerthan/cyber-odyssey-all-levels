/**
 * The key that signs every Level 1 session cookie — team AND admin.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Both lib/cookies.js and lib/adminAuth.js used to resolve the secret themselves,
 * each with the same line:
 *
 *     const SECRET = process.env.SESSION_SECRET || "dev-only-insecure-secret";
 *
 * That fallback is a PUBLIC constant — it is committed, readable by anyone with
 * the source, and by anyone who finds this project. With it in force, forging a
 * cookie is arithmetic:
 *
 *     sb_team  = `${teamCode}.${hmac(SECRET, teamCode)}`   -> play as any squad
 *     sb_admin = `${expiry}.${hmac(SECRET, expiry)}`       -> full admin console,
 *                                                            which can reset the
 *                                                            event and every team
 *
 * Level 1 is an intentionally vulnerable application that participants are
 * invited to attack. Shipping it with a known cookie-signing key means the
 * intended challenge is bypassable by reading one line of source.
 *
 * The value was also read ONCE at module load into a `const`, so a process that
 * started before the environment was populated kept using the fallback for its
 * whole lifetime even after the variable was set.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * Outside development, a missing or weak SESSION_SECRET is a hard failure. It
 * fails CLOSED — no session can be issued or accepted — because the alternative
 * is an event that looks like it is running while every squad's identity is
 * forgeable.
 *
 * In development the fallback still applies so `next dev` works on a fresh
 * checkout, but it announces itself once per process so it cannot be mistaken
 * for a working configuration.
 *
 * This mirrors the decision already made for the integration bridge in
 * lib/integrationSignature.js, which returns null rather than defaulting: "a
 * default here would be a public secret".
 */

const DEV_FALLBACK = 'dev-only-insecure-secret';

/**
 * Shortest secret accepted outside development.
 *
 * 24 characters is not a cryptographic threshold — HMAC-SHA256 accepts any
 * length — it is a guess-resistance one. It rules out "password", "changeme",
 * and the event name, which is what actually gets typed into a .env under time
 * pressure on the morning of an event.
 */
const MIN_LENGTH = 24;

let warned = false;

/** True in the two environments where the development fallback is acceptable. */
function isDevelopmentLike() {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test' || !env;
}

/**
 * Returns the signing secret, or throws if the process is not configured to sign
 * anything safely.
 *
 * Read at CALL time, never cached in a module-level const: scripts and tests
 * populate `process.env` after import, and a cached value would silently keep
 * using whatever was present at require time.
 */
function sessionSecret() {
  const raw = process.env.SESSION_SECRET;
  const value = typeof raw === 'string' ? raw.trim() : '';

  if (value && value !== DEV_FALLBACK && value.length >= MIN_LENGTH) {
    return value;
  }

  if (!isDevelopmentLike()) {
    // Deliberately specific about WHICH problem it is: an operator reading this
    // in a log at 08:00 on event day needs to know whether to set the variable
    // or lengthen it.
    const problem = !value
      ? 'is not set'
      : value === DEV_FALLBACK
        ? 'is still the development placeholder'
        : `is shorter than the ${MIN_LENGTH}-character minimum`;
    throw new Error(
      `SESSION_SECRET ${problem}. Level 1 refuses to sign or accept session cookies ` +
        'without one, because a known key lets anyone forge any squad — and the admin console. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }

  if (!warned) {
    warned = true;
    console.warn(
      '[SECURITY] SESSION_SECRET is unset or too short. Falling back to a PUBLIC development key. ' +
        'Every team and admin cookie this process issues is forgeable. Never run an event like this.',
    );
  }

  return value || DEV_FALLBACK;
}

module.exports = { sessionSecret, DEV_FALLBACK, MIN_LENGTH };
