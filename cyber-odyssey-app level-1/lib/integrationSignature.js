const crypto = require("crypto");

/**
 * Server-to-server request signing for the Cyber Odyssey Portal bridge.
 *
 * ---------------------------------------------------------------------------
 * THIS MUST MATCH THE PORTAL BYTE FOR BYTE
 * ---------------------------------------------------------------------------
 * The Portal verifies with src/lib/integration/hmac.ts. Two independent
 * implementations of the same scheme is exactly the arrangement that drifts
 * silently — a different string join, a different encoding, a re-serialised body
 * — and the failure mode is a 401 that looks like a wrong secret.
 *
 * The contract, in full:
 *
 *   signed material : `${timestamp}.${rawBody}`   (UTF-8)
 *   algorithm       : HMAC-SHA256
 *   encoding        : lowercase hex
 *   header value    : `sha256=<hex>`
 *   headers         : x-odyssey-signature, x-odyssey-timestamp
 *   timestamp       : Unix SECONDS as a decimal string
 *   skew window     : ±300 s, enforced by the Portal
 *
 * scripts/test-integration.js pins a fixed vector (known secret, known timestamp,
 * known body -> known signature) and the Portal's tests/level1-integration.test.ts
 * pins the SAME vector. If either side drifts, one of those two suites fails
 * before anyone deploys.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RAW BODY STRING, NOT AN OBJECT
 * ---------------------------------------------------------------------------
 * The signature covers the exact bytes sent. Signing an object and serialising it
 * separately means signing one encoding and transmitting another — key order and
 * whitespace differ between JSON writers, and any such gap is a signature bypass
 * waiting to be found. Callers build the string once and send that same string.
 */

const SIGNATURE_HEADER = "x-odyssey-signature";
const TIMESTAMP_HEADER = "x-odyssey-timestamp";

/**
 * The shared secret, or null when unset.
 *
 * Null disables the bridge rather than falling back to a default. A default
 * secret in source would be public, and a public secret on this bridge means
 * anyone can award points to any squad. Read at call time so a restarted process
 * picks up the current environment.
 */
function integrationSecret() {
  const value = process.env.ODYSSEY_LEVEL1_SECRET;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

/** `sha256=<hex>` over `${timestamp}.${rawBody}`. */
function signBody(secret, rawBody, timestamp) {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `sha256=${mac}`;
}

/**
 * Builds the headers for one signed request.
 *
 * Returns null when the bridge is not configured, so callers fail closed and can
 * say so plainly rather than sending an unsigned request that will be refused
 * with a misleading 401.
 */
function signedHeaders(rawBody, nowMs = Date.now()) {
  const secret = integrationSecret();
  if (!secret) return null;

  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    "content-type": "application/json",
    [SIGNATURE_HEADER]: signBody(secret, rawBody, timestamp),
    [TIMESTAMP_HEADER]: timestamp,
  };
}

module.exports = {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  integrationSecret,
  signBody,
  signedHeaders,
};
