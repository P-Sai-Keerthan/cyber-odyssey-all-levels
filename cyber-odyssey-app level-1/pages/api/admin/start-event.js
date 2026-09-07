const { requireAdmin } = require("../../../lib/requireAdmin");
const { transitionEventState, getEventStatus } = require("../../../lib/eventClock");
const { getConfig } = require("../../../lib/config");

// Sets the ONE synchronized clock every team's countdown reads from. Call
// this once, right when you want the 45 minutes to begin for everyone.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  const already = await getConfig("event_start_at");
  if (already && req.body?.force !== true) {
    return res.status(409).json({ error: "already_started", startedAt: already });
  }

  const result = await transitionEventState("open");
  const event = await getEventStatus();
  res.status(200).json({ ok: true, startedAt: result.startAt, event });
};

