/**
 * Cross-language signature parity: ORION (Python) signs, Cyber Odyssey (Node)
 * verifies.
 *
 * The two sides are written in different languages with different JSON writers.
 * If they ever disagree about what bytes are being signed — key order,
 * separators, unicode escaping — every real discovery silently fails
 * authentication, and the symptom at the event is "Level 3 scores just stopped"
 * with nothing obviously broken on either side.
 *
 * The vector below was produced by running the REAL
 * `platform_security.sign_payload` from the ORION project. It is checked in as a
 * fixed value so this test needs neither a Python runtime nor a network: if
 * either implementation's canonicalisation drifts, this fails immediately and
 * points at the cause.
 *
 * To regenerate after an intentional protocol change:
 *
 *   python -c "
 *   import json; from platform_security import sign_payload
 *   body = json.dumps({...}, separators=(',',':'), sort_keys=True)
 *   print(body); print('sha256=' + sign_payload(SECRET, f'{TS}.{body}'))"
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { verifySignature, signBody } from '@/lib/integration/hmac';

/** Not a deployment secret — only ever used to produce this fixture. */
const GOLDEN_SECRET = 'golden-vector-secret-not-a-real-deployment-secret';
const GOLDEN_TIMESTAMP = '1800000000';
const GOLDEN_BODY =
  '{"eventId":"orion-golden-0001","eventType":"BUG_DISCOVERED",' +
  '"externalBugRef":"t2_06","externalTeamRef":"odyssey-team-golden",' +
  '"nonce":"golden-nonce-0001"}';
const GOLDEN_SIGNATURE = 'sha256=594c1c11c42aa5ced8f00928b126bf53498eeadde0704608f9e13706a59e5d96';

const AT_SIGNING_TIME = Number(GOLDEN_TIMESTAMP);

beforeAll(() => {
  process.env['ODYSSEY_INTEGRATION_SECRET'] = GOLDEN_SECRET;
});

describe('ORION -> Cyber Odyssey signature parity', () => {
  it('accepts a signature produced by the Python sender', () => {
    const result = verifySignature(
      GOLDEN_BODY,
      GOLDEN_SIGNATURE,
      GOLDEN_TIMESTAMP,
      AT_SIGNING_TIME,
    );
    expect(result.ok).toBe(true);
  });

  it('produces byte-identical output to the Python implementation', () => {
    // Not just "accepts it" — the receiver independently derives the same value,
    // which is what proves the two canonicalisations agree rather than that the
    // comparison is lenient.
    expect(signBody(GOLDEN_SECRET, GOLDEN_BODY, GOLDEN_TIMESTAMP)).toBe(GOLDEN_SIGNATURE);
  });

  it('rejects the vector when one byte of the body changes', () => {
    const tampered = GOLDEN_BODY.replace('t2_06', 't2_07');
    const result = verifySignature(tampered, GOLDEN_SIGNATURE, GOLDEN_TIMESTAMP, AT_SIGNING_TIME);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects the vector when the team reference is swapped', () => {
    // The specific forgery that matters: scoring for another squad.
    const swapped = GOLDEN_BODY.replace('odyssey-team-golden', 'odyssey-team-victim');
    const result = verifySignature(swapped, GOLDEN_SIGNATURE, GOLDEN_TIMESTAMP, AT_SIGNING_TIME);
    expect(result.ok).toBe(false);
  });

  it('rejects the vector outside the clock-skew window', () => {
    const result = verifySignature(
      GOLDEN_BODY,
      GOLDEN_SIGNATURE,
      GOLDEN_TIMESTAMP,
      AT_SIGNING_TIME + 600,
    );
    expect(result.reason).toBe('EXPIRED_TIMESTAMP');
  });

  it('rejects the vector under a different secret', () => {
    process.env['ODYSSEY_INTEGRATION_SECRET'] = 'a-completely-different-secret-value';
    try {
      const result = verifySignature(
        GOLDEN_BODY,
        GOLDEN_SIGNATURE,
        GOLDEN_TIMESTAMP,
        AT_SIGNING_TIME,
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('BAD_SIGNATURE');
    } finally {
      process.env['ODYSSEY_INTEGRATION_SECRET'] = GOLDEN_SECRET;
    }
  });

  it('disables the bridge rather than accepting anything when no secret is set', () => {
    const saved = process.env['ODYSSEY_INTEGRATION_SECRET'];
    delete process.env['ODYSSEY_INTEGRATION_SECRET'];
    try {
      const result = verifySignature(
        GOLDEN_BODY,
        GOLDEN_SIGNATURE,
        GOLDEN_TIMESTAMP,
        AT_SIGNING_TIME,
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('MISSING_SECRET');
    } finally {
      process.env['ODYSSEY_INTEGRATION_SECRET'] = saved;
    }
  });
});
