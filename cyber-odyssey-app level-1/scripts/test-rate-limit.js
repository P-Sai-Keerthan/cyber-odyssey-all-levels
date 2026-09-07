/**
 * Attempt-throttling test suite.
 *
 * Covers what the throttler is actually relied on for: that it stops a guessing
 * run, that it does not punish a crew who gets it right, that it cannot be
 * driven around with a forged header, and that it cannot be made to grow the
 * heap without bound by an unauthenticated client.
 *
 * Pure unit tests — no server, no database, no clock waiting. Time is passed in
 * explicitly so expiry and sliding-window behaviour can be exercised at speed.
 */

const assert = require('assert');
const { MemoryRateLimitStore } = require('../lib/rateLimitStore');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

console.log('============================================================');
console.log('ATTEMPT THROTTLING — RATE LIMITER TEST SUITE');
console.log('============================================================\n');

// Loaded AFTER the env is settled so `trustsProxyHeader` reads what we set.
function freshLimiter(env = {}) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[require.resolve('../lib/rateLimit')];
  delete require.cache[require.resolve('../lib/rateLimitStore')];
  return require('../lib/rateLimit');
}

// ---------------------------------------------------------------------------
console.log('1. Counting, locking and expiry');
// ---------------------------------------------------------------------------
{
  const rl = freshLimiter({ TRUST_PROXY: undefined });
  const { check, recordFailure, recordSuccess, resetAll, PROFILES, WINDOW_MS } = rl;

  test('under the limit is never locked', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.team.maxAttempts - 1; i++) {
      recordFailure('team', '1.2.3.4|crew', now);
    }
    assert.strictEqual(check('team', '1.2.3.4|crew', now).locked, false);
  });

  test('reaching the limit locks out, with a Retry-After', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.team.maxAttempts; i++) {
      recordFailure('team', '1.2.3.4|crew', now);
    }
    const res = check('team', '1.2.3.4|crew', now);
    assert.strictEqual(res.locked, true);
    assert.ok(res.retryAfterSeconds > 0, 'expected a retry-after');
    assert.ok(
      res.retryAfterSeconds <= PROFILES.team.lockoutMs / 1000,
      'retry-after must not exceed the lockout',
    );
  });

  test('exceeding the limit stays locked and does not extend indefinitely', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.team.maxAttempts + 20; i++) {
      recordFailure('team', '1.2.3.4|crew', now);
    }
    const res = check('team', '1.2.3.4|crew', now);
    assert.strictEqual(res.locked, true);
    assert.ok(res.retryAfterSeconds <= PROFILES.team.lockoutMs / 1000);
  });

  test('the lockout expires', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.team.maxAttempts; i++) recordFailure('team', 'k', now);
    assert.strictEqual(check('team', 'k', now).locked, true);
    const after = now + PROFILES.team.lockoutMs + 1;
    assert.strictEqual(check('team', 'k', after).locked, false);
  });

  test('the sliding window forgives a stale run of failures', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.team.maxAttempts - 1; i++) recordFailure('team', 'k', now);
    // One more, but long after the window closed: the run restarts at 1.
    recordFailure('team', 'k', now + WINDOW_MS + 1);
    assert.strictEqual(check('team', 'k', now + WINDOW_MS + 1).locked, false);
  });

  test('a successful sign-in clears the key', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.team.maxAttempts - 1; i++) recordFailure('team', 'k', now);
    recordSuccess('team', 'k');
    for (let i = 0; i < PROFILES.team.maxAttempts - 1; i++) recordFailure('team', 'k', now);
    assert.strictEqual(check('team', 'k', now).locked, false);
  });

  test('separate identities do not share a bucket', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.team.maxAttempts; i++) recordFailure('team', 'a|crew', now);
    assert.strictEqual(check('team', 'a|crew', now).locked, true);
    // The event-day property: a different crew from the SAME venue address.
    assert.strictEqual(check('team', 'a|other', now).locked, false);
    // And a different address entirely.
    assert.strictEqual(check('team', 'b|crew', now).locked, false);
  });

  test('profiles are independent — an admin lockout does not lock a crew', () => {
    resetAll();
    const now = Date.now();
    for (let i = 0; i < PROFILES.admin.maxAttempts; i++) recordFailure('admin', 'a', now);
    assert.strictEqual(check('admin', 'a', now).locked, true);
    assert.strictEqual(check('team', 'a', now).locked, false);
  });

  test('the admin profile is stricter than the team profile', () => {
    assert.ok(
      PROFILES.admin.maxAttempts < PROFILES.team.maxAttempts,
      'admin should tolerate fewer attempts',
    );
    assert.ok(
      PROFILES.admin.lockoutMs >= PROFILES.team.lockoutMs,
      'admin lockout should be at least as long',
    );
  });
}

