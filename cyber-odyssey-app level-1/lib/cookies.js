const crypto = require("crypto");
const { sessionSecret } = require("./sessionSecret");

function signTeamCookie(code) {
  const hmac = crypto.createHmac("sha256", sessionSecret()).update(code).digest("hex");
  return `${code}.${hmac}`;
}

function getTeamCodeFromCookie(cookieVal) {
  if (!cookieVal) return null;
  const dotIdx = cookieVal.lastIndexOf(".");
  if (dotIdx === -1) {
    // Require valid HMAC signature on all cookies to prevent tampering/spoofing
    return null;
  }
  const code = cookieVal.slice(0, dotIdx);
  const sig = cookieVal.slice(dotIdx + 1);
  const expected = crypto.createHmac("sha256", sessionSecret()).update(code).digest("hex");
  if (sig.length !== expected.length) return null;
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return valid ? code : null;
}

// Next.js Pages API routes parse incoming cookies into req.cookies for you,
// but writing one back out is just a raw Set-Cookie header — this is the
// small helper for that half.
function setCookie(res, name, value, { maxAgeSeconds } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  // Only append Secure if not on plain HTTP localhost / development
  const portalUrl = process.env.PORTAL_BASE_URL || "";
  const isLocalHttp = portalUrl.startsWith("http://localhost") || portalUrl.startsWith("http://127.0.0.1");
  const useSecure = process.env.NODE_ENV === "production" && !isLocalHttp && process.env.DISABLE_SECURE_COOKIES !== "true";
  if (useSecure) parts.push("Secure");
  if (maxAgeSeconds) parts.push(`Max-Age=${maxAgeSeconds}`);

  const existing = res.getHeader("Set-Cookie");
  const cookieStr = parts.join("; ");
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieStr]);
  } else if (existing) {
    res.setHeader("Set-Cookie", [existing, cookieStr]);
  } else {
    res.setHeader("Set-Cookie", cookieStr);
  }
}

function clearCookie(res, name) {
  setCookie(res, name, "", { maxAgeSeconds: 0 });
}

module.exports = { setCookie, clearCookie, signTeamCookie, getTeamCodeFromCookie };
