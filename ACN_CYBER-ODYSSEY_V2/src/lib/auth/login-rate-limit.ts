import 'server-only';
import { headers } from 'next/headers';

/**
 * Login attempt throttling for the Portal.
 *
 * ---------------------------------------------------------------------------
 * WHAT ALREADY EXISTED, AND WHAT THIS ADDS
 * ---------------------------------------------------------------------------
 * The Portal already locks an ACCOUNT after 10 consecutive failures
 * (`User.lockedUntil`, see auth-actions.ts). That control is durable, survives
 * restarts, and cannot be dodged by rotating IP addresses — it is keyed on the
 * account, not the caller.
 *
 * What it does NOT do is limit RATE. Ten guesses against one account can be
 * spent in under a second, and an attacker spraying ONE common password across
 * 300 different accounts never trips it at all: each account sees a single
 * failure. This module adds the missing dimension — how fast, and how much,
 * from one caller.
 *
 * The two controls are complementary and both are kept:
 *
 *   ACCOUNT LOCKOUT (existing)  survives restarts, beats IP rotation
 *   RATE LIMIT      (this)      beats rapid guessing and account spraying
 *
 * ---------------------------------------------------------------------------
 * THE VENUE CONSTRAINT SHAPES THE KEYS
 * ---------------------------------------------------------------------------
 * A naive "5 failures per IP per minute" would be a guaranteed outage here.
 * ~300 participants attend from one venue behind ONE public address, and behind
 * a load balancer they are indistinguishable. Five failures event-wide would
 * lock every remaining participant out within seconds of the doors opening.
 *
 * So the primary key is (address + identifier). The account is part of the key,
 * so NAT cannot merge two participants into one bucket, and one squad
 * fat-fingering its password cannot affect anybody else. That gives the strict
 * 5-per-minute guessing limit where it belongs.
 *
 * Behind it sits a per-address ceiling sized for the WHOLE VENUE rather than
 * one person — see ADDRESS_PROFILE. It exists to catch one machine spraying
 * many accounts, which the identifier key alone would miss.
 *
 * ---------------------------------------------------------------------------
 * IN-MEMORY, SINGLE PROCESS — STATED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 * Counters live in this process. They reset on restart and are NOT shared
 * across replicas: behind two Portal instances each client gets two allowances.
 * That is a property of the deployment, not a defect, and it is acceptable
 * precisely because the durable account lockout sits behind it. If the Portal
 * is ever scaled out AND this becomes the primary control, move the counters to
 * the database (a small table keyed by bucket+key, upserted with ON CONFLICT).
 */

/**
 * Returned by `getClientAddress` when the caller cannot be distinguished.
 *
 * THIS VALUE DISABLES THE ADDRESS BACKSTOP, deliberately. Behind a load balancer
 * with TRUST_PROXY unset there is no per-client signal at all, so every caller
 * on earth collapses into this one key. A shared bucket cannot isolate an
 * attacker from a participant — all it can do is take the whole venue down at
 * once, which is the exact failure this project has already hit in Level 1.
 *
 * The per-(address + identifier) limit is unaffected: the identifier is in that
 * key, so 5-per-minute still applies per account even when the address is
 * unknown. Only the blunt cross-account ceiling is skipped.
 *
 * Set TRUST_PROXY=1 in production to restore it.
 */
export const UNRESOLVED_ADDRESS = 'unknown';

/** True when the address is specific enough for a cross-account ceiling. */
export function isResolvedAddress(address: string): boolean {
  return address !== UNRESOLVED_ADDRESS && address.trim() !== '';
}

/** Sliding window for the per-(address + identifier) limit. */
const IDENTIFIER_WINDOW_MS = 60 * 1000;

/** Sliding window for the venue-wide backstop. */
const ADDRESS_WINDOW_MS = 15 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Per (address + identifier). This is the real guessing control.
 *
 * Five failures a minute is far above any human retyping their own password and
 * far below a useful guessing rate. NAT-safe: the identifier is in the key.
 */
export const IDENTIFIER_PROFILE = {
  maxAttempts: envInt('PORTAL_LOGIN_MAX_PER_IDENTIFIER', 5),
  windowMs: IDENTIFIER_WINDOW_MS,
  lockoutMs: 60 * 1000,
};

