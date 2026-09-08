import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetAll,
  trackedKeyCount,
  clientAddressFromForwardedFor,
  trustsProxyHeader,
  IDENTIFIER_PROFILE,
  ADDRESS_PROFILE,
  UNRESOLVED_ADDRESS,
  isResolvedAddress,
} from '@/lib/auth/login-rate-limit';

/**
 * Portal login throttling.
 *
 * Time is injected rather than waited on, so window expiry and lockout release
 * are exercised at speed and deterministically. No server, no database.
 *
 * The behaviour these lock down is the pair of properties that are in tension:
 * a guesser must be stopped quickly, and 300 participants sharing one venue
 * address must never be stopped at all.
 */
describe('Portal login rate limiting', () => {
  const VENUE = '203.0.113.9';
  const T0 = 1_800_000_000_000;

  beforeEach(() => resetAll());

  describe('1-3. Threshold behaviour', () => {
    it('a single failed sign-in is not rate limited', () => {
      recordLoginFailure(VENUE, 'alice@example.org', T0);
      expect(checkLoginAllowed(VENUE, 'alice@example.org', T0).blocked).toBe(false);
    });

    it('failures below the threshold stay allowed', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts - 1; i++) {
        recordLoginFailure(VENUE, 'alice@example.org', T0);
      }
      expect(checkLoginAllowed(VENUE, 'alice@example.org', T0).blocked).toBe(false);
    });

    it('crossing the threshold blocks, with a retry-after in seconds', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts; i++) {
        recordLoginFailure(VENUE, 'alice@example.org', T0);
      }
      const verdict = checkLoginAllowed(VENUE, 'alice@example.org', T0);
      expect(verdict.blocked).toBe(true);
      expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
      expect(verdict.message).toMatch(/too many sign-in attempts/i);
    });

    it('the block message never reveals whether the account exists', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts; i++) {
        recordLoginFailure(VENUE, 'does-not-exist@example.org', T0);
      }
      const verdict = checkLoginAllowed(VENUE, 'does-not-exist@example.org', T0);
      expect(verdict.message).not.toMatch(/no such|not found|unknown account|does not exist/i);
    });
  });

  describe('4. Window expiry', () => {
    it('the lockout releases once its window passes', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts; i++) {
        recordLoginFailure(VENUE, 'alice@example.org', T0);
      }
      expect(checkLoginAllowed(VENUE, 'alice@example.org', T0).blocked).toBe(true);

      const after = T0 + IDENTIFIER_PROFILE.lockoutMs + 1_000;
      expect(checkLoginAllowed(VENUE, 'alice@example.org', after).blocked).toBe(false);
    });

    it('a stale run of failures does not accumulate across windows', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts - 1; i++) {
        recordLoginFailure(VENUE, 'alice@example.org', T0);
      }
      // One more, but a full window later — should start a fresh count, not lock.
      const later = T0 + IDENTIFIER_PROFILE.windowMs + 1_000;
      recordLoginFailure(VENUE, 'alice@example.org', later);
      expect(checkLoginAllowed(VENUE, 'alice@example.org', later).blocked).toBe(false);
    });
  });

  describe('5. Success clears the counter', () => {
    it('a correct password forgives the tries before it', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts - 1; i++) {
        recordLoginFailure(VENUE, 'alice@example.org', T0);
      }
      recordLoginSuccess(VENUE, 'alice@example.org');

      // Back to a clean slate: a further failure must not tip them over.
      recordLoginFailure(VENUE, 'alice@example.org', T0);
      expect(checkLoginAllowed(VENUE, 'alice@example.org', T0).blocked).toBe(false);
    });

    it('identifier casing cannot split or dodge a bucket', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts; i++) {
        recordLoginFailure(VENUE, 'Alice@Example.ORG', T0);
      }
      expect(checkLoginAllowed(VENUE, 'alice@example.org', T0).blocked).toBe(true);
    });
  });

  describe('6-7. The venue must not be collateral damage', () => {
    it("one participant's failures do not block a different participant", () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts * 2; i++) {
        recordLoginFailure(VENUE, 'unlucky@example.org', T0);
      }
      expect(checkLoginAllowed(VENUE, 'unlucky@example.org', T0).blocked).toBe(true);
      expect(checkLoginAllowed(VENUE, 'bystander@example.org', T0).blocked).toBe(false);
    });

    it('300 participants may each fail 3x from one address without a venue lockout', () => {
      let failures = 0;
      for (let p = 0; p < 300; p++) {
        for (let attempt = 0; attempt < 3; attempt++) {
          recordLoginFailure(VENUE, `participant${p}@example.org`, T0);
          failures++;
        }
      }
      expect(failures).toBe(900);
      // Nobody is over the per-identifier limit of 5, and the venue backstop is
      // sized well above 900 — so a fresh participant can still sign in.
      expect(checkLoginAllowed(VENUE, 'arriving-late@example.org', T0).blocked).toBe(false);
    });

    it('the per-address backstop still catches one machine spraying many accounts', () => {
      for (let i = 0; i < ADDRESS_PROFILE.maxAttempts; i++) {
        recordLoginFailure(VENUE, `guess${i}@example.org`, T0);
      }
      // Every identifier key is distinct, so only the address ceiling can catch this.
      expect(checkLoginAllowed(VENUE, 'anything@example.org', T0).blocked).toBe(true);
    });

    it('the venue ceiling sits above the worst legitimate load', () => {
      expect(ADDRESS_PROFILE.maxAttempts).toBeGreaterThan(900);
    });
  });

  describe('8. The limiter cannot be steered by a client header', () => {
    it('forwarded headers are ignored unless a proxy is explicitly trusted', () => {
      // Default deployment posture: TRUST_PROXY unset.
      expect(trustsProxyHeader()).toBe(false);
    });

    it('takes the RIGHTMOST forwarded entry, which only a trusted hop can write', () => {
      // A load balancer appends what it saw, so a client-forged prefix is inert.
      expect(clientAddressFromForwardedFor('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
      expect(clientAddressFromForwardedFor('9.9.9.9, 8.8.8.8, 203.0.113.9')).toBe('203.0.113.9');
    });

    it('a rotating forged prefix cannot open a fresh bucket', () => {
      const forged = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5', '6.6.6.6'];
      for (const f of forged) {
        const resolved = clientAddressFromForwardedFor(`${f}, ${VENUE}`);
        expect(resolved).toBe(VENUE);
        recordLoginFailure(resolved ?? 'unknown', 'victim@example.org', T0);
      }
      // All six landed in the same bucket, so the limit still bit.
      expect(checkLoginAllowed(VENUE, 'victim@example.org', T0).blocked).toBe(true);
    });

    it('malformed or empty forwarded values degrade safely', () => {
      expect(clientAddressFromForwardedFor(null)).toBeNull();
      expect(clientAddressFromForwardedFor('')).toBeNull();
      expect(clientAddressFromForwardedFor('   ,  ,  ')).toBeNull();
    });

    it('an absurdly long forwarded value cannot become an unbounded map key', () => {
      const huge = `${'a'.repeat(5000)}, ${'b'.repeat(5000)}`;
      const resolved = clientAddressFromForwardedFor(huge);
      expect(resolved).not.toBeNull();
      expect((resolved as string).length).toBeLessThanOrEqual(64);
    });
  });

  describe('Layering with the account lockout', () => {
    /**
     * These two controls cover different attackers and neither replaces the other.
     *
     * The rate limit is per (address + account), so an attacker who rotates
     * addresses gets a FRESH budget each time and the rate limiter alone would
     * never stop them. What climbs across all those addresses is the account's
     * own failure counter, which is why User.lockedUntil must stay.
     */
    it('a rotating attacker gets a fresh budget per address', () => {
      const target = 'victim@example.org';
      for (let hop = 0; hop < 4; hop++) {
        const addr = `198.51.100.${hop}`;
        for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts; i++) {
          recordLoginFailure(addr, target, T0);
        }
        // Blocked on that address...
        expect(checkLoginAllowed(addr, target, T0).blocked).toBe(true);
        // ...but the next address starts clean, which is precisely the gap the
        // durable per-account lockout exists to close.
        expect(checkLoginAllowed(`198.51.100.${hop + 1}`, target, T0).blocked).toBe(false);
      }
    });

    it('the rate limit bites before the account lockout can, from one address', () => {
      // Account lockout threshold is 10; this limiter stops at 5. From a single
      // connection an attacker is halted sooner, and — the point — a participant
      // can no longer be locked out of their OWN account for 15 minutes by
      // someone else spraying 10 wrong passwords at their known email address.
      expect(IDENTIFIER_PROFILE.maxAttempts).toBeLessThan(10);
    });
  });

  describe('Unresolvable address must not become a global kill-switch', () => {
    /**
     * Behind a load balancer with TRUST_PROXY unset there is no per-client
     * signal, so every caller on earth collapses into one key. A shared bucket
     * cannot isolate an attacker from a participant - it can only take the whole
     * venue down at once. So the cross-account ceiling is skipped there.
     */
    it('classifies the unresolved sentinel correctly', () => {
      expect(isResolvedAddress(UNRESOLVED_ADDRESS)).toBe(false);
      expect(isResolvedAddress('')).toBe(false);
      expect(isResolvedAddress('203.0.113.9')).toBe(true);
    });

    it('the address backstop is NOT applied when callers cannot be told apart', () => {
      // Far past the ceiling, every failure from a different account.
      for (let i = 0; i < ADDRESS_PROFILE.maxAttempts + 500; i++) {
        recordLoginFailure(UNRESOLVED_ADDRESS, `person${i}@example.org`, T0);
      }
      // A participant who has not failed at all must still be able to sign in.
      expect(checkLoginAllowed(UNRESOLVED_ADDRESS, 'innocent@example.org', T0).blocked).toBe(false);
    });

    it('but the per-account limit still applies with an unresolved address', () => {
      for (let i = 0; i < IDENTIFIER_PROFILE.maxAttempts; i++) {
        recordLoginFailure(UNRESOLVED_ADDRESS, 'guessed@example.org', T0);
      }
      expect(checkLoginAllowed(UNRESOLVED_ADDRESS, 'guessed@example.org', T0).blocked).toBe(true);
      // And still only that account.
      expect(checkLoginAllowed(UNRESOLVED_ADDRESS, 'other@example.org', T0).blocked).toBe(false);
    });

    it('a resolved address DOES still get the backstop', () => {
      for (let i = 0; i < ADDRESS_PROFILE.maxAttempts; i++) {
        recordLoginFailure('198.51.100.7', `person${i}@example.org`, T0);
      }
      expect(checkLoginAllowed('198.51.100.7', 'anyone@example.org', T0).blocked).toBe(true);
    });
  });

  describe('Memory safety', () => {
    it('tracked keys are released once their window passes', () => {
      for (let i = 0; i < 50; i++) {
        recordLoginFailure(VENUE, `throwaway${i}@example.org`, T0);
      }
      expect(trackedKeyCount()).toBeGreaterThan(0);

      // A check well past the window sweeps the entries it observes.
      const after = T0 + ADDRESS_PROFILE.windowMs + 1_000;
      for (let i = 0; i < 50; i++) {
        checkLoginAllowed(VENUE, `throwaway${i}@example.org`, after);
      }
      expect(trackedKeyCount()).toBeLessThan(50);
    });
  });

  describe('Configuration', () => {
    it('uses 5 failures per identifier as the guessing limit', () => {
      expect(IDENTIFIER_PROFILE.maxAttempts).toBe(5);
      expect(IDENTIFIER_PROFILE.windowMs).toBe(60_000);
    });
  });
});
