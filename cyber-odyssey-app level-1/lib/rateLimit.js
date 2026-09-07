/**
 * Attempt throttling for Level 1's authentication endpoints.
 *
 * ---------------------------------------------------------------------------
 * WHY, AND WHY IT IS SHAPED THIS WAY
 * ---------------------------------------------------------------------------
 * Neither Level 1 login had any limit. Team names are enumerable ("Crew 01" …
 * "Crew 60", plus the ACN test squads) and `authenticateTeam` accepts a NAME as
 * well as a code, so unlimited guessing against a known account list is exactly
 * the attack this application invites — participants are on the same network by
 * design and are actively encouraged to probe it.
 *
 * THE EVENT-DAY CONSTRAINT SHAPES THE KEY.
 * A whole venue usually shares one public address. Throttling purely by IP would
 * mean one crew fat-fingering their password six times locks out every other
 * crew in the room. So the primary key is (address + account), which isolates a
 * brute-force against one team from everybody else, and there is a much looser
 * per-address ceiling behind it to catch someone spraying many accounts from one
 * machine. A legitimate crew retyping their own password is nowhere near either.
 *
 * Failures decay: the window is a sliding one, so a crew who mistyped twice at
 * 09:00 starts clean by 09:15 rather than carrying it all event.
 *
 * ---------------------------------------------------------------------------
 * IN-MEMORY, ON PURPOSE, AND STATED PLAINLY
 * ---------------------------------------------------------------------------
 * This is a single-process application serving one event. Counters reset on
 * restart and do NOT span replicas — behind two processes every client gets
 * twice its allowance. That is a property of the deployment, not a bug, and it
 * is why the counters go through `RateLimitStore`: see lib/rateLimitStore.js
 * for the interface and the PostgreSQL implementation notes.
 *
 * Storage is now BOUNDED. Entries used to be dropped only when their own key was
 * looked at again, so a client varying the key each request grew the map for the
 * life of the process. There is now a periodic sweep and a hard per-bucket cap.
 */

const { MemoryRateLimitStore } = require('./rateLimitStore');

/** Sliding window over which failures accumulate. */
const WINDOW_MS = 15 * 60 * 1000;

const PROFILES = {
  /** Per (address + team). A crew retyping its own password stays well under this. */
  team: { maxAttempts: 10, lockoutMs: 5 * 60 * 1000 },
  /** Per address, across every account. Catches spraying without punishing a shared venue NAT. */
  teamAddress: { maxAttempts: 40, lockoutMs: 5 * 60 * 1000 },
  /** The admin console. One operator, one password — tighter, and a longer lockout. */
  admin: { maxAttempts: 8, lockoutMs: 10 * 60 * 1000 },
};

const store = new MemoryRateLimitStore({ windowMs: WINDOW_MS });
store.startSweeping();

/**
 * Whether a forwarded client address may be believed.
 *
 * ---------------------------------------------------------------------------
 * THIS GATE IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 * `X-Forwarded-For` is set by whoever sent the request. If it is trusted
 * unconditionally, an attacker sends a different value every time, lands in a
 * fresh bucket every time, and the throttler does nothing at all. That was
 * demonstrated against this application before this gate existed: eleven wrong
 * passwords from one address were throttled at the eleventh, while fourteen
 * wrong passwords with a rotating forwarded header were never throttled once.
 *
 * The header is only meaningful when something in front of the application is
 * KNOWN to overwrite it. That is a deployment fact the code cannot detect, so it
 * is declared: set `TRUST_PROXY=1` only when Level 1 sits behind a reverse proxy
 * that sets the header itself.
 *
 * Default is OFF, which matches how Level 1 runs today — directly on :3001, with
 * participants able to reach it. Off means the socket address is used, and the
 * socket address cannot be forged over TCP.
 */
function trustsProxyHeader() {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * The caller's address.
 *
 * Throttling remains a speed bump rather than an authorisation control — the
 * password check is the control — but a speed bump anyone can drive around is
 * not a speed bump.
 */
function clientAddress(req) {
  if (trustsProxyHeader()) {
    const forwarded = req.headers?.['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
    const candidate = (first || '').trim();
    // Bounded: a header is client-controlled even when the hop is trusted, and
    // an unbounded string would become an unbounded map key.
    if (candidate) return candidate.slice(0, 64);
  }
  return (req.socket?.remoteAddress || 'unknown').trim().slice(0, 64);
}

/**
 * Is this key currently locked out?
 *
 * Returns `{ locked, retryAfterSeconds }`. Expired lockouts are cleared as they
 * are observed; the periodic sweep in the store handles the ones nobody revisits.
 */
function check(profileName, key, now = Date.now()) {
  const entry = store.get(profileName, key);
  if (!entry) return { locked: false };

  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    store.delete(profileName, key);
    return { locked: false };
  }
  // Sliding window: a stale run of failures no longer counts.
  if (now - entry.firstAt > WINDOW_MS) {
    store.delete(profileName, key);
  }
  return { locked: false };
}

/** Records one failed attempt, locking the key out once the profile's limit is reached. */
function recordFailure(profileName, key, now = Date.now()) {
  const profile = PROFILES[profileName];
  const entry = store.get(profileName, key);

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    store.set(profileName, key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }

  entry.count += 1;
  if (entry.count >= profile.maxAttempts) {
    entry.lockedUntil = now + profile.lockoutMs;
  }
  // Written back explicitly rather than relying on the object being the same
  // reference the store holds — that is true for the memory store and would not
  // be for a database-backed one.
  store.set(profileName, key, entry);
}

/** Clears a key after a successful sign-in, so a crew is never penalised for getting it right. */
function recordSuccess(profileName, key) {
  store.delete(profileName, key);
}

/** Test-only: drops every counter. */
function resetAll() {
  store.clear();
}

/** Test/observability: how many keys are currently tracked. */
function trackedKeyCount() {
  return store.size();
}

/** Test-only: runs the sweep immediately rather than waiting for the interval. */
function sweepNow(now = Date.now()) {
  return store.sweep(now);
}

module.exports = {
  clientAddress,
  check,
  recordFailure,
  recordSuccess,
  resetAll,
  trackedKeyCount,
  sweepNow,
  trustsProxyHeader,
  PROFILES,
  WINDOW_MS,
  store,
};
