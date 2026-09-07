const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { getEventStatus } = require("../../../lib/eventClock");
const { TOKEN } = require("../../../lib/trackB");

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const team = await getAuthenticatedTeam(req);
    if (!team) return res.status(401).json({ error: "not_logged_in" });

    const event = await getEventStatus();
    if (event.phase === "not_started") return res.status(403).json({ error: "not_started" });

    if (!team.stage1CompletedAt) {
      return res.status(403).json({ error: "track_locked", message: "Track A must be completed before accessing Track B." });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(TOKEN);
  } catch (err) {
    console.error("Track B evidence error:", err);
    return res.status(500).json({ error: "server_error", message: "Failed to load evidence" });
  }
}