// ---------------------------------------------------------------------------
console.log('\n2. Client identity — the forged-header bypass');
// ---------------------------------------------------------------------------
{
  test('a forwarded header is IGNORED by default', () => {
    const rl = freshLimiter({ TRUST_PROXY: undefined });
    assert.strictEqual(rl.trustsProxyHeader(), false);
    const addr = rl.clientAddress({
      headers: { 'x-forwarded-for': '9.9.9.9' },
      socket: { remoteAddress: '10.0.0.5' },
    });
    // The socket address wins. This is the whole fix: before it, an attacker
    // rotating this header landed in a new bucket every request and was never
    // throttled — demonstrated live against /api/team/login.
    assert.strictEqual(addr, '10.0.0.5');
  });

  test('rotating a forged header cannot escape the bucket', () => {
    const rl = freshLimiter({ TRUST_PROXY: undefined });
    rl.resetAll();
    const now = Date.now();
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
      const addr = rl.clientAddress({
        headers: { 'x-forwarded-for': `10.9.${i}.${i}` },
        socket: { remoteAddress: '10.0.0.5' },
      });
      seen.add(addr);
      rl.recordFailure('team', `${addr}|crew`, now);
    }
    assert.strictEqual(seen.size, 1, 'every attempt must resolve to ONE identity');
    assert.strictEqual(rl.check('team', '10.0.0.5|crew', now).locked, true);
  });

  test('a forwarded header IS honoured when a proxy is explicitly trusted', () => {
    const rl = freshLimiter({ TRUST_PROXY: '1' });
    assert.strictEqual(rl.trustsProxyHeader(), true);
    const addr = rl.clientAddress({
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    });
    assert.strictEqual(addr, '9.9.9.9', 'the left-most entry is the client');
  });

  test('malformed identity information degrades safely', () => {
    const rl = freshLimiter({ TRUST_PROXY: '1' });
    // No header, no socket.
    assert.strictEqual(rl.clientAddress({ headers: {}, socket: {} }), 'unknown');
    // Empty header falls through to the socket.
    assert.strictEqual(
      rl.clientAddress({ headers: { 'x-forwarded-for': '' }, socket: { remoteAddress: '1.1.1.1' } }),
      '1.1.1.1',
    );
    // Array form, as Node presents a repeated header.
    assert.strictEqual(
      rl.clientAddress({ headers: { 'x-forwarded-for': ['2.2.2.2'] }, socket: {} }),
      '2.2.2.2',
    );
    // A request object missing everything must not throw.
    assert.doesNotThrow(() => rl.clientAddress({}));
  });

  test('an absurdly long forwarded value cannot become an unbounded map key', () => {
    const rl = freshLimiter({ TRUST_PROXY: '1' });
    const addr = rl.clientAddress({
      headers: { 'x-forwarded-for': 'A'.repeat(100000) },
      socket: {},
    });
    assert.ok(addr.length <= 64, `key length ${addr.length} must be bounded`);
  });
}

