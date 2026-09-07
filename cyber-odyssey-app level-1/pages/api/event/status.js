const { getEventStatus } = require("../../../lib/eventClock");

// Public (no team login needed) so the landing page can show "doors open
// at..." / a live countdown before anyone has entered a team code. Nothing
// sensitive in an event-status payload — just phase and timestamps.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const event = await getEventStatus();
    return res.status(200).json({ event });
  } catch (err) {
    console.error("[API ERROR] /api/event/status:", err.message);
    return res.status(200).json({
      event: {
        phase: "not_started",
        startAt: null,
        endAt: null,
        msRemaining: 45 * 60 * 1000,
        durationMinutes: 45,
      },
    });
  }
}

