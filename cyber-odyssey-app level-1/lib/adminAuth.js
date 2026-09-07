const crypto = require("crypto");

// Deliberately simple: this event runs for 45 minutes, once, for one
// organizer. A signed cookie (HMAC over an expiry timestamp) is enough to
// stop someone from guessing or forging admin access by hand-editing a
// cookie value in devtools, without pulling in a full auth library for a
// one-shot tool.
const { sessionSecret } = require("./sessionSecret");
const COOKIE_NAME = "sb_admin";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — long enough to cover a whole event day

function sign(payload) {
  const h = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${h}`;
}

function makeAdminCookieValue() {
  const expires = Date.now() + TTL_MS;
  return sign(String(expires));
}

function isValidAdminCookieValue(value) {
  if (!value) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const ok =
    expected.length === value.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value));
  if (!ok) return false;
  return Number(payload) > Date.now();
}

module.exports = { COOKIE_NAME, makeAdminCookieValue, isValidAdminCookieValue };
