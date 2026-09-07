const { requireAdmin } = require("../../../lib/requireAdmin");
const { setAdvanced } = require("../../../lib/teams");

// Flips the "advanced" flag for a team that didn't fully escape but is
// being let through anyway under the ranked pass-forward rule. Purely a
// record-keeping flag for you — see README.md for how to actually notify
// that team of the Round 2 address.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  const code = String(req.body?.code || "").trim().toUpperCase();
  const advanced = Boolean(req.body?.advanced);
  if (!code) return res.status(400).json({ error: "code required" });

  const team = await setAdvanced(code, advanced);
  if (!team) return res.status(404).json({ error: "team not found" });

  res.status(200).json({ ok: true, team });
};