/**
 * Per address, across every account. A BACKSTOP, sized for a venue.
 *
 * 300 participants each mistyping three times is 900 failures in a 15-minute
 * window and is entirely normal at event start. The ceiling therefore sits well
 * above that. It is not the brute-force control — the identifier profile above
 * and the account lockout are — it only catches one machine spraying many
 * different accounts, which neither of those would see.
 *
 * Raise with PORTAL_LOGIN_MAX_PER_ADDRESS if a venue is busier than expected.
 */
export const ADDRESS_PROFILE = {
  maxAttempts: envInt('PORTAL_LOGIN_MAX_PER_ADDRESS', 2000),
  windowMs: ADDRESS_WINDOW_MS,
  lockoutMs: 5 * 60 * 1000,
};

interface Entry {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

type Bucket = 'identifier' | 'address';

const buckets: Record<Bucket, Map<string, Entry>> = {
  identifier: new Map(),
  address: new Map(),
};

/** Hard cap per bucket, so an unauthenticated caller cannot grow the heap. */
const MAX_KEYS_PER_BUCKET = envInt('PORTAL_LOGIN_MAX_KEYS', 20000);

function profileFor(bucket: Bucket) {
  return bucket === 'identifier' ? IDENTIFIER_PROFILE : ADDRESS_PROFILE;
}

/** Drops entries that are both unlocked and past their window. */
export function sweep(now: number = Date.now()): number {
  let removed = 0;
  for (const bucket of Object.keys(buckets) as Bucket[]) {
    const map = buckets[bucket];
    const { windowMs } = profileFor(bucket);
    for (const [key, entry] of map) {
      const unlocked = !entry.lockedUntil || entry.lockedUntil <= now;
      if (unlocked && now - entry.firstAt > windowMs) {
        map.delete(key);
        removed++;
      }
    }
  }
  return removed;
}

function put(bucket: Bucket, key: string, entry: Entry): void {
  const map = buckets[bucket];
  if (!map.has(key) && map.size >= MAX_KEYS_PER_BUCKET) {
    sweep(Date.now());
    // Still full: evict oldest insertions. Eviction only ever FORGIVES — it can
    // drop a counter, never fabricate a lockout for someone who has not failed.
    while (map.size >= MAX_KEYS_PER_BUCKET) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }
  map.set(key, entry);
}

export interface LimitState {
  locked: boolean;
  retryAfterSeconds: number;
}

/** Is this key currently locked out? Expired lockouts are cleared as observed. */
export function check(bucket: Bucket, key: string, now: number = Date.now()): LimitState {
  const map = buckets[bucket];
  const entry = map.get(key);
  if (!entry) return { locked: false, retryAfterSeconds: 0 };

  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    map.delete(key);
    return { locked: false, retryAfterSeconds: 0 };
  }
  if (now - entry.firstAt > profileFor(bucket).windowMs) {
    map.delete(key);
  }
  return { locked: false, retryAfterSeconds: 0 };
}

