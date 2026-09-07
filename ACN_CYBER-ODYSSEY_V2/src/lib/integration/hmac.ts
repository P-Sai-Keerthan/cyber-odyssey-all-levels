import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Server-to-server request authentication for the external challenge bridges.
 *
 * ---------------------------------------------------------------------------
 * ONE MECHANISM, TWO TENANTS
 * ---------------------------------------------------------------------------
 * Originally written for the ORION Level 3 bridge and generalised, unchanged in
 * behaviour, when Level 1 needed the same guarantees. Both bridges share this
 * algorithm — `HMAC-SHA256(secret, `${timestamp}.${rawBody}`)`, hex, prefixed
 * `sha256=` — and differ only in which header names carry it and which secret
 * signs it. A second, subtly-different signing scheme would be two things to get
 * right instead of one, and the one that is exercised less would be the one that
 * is wrong.
 *
 * The secrets are deliberately SEPARATE. Both Level 1 and ORION are applications
 * participants actively attack. A compromise of one must not confer the ability
 * to sign events for the other.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * A valid signature proves the request was composed by something holding the
 * shared secret — i.e. the ORION server — and that the body was not altered in
 * transit. That is the ONLY thing it proves.
 *
 * It says nothing about whether the claim inside is true. The route still
 * resolves the squad, the bug and the point value from Cyber Odyssey's own
 * records, because a compromised ORION would be able to sign anything it liked.
 * Authentication and authorisation stay separate.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RAW BODY
 * ---------------------------------------------------------------------------
 * The signature covers the exact bytes received, before parsing. Signing a
 * re-serialised object instead would mean the sender signs one encoding and the
 * receiver verifies another — key order, whitespace and unicode escaping all
 * differ between JSON writers, and any such gap is a signature bypass waiting to
 * be found. Verify what you will parse; parse what you verified.
 */

export const SIGNATURE_HEADER = 'x-orion-signature';
export const TIMESTAMP_HEADER = 'x-orion-timestamp';

/**
 * Level 1 bridge headers.
 *
 * A distinct namespace from ORION's so a request cannot be replayed from one
 * bridge into the other by swapping the URL: the receiving route reads only its
 * own header pair, so a correctly-signed ORION request arriving at the Level 1
 * endpoint carries no signature at all as far as that endpoint is concerned.
 */
export const LEVEL1_SIGNATURE_HEADER = 'x-odyssey-signature';
export const LEVEL1_TIMESTAMP_HEADER = 'x-odyssey-timestamp';

/**
 * How far a request's timestamp may be from ours.
 *
 * Five minutes each way. Long enough to survive ordinary clock skew between two
 * hosts and a slow retry; short enough that a captured request stops being
 * useful quickly. The nonce store is what makes replay impossible outright —
 * this window bounds how long that store has to remember anything.
 */
export const MAX_CLOCK_SKEW_SECONDS = 300;

export type SignatureFailure =
  | 'MISSING_SECRET'
  | 'MISSING_SIGNATURE'
  | 'MISSING_TIMESTAMP'
  | 'MALFORMED_TIMESTAMP'
  | 'EXPIRED_TIMESTAMP'
  | 'BAD_SIGNATURE';

export interface SignatureResult {
  ok: boolean;
  reason?: SignatureFailure;
}

/**
 * The shared secret, or null when unset.
 *
 * Null disables the bridge entirely rather than falling back to a default. A
 * default secret in source would be public, and a public secret on this endpoint
 * means anyone can award points to any squad.
 */
export function integrationSecret(): string | null {
  const value = process.env['ODYSSEY_INTEGRATION_SECRET']?.trim();
  return value ? value : null;
}

/**
 * The Level 1 shared secret, or null when unset.
 *
 * Same rule, separate value: null disables the Level 1 bridge outright rather
 * than falling back to anything. Read at call time, not at module load, so a
 * test or a restarted process picks up the current environment.
 */
export function level1IntegrationSecret(): string | null {
  const value = process.env['ODYSSEY_LEVEL1_SECRET']?.trim();
  return value ? value : null;
}

/** `sha256=<hex>`, matching the form ORION sends. */
export function signBody(secret: string, rawBody: string, timestamp: string): string {
  // The timestamp is inside the signed material, so it cannot be edited to move
  // a captured request into a fresh window.
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  return `sha256=${mac}`;
}

/**
 * Verifies a request against an explicitly-supplied secret.
 *
 * The whole of the verification logic lives here; the per-bridge wrappers below
 * differ only in which secret they look up. Keeping one implementation means the
 * ordering that matters — expiry checked before the comparison, length checked
 * before `timingSafeEqual` — cannot drift between bridges.
 *
 * `secret` may be null, which is reported as MISSING_SECRET rather than treated
 * as an empty key: signing with "" would produce a valid, guessable MAC.
 */
export function verifySignatureWithSecret(
  secret: string | null,
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureResult {
  if (!secret) return { ok: false, reason: 'MISSING_SECRET' };
  if (!signatureHeader) return { ok: false, reason: 'MISSING_SIGNATURE' };
  if (!timestampHeader) return { ok: false, reason: 'MISSING_TIMESTAMP' };

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
    return { ok: false, reason: 'MALFORMED_TIMESTAMP' };
  }

  // Checked BEFORE the comparison so an attacker cannot use response timing on
  // stale requests to probe the signature.
  if (Math.abs(nowSeconds - ts) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'EXPIRED_TIMESTAMP' };
  }

  const expected = signBody(secret, rawBody, timestampHeader);

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  // Length is compared separately because timingSafeEqual throws on a mismatch;
  // a differing length is not secret information (the format is fixed).
  if (a.length !== b.length) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'BAD_SIGNATURE' };

  return { ok: true };
}

/** ORION Level 3 bridge. Behaviour unchanged from before the generalisation. */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureResult {
  return verifySignatureWithSecret(
    integrationSecret(),
    rawBody,
    signatureHeader,
    timestampHeader,
    nowSeconds,
  );
}

/** Level 1 bridge. */
export function verifyLevel1Signature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureResult {
  return verifySignatureWithSecret(
    level1IntegrationSecret(),
    rawBody,
    signatureHeader,
    timestampHeader,
    nowSeconds,
  );
}
