const crypto = require("crypto");
const { getConfig } = require("../../../lib/config");
const { setCookie } = require("../../../lib/cookies");
const { COOKIE_NAME, makeAdminCookieValue } = require("../../../lib/adminAuth");
const { clientAddress, check, recordFailure, recordSuccess } = require("../../../lib/rateLimit");

/**
 * Level 1 admin sign-in.
 *
 * ---------------------------------------------------------------------------
 * THE HARDCODED PASSWORD IS GONE
 * ---------------------------------------------------------------------------
 * This route used to end its lookup with a literal:
 *
 *     process.env.ADMIN_PASSWORD || (await getConfig("admin_password")) || "iamtheboss@6666"
 *
 * so an unconfigured deployment accepted a password that is written in the
 * source. The admin console can start and stop the event, advance its state,
 * reset a team and reset the whole event, and participants are on the same
 * network as this application by design. A default credential here is a
 * one-line path from "read the repository" to "end everyone's run".
 *
 * There is now no default. If neither the environment nor the database config
 * carries an admin password, this route refuses every attempt and says so as an
 * operator problem — which is what it is. Failing closed costs an organiser a
 * clear error at setup; failing open costs the event.
 *
 * ---------------------------------------------------------------------------
 * THROTTLING
 * ---------------------------------------------------------------------------
 * There was no limit on attempts, and an event password is typically short
 * enough to guess given unlimited tries over a LAN. Attempts are now counted per
 * client address with a lockout, which is a real control for the single-process
 * deployment this application actually has.
 *
 * The counters live in lib/rateLimit.js, shared with the team login so there is
 * one implementation of "too many attempts" rather than two that drift. Its
 * in-memory limitation is documented there.
 */

/** Constant-time comparison that does not leak the expected length. */
function matches(supplied, expected) {
  // Hashing first makes both buffers the same size, so an attacker cannot learn
  // the password's length from whether the comparison ran at all.
  const a = crypto.createHash("sha256").update(String(supplied), "utf8").digest();
  const b = crypto.createHash("sha256").update(String(expected), "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");

  const key = clientAddress(req);

  const throttle = check("admin", key);
  if (throttle.locked) {
    res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
    return res.status(429).json({
      error: "too_many_attempts",
      message: `Too many failed attempts. Try again in ${Math.ceil(throttle.retryAfterSeconds / 60)} minute(s).`,
    });
  }

  try {
    const configured =
      String(process.env.ADMIN_PASSWORD || "").trim() ||
      String((await getConfig("admin_password")) || "").trim();

    if (!configured) {
      // Not a participant's problem and not a wrong password — say so plainly so
      // an organiser fixes the configuration instead of guessing at credentials.
      console.error(
        "[admin] No admin password configured. Set ADMIN_PASSWORD in .env (or the " +
          "admin_password config row) before the event. Admin sign-in is refused until then.",
      );
      return res.status(503).json({
        error: "not_configured",
        message:
          "Level 1 admin access has not been configured on this host. " +
          "This is a setup issue — tell the event operations desk.",
      });
    }

    const password = String(req.body?.password || "");
    if (!password || !matches(password, configured)) {
      recordFailure("admin", key);
      return res.status(401).json({ error: "Wrong password." });
    }

    recordSuccess("admin", key);
    setCookie(res, COOKIE_NAME, makeAdminCookieValue(), { maxAgeSeconds: 12 * 60 * 60 });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[API ERROR] /api/admin/login:", err.message);
    return res
      .status(500)
      .json({ error: "server_error", message: "An error occurred during admin authentication." });
  }
}
