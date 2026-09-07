const { signedHeaders } = require("./integrationSignature");

/**
 * HTTP client for the Cyber Odyssey Portal integration bridge.
 *
 * Two calls, both server-to-server, both signed:
 *
 *   redeemTicket  — exchange a one-time entry ticket for squad identity.
 *   sendEvent     — report a verified result or a hint unlock.
 *
 * Neither carries a credential and neither carries a score. The Portal resolves
 * the squad from the reference and prices the event from its own catalogue; this
 * side reports only WHAT happened, never what it is worth.
 */

/**
 * Portal origin, e.g. https://portal.example.org. No trailing slash, no path.
 * No default — an unset value disables the bridge rather than pointing at
 * somewhere that is probably wrong.
 */
function portalBaseUrl() {
  const value = process.env.PORTAL_BASE_URL;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

/** How long to wait on the Portal before treating a call as failed. */
const REQUEST_TIMEOUT_MS = Number(process.env.PORTAL_TIMEOUT_MS || "8000");

/**
 * Sends one signed request.
 *
 * Returns a plain result object rather than throwing on an HTTP error: the
 * outbox needs to distinguish "the Portal said no, permanently" from "the Portal
 * could not be reached", and an exception flattens that distinction.
 *
 * `retryable` is the outbox's decision input. A 5xx or a network failure is worth
 * retrying; a 4xx is the Portal telling us something about the event itself that
 * will be just as true in five minutes.
 */
async function postSigned(path, payload) {
  const base = portalBaseUrl();
  if (!base) {
    return { ok: false, retryable: false, status: 0, code: "PORTAL_URL_UNSET", body: null };
  }

  // Serialise ONCE. The bytes that are signed must be the bytes that are sent.
  const rawBody = JSON.stringify(payload);
  const headers = signedHeaders(rawBody);
  if (!headers) {
    return { ok: false, retryable: false, status: 0, code: "SECRET_UNSET", body: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    });

    let body = null;
    try {
      body = await res.json();
    } catch {
      // A non-JSON body from a proxy or an error page. The status still decides.
    }

    return {
      ok: res.ok,
      // 408 and 429 are the two 4xx codes that mean "try again", not "no".
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      status: res.status,
      code: (body && body.code) || null,
      body,
    };
  } catch (err) {
    // Network failure, DNS failure, or our own timeout. All worth retrying.
    return {
      ok: false,
      retryable: true,
      status: 0,
      code: err.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
      body: null,
      error: err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchanges a one-time entry ticket for the squad's identity.
 *
 * `requestId` and `nonce` are fresh per call: unlike a score event, a session
 * redemption is never idempotently replayable, so there is nothing to retry with
 * the same ids. A failed redemption means the participant clicks Enter again and
 * the Portal mints a new ticket.
 */
async function redeemTicket(ticket, { requestId, nonce }) {
  return postSigned("/api/integration/level1/session", { requestId, nonce, ticket });
}

/**
 * Reports one verified result or hint unlock.
 *
 * `eventId` is STABLE across retries — it is the idempotency key, generated once
 * when the event is enqueued. `nonce` is fresh per HTTP attempt. That pairing is
 * what lets the Portal absorb a redelivery as success while still refusing a
 * replayed request; see the IntegrationEvent notes on the Portal side.
 */
async function sendEvent(payload) {
  return postSigned("/api/integration/level1/score", payload);
}

module.exports = { portalBaseUrl, postSigned, redeemTicket, sendEvent };
