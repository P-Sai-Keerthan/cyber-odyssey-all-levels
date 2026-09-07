const { requireAdmin } = require("../../../lib/requireAdmin");
const { getAllConfig, setConfig } = require("../../../lib/config");

// The knobs an organizer might reasonably want to change without touching
// the database directly: the two puzzle answers, the Round 2 address, and
// the event length. (event_start_at is deliberately not editable here —
// use /api/admin/start-event so the clock only ever moves forward.)
const EDITABLE_KEYS = ["stage1_code", "stage2_secret_word", "round2_address", "event_duration_minutes"];

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    const cfg = await getAllConfig();
    const editable = {};
    for (const key of EDITABLE_KEYS) editable[key] = cfg[key];
    return res.status(200).json({ config: editable });
  }

  if (req.method === "POST") {
    const updates = req.body || {};
    for (const key of Object.keys(updates)) {
      if (!EDITABLE_KEYS.includes(key)) continue;
      // eslint-disable-next-line no-await-in-loop
      await setConfig(key, updates[key]);
    }
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
};
