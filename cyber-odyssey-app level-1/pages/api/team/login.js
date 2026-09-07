const { authenticateTeam } = require("../../../lib/teams");
const { setCookie, signTeamCookie } = require("../../../lib/cookies");
const { clientAddress, check, recordFailure, recordSuccess } = require("../../../lib/rateLimit");

/**
 * Level 1 team sign-in.
 *
 * ---------------------------------------------------------------------------
 * THROTTLING
 * ---------------------------------------------------------------------------
 * This endpoint had no limit on attempts. Team names are enumerable and
 * `authenticateTeam` accepts a name as readily as a code, so an unlimited
 * guessing loop against a known list of squads was the obvious way in.
 *
 * Two counters, deliberately:
 *
 *   (address + team) — a brute-force against ONE squad locks only that pairing,
 *                      so it cannot be used to lock a rival crew out of the event.
 *   (address)        — a much looser ceiling that catches someone spraying many
 *                      squads from one machine.
 *
 * Both are sized for a venue behind a single NAT: a crew retyping its own
 * password is nowhere near either limit. See lib/rateLimit.js.
 *
 * The response for a wrong name and a wrong password is identical, so the
 * endpoint does not confirm which squads exist. Passwords are never logged.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const teamName = String(req.body?.teamName || req.body?.name || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!teamName || !password) {
      return res.status(400).json({ error: "Please enter your team name and team password." });
    }

    const address = clientAddress(req);
    // Case-folded so "crew 01" and "Crew 01" share one counter rather than
    // giving an attacker a fresh allowance per capitalisation.
    const pairKey = `${address}|${teamName.toLowerCase()}`;

    const perTeam = check("team", pairKey);
    const perAddress = check("teamAddress", address);
    const blocked = perTeam.locked ? perTeam : perAddress.locked ? perAddress : null;

    if (blocked) {
      const minutes = Math.max(1, Math.ceil(blocked.retryAfterSeconds / 60));
      res.setHeader("Retry-After", String(blocked.retryAfterSeconds));
      return res.status(429).json({
        error: `Too many sign-in attempts. Try again in ${minutes} minute(s), or ask an event marshal.`,
        code: "too_many_attempts",
      });
    }

    const team = await authenticateTeam(teamName, password);
    if (!team) {
      recordFailure("team", pairKey);
      recordFailure("teamAddress", address);
      // One message for both "no such team" and "wrong password": telling them
      // apart would turn this endpoint into a squad directory.
      return res.status(401).json({ error: "Invalid team name or password." });
    }

    recordSuccess("team", pairKey);
    recordSuccess("teamAddress", address);

    // 8 hours: signed with HMAC-SHA256 to prevent tampering
    const signedValue = signTeamCookie(team.code);
    setCookie(res, "sb_team", signedValue, { maxAgeSeconds: 8 * 60 * 60 });
    return res.status(200).json({ ok: true, team: { name: team.name, code: team.code } });
  } catch (err) {
    console.error("[API ERROR] /api/team/login:", err.message);
    const isDbError =
      err.code ||
      err.message?.includes("database") ||
      err.message?.includes("connect") ||
      err.message?.includes("relation") ||
      err.message?.includes("ECONNREFUSED") ||
      err.message?.includes("timeout");

    if (isDbError) {
      return res.status(503).json({
        error: "Database service is temporarily unavailable. Please contact the administrator.",
        code: "database_unavailable",
      });
    }

    return res
      .status(500)
      .json({ error: "A server error occurred. Please try again.", code: "server_error" });
  }
}