// ---------------------------------------------------------------------------
console.log('\n3. Bounded memory and cleanup');
// ---------------------------------------------------------------------------
{
  test('expired entries are swept even if nobody looks at them again', () => {
    const rl = freshLimiter({ TRUST_PROXY: undefined });
    rl.resetAll();
    const now = Date.now();
    for (let i = 0; i < 500; i++) rl.recordFailure('team', `stale-${i}`, now);
    assert.strictEqual(rl.trackedKeyCount(), 500);

    // Nothing revisits these keys — this is exactly the case the old
    // read-triggered cleanup never reclaimed.
    const removed = rl.sweepNow(now + rl.WINDOW_MS + 1);
    assert.strictEqual(removed, 500);
    assert.strictEqual(rl.trackedKeyCount(), 0);
  });

  test('the sweep never removes an entry whose lockout is still in the future', () => {
    // Constructed on the store directly: with the shipped profiles the lockout
    // (5 min) is always shorter than the window (15 min), so "window closed but
    // still locked" cannot be reached through recordFailure. The sweep predicate
    // must still be correct — a longer lockout profile, or a future one, would
    // reach it, and sweeping a live lockout hands the attacker a clean slate.
    const store = new MemoryRateLimitStore({ windowMs: 60_000 });
    const now = Date.now();
    store.set('team', 'locked', {
      count: 99,
      firstAt: now - 10 * 60_000, // window long closed
      lockedUntil: now + 10 * 60_000, // lockout very much live
    });
    store.set('team', 'stale', { count: 1, firstAt: now - 10 * 60_000, lockedUntil: 0 });

    const removed = store.sweep(now);
    assert.strictEqual(removed, 1, 'only the stale entry should go');
    assert.ok(store.get('team', 'locked'), 'a live lockout must survive the sweep');
    assert.strictEqual(store.get('team', 'stale'), undefined);
  });

  test('key count is hard-capped, so an unauthenticated client cannot grow the heap', () => {
    const store = new MemoryRateLimitStore({ windowMs: 60000, maxKeysPerBucket: 100 });
    const now = Date.now();
    for (let i = 0; i < 5000; i++) {
      store.set('team', `key-${i}`, { count: 1, firstAt: now, lockedUntil: 0 });
    }
    assert.ok(store.size() <= 100, `expected <= 100 keys, got ${store.size()}`);
    assert.ok(store.evictions > 0, 'expected evictions to have occurred');
  });

  test('eviction only ever forgives — it never fabricates a lockout', () => {
    const store = new MemoryRateLimitStore({ windowMs: 60000, maxKeysPerBucket: 10 });
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      store.set('team', `k-${i}`, { count: 1, firstAt: now, lockedUntil: 0 });
    }
    for (const [, entry] of store.bucketFor('team')) {
      assert.strictEqual(entry.lockedUntil, 0, 'eviction must not invent a lockout');
    }
  });

  test('the sweep timer does not hold the process open', () => {
    const store = new MemoryRateLimitStore({ windowMs: 1000 });
    store.startSweeping(50);
    assert.ok(store.timer, 'expected a timer');
    // `unref`d timers report false here; that is what keeps `node script.js` exiting.
    assert.strictEqual(store.timer.hasRef(), false);
    store.stopSweeping();
  });
}

// ---------------------------------------------------------------------------
console.log('\n4. Concurrency and restart behaviour');
// ---------------------------------------------------------------------------
{
  test('concurrent failures against one key all count', async () => {
    const rl = freshLimiter({ TRUST_PROXY: undefined });
    rl.resetAll();
    const now = Date.now();
    // Node is single-threaded, so "concurrent" here means interleaved within one
    // tick — which is precisely how simultaneous HTTP handlers reach this code.
    await Promise.all(
      Array.from({ length: rl.PROFILES.team.maxAttempts }, () =>
        Promise.resolve().then(() => rl.recordFailure('team', 'race', now)),
      ),
    );
    assert.strictEqual(rl.check('team', 'race', now).locked, true);
  });

  test('counters do NOT survive a restart — stated, not assumed', () => {
    const rl = freshLimiter({ TRUST_PROXY: undefined });
    rl.resetAll();
    const now = Date.now();
    for (let i = 0; i < rl.PROFILES.team.maxAttempts; i++) rl.recordFailure('team', 'k', now);
    assert.strictEqual(rl.check('team', 'k', now).locked, true);

    // Re-requiring the module is this suite's stand-in for a process restart.
    const restarted = freshLimiter({ TRUST_PROXY: undefined });
    assert.strictEqual(
      restarted.check('team', 'k', now).locked,
      false,
      'in-memory counters reset on restart — a documented property of this deployment',
    );
  });
}

console.log('\n============================================================');
console.log(`RATE LIMITER RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('============================================================');

process.exit(failed === 0 ? 0 : 1);
