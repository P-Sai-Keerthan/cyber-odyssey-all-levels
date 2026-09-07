const { requireAdmin } = require("../../../lib/requireAdmin");
const { resetTeamProgress, getTeamByCode } = require("../../../lib/teams");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  try {
    const code = req.body?.code;
    const teamId = req.body?.teamId;

    const identifier = code || teamId;
    if (!identifier) {
      return res.status(400).json({ error: "missing_team", message: "Provide a team code or teamId to reset." });
    }

    const team = await resetTeamProgress(identifier);
    if (!team) {
      return res.status(404).json({ error: "team_not_found", message: "Target team was not found." });
    }

    return res.status(200).json({ ok: true, message: `Team ${team.name} (${team.code}) reset successfully.`, team });
  } catch (err) {
    console.error("[API ERROR] /api/admin/reset-team:", err.message);
    return res.status(500).json({ error: "server_error", message: "Failed to reset team progress." });
  }
}