/** Records ONE FAILED attempt. Successes never reach this — see recordSuccess. */
export function recordFailure(bucket: Bucket, key: string, now: number = Date.now()): void {
  const profile = profileFor(bucket);
  const entry = buckets[bucket].get(key);

  if (!entry || now - entry.firstAt > profile.windowMs) {
    put(bucket, key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }

  entry.count += 1;
  if (entry.count >= profile.maxAttempts) {
    entry.lockedUntil = now + profile.lockoutMs;
  }
  put(bucket, key, entry);
}

/**
 * Clears a key after a successful sign-in.
 *
 * A participant who finally types it right is never penalised for the tries
 * before, which is what keeps this invisible to legitimate users.
 */
export function recordSuccess(bucket: Bucket, key: string): void {
  buckets[bucket].delete(key);
}

/** Test-only: drops every counter. */
export function resetAll(): void {
  buckets.identifier.clear();
  buckets.address.clear();
}

/** Test/observability: how many keys are tracked right now. */
export function trackedKeyCount(): number {
  return buckets.identifier.size + buckets.address.size;
}

/**
 * Whether a forwarded client address may be believed.
 *
 * `X-Forwarded-For` is written by whoever sent the request. Trusting it blindly
 * means an attacker sends a different value each time, lands in a fresh bucket
 * each time, and the limiter does nothing. It is only meaningful when something
 * in front of the app is KNOWN to append to it — a deployment fact code cannot
 * detect, so it is declared: set TRUST_PROXY=1 when the Portal sits behind a
 * load balancer or reverse proxy.
 */
export function trustsProxyHeader(): boolean {
  const raw = String(process.env['TRUST_PROXY'] ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Picks the client address out of an `X-Forwarded-For` value.
 *
 * TAKES THE RIGHTMOST ENTRY, and that is the whole point.
 *
 * A load balancer (AWS ALB among them) APPENDS the address it saw to whatever
 * the client already sent. So for a request arriving with a forged header:
 *
 *     X-Forwarded-For: 1.2.3.4          <- forged by the client
 *     ALB appends the real peer         -> "1.2.3.4, 203.0.113.9"
 *
 * The LEFTMOST entry is attacker-controlled; the RIGHTMOST is the one the trusted
 * hop wrote. Reading left-to-right is the classic bypass, and it is why this
 * function exists rather than a `split(',')[0]`.
 */
export function clientAddressFromForwardedFor(value: string | null): string | null {
  if (!value) return null;
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  // Bounded: still client-influenced even through a trusted hop, and an
  // unbounded string would become an unbounded map key.
  return last ? last.slice(0, 64) : null;
}

/** The caller's address for throttling purposes. */
export async function getClientAddress(): Promise<string> {
  try {
    const h = await headers();
    if (trustsProxyHeader()) {
      const forwarded = clientAddressFromForwardedFor(h.get('x-forwarded-for'));
      if (forwarded) return forwarded;
    }
    const real = h.get('x-real-ip');
    if (real) return real.trim().slice(0, 64);
  } catch {
    // headers() is unavailable outside a request scope (unit tests). Fall through.
  }
  return UNRESOLVED_ADDRESS;
}

/** Normalised key part for an identifier, so casing cannot split buckets. */
export function identifierKeyPart(identifier: string): string {
  return identifier.trim().toLowerCase().slice(0, 128);
}

export interface LoginThrottleVerdict {
  blocked: boolean;
  retryAfterSeconds: number;
  /** Message written for the person who is looking at the form. */
  message: string;
}

/**
 * The check `loginAction` runs before it touches a password hash.
 *
 * Deliberately checked BEFORE verification: password hashing is intentionally
 * expensive, so letting a blocked caller through to it would make the limiter a
 * CPU amplifier rather than a brake.
 */
export function checkLoginAllowed(
  address: string,
  identifier: string,
  now: number = Date.now(),
): LoginThrottleVerdict {
  const idKey = `${address}|${identifierKeyPart(identifier)}`;
  const perIdentifier = check('identifier', idKey, now);
  // The cross-account ceiling only applies when we can actually tell callers
  // apart — see UNRESOLVED_ADDRESS.
  const perAddress = isResolvedAddress(address)
    ? check('address', address, now)
    : { locked: false, retryAfterSeconds: 0 };
  const hit = perIdentifier.locked ? perIdentifier : perAddress.locked ? perAddress : null;

  if (!hit) return { blocked: false, retryAfterSeconds: 0, message: '' };

  const seconds = Math.max(1, hit.retryAfterSeconds);
  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? '' : 's'}`
      : `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}`;

  return {
    blocked: true,
    retryAfterSeconds: seconds,
    message:
      `Too many sign-in attempts from this connection. Please wait about ${wait} and try again. ` +
      'If you have forgotten your password, an event marshal can help.',
  };
}

/** Records a failed sign-in against both keys. */
export function recordLoginFailure(
  address: string,
  identifier: string,
  now: number = Date.now(),
): void {
  recordFailure('identifier', `${address}|${identifierKeyPart(identifier)}`, now);
  if (isResolvedAddress(address)) {
    recordFailure('address', address, now);
  }
}

/** Clears the per-identifier counter after a successful sign-in. */
export function recordLoginSuccess(address: string, identifier: string): void {
  recordSuccess('identifier', `${address}|${identifierKeyPart(identifier)}`);
}
