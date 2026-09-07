const { requireAdmin } = require("../../../lib/requireAdmin");
const { transitionEventState, getEventStatus } = require("../../../lib/eventClock");
const { setConfig } = require("../../../lib/config");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  try {
    const action = String(req.body?.action || req.body?.state || "").toLowerCase().trim();
    const durationMinutes = req.body?.durationMinutes;

    if (durationMinutes && !isNaN(Number(durationMinutes))) {
      const minutes = Math.max(1, parseInt(durationMinutes, 10));
      await setConfig("event_duration_minutes", String(minutes));
    }

    if (action) {
      const validActions = ["open", "start", "pause", "resume", "end", "reset"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: "invalid_action", message: `Action must be one of: ${validActions.join(", ")}` });
      }
      await transitionEventState(action);
    }

    const event = await getEventStatus();
    return res.status(200).json({ ok: true, event });
  } catch (err) {
    console.error("[API ERROR] /api/admin/set-state:", err.message);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
}
