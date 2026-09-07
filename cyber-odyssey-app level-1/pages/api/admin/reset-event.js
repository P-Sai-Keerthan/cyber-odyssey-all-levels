const { requireAdmin } = require("../../../lib/requireAdmin");
const { setConfig } = require("../../../lib/config");
const { resetAllProgress } = require("../../../lib/teams");

// Testing/dev-only escape hatch: clears the event clock AND wipes every
// team's progress back to a brand-new pre-event state, so an organizer
// can run through a full dry run and then reset for the next one without
// touching the database by hand. This is the fix for "the event ended and I
// can't restart it" — /api/admin/start-event refuses to move the clock
// once it's set (on purpose, so it can't be bumped mid-event), and there
// was previously no route that could clear it back to unset.
//
// Deliberately requires the literal confirmation string in the body
// rather than trusting a checkbox the client could send regardless of
// what the person actually clicked — the double confirmation (this,
// plus the admin UI's own type-to-confirm field) is what keeps this from
// ever firing by accident.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  if (req.body?.confirm !== "RESET") {
    return res.status(400).json({ error: "confirmation_required" });
  }

  await setConfig("event_start_at", "");
  await setConfig("event_state", "not_started");
  await setConfig("event_paused_at", "");
  await setConfig("event_paused_ms", "0");
  await resetAllProgress();

  res.status(200).json({ ok: true });
};
