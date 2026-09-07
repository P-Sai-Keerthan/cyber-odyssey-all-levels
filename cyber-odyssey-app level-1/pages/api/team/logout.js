const { clearCookie } = require("../../../lib/cookies");

// Deliberately simple: just wipes the session cookie. Nothing about a
// team's stage or answers lives in the cookie itself (it's just the
// lookup key), so logging out and back in with the same code picks up
// exactly where the crew left off — this only ends the browser session,
// not the run.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  clearCookie(res, "sb_team");
  res.status(200).json({ ok: true });
};
