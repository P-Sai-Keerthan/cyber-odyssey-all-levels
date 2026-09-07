const { markStage2Complete } = require("../../../lib/teams");
const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { getConfig } = require("../../../lib/config");
const { getEventStatus } = require("../../../lib/eventClock");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // PLATFORM AUTH — see the note in pages/api/chat.js. This route read the raw
  // cookie without verifying its HMAC, which both broke it for legitimate users
  // and accepted a bare unsigned team code from anyone. The secret word itself
  // (config.stage2_secret_word) and the way it is checked are unchanged.
  const team = await getAuthenticatedTeam(req);
  if (!team) return res.status(401).json({ error: "not_logged_in" });
  const code = team.code;

  const event = await getEventStatus();
  if (event.phase !== "running") {
    return res.status(403).json({ error: event.phase === "not_started" ? "not_started" : "event_ended" });
  }

  if (!team.stage1CompletedAt) return res.status(403).json({ error: "stage1_not_done" });

  if (team.stage2CompletedAt) {
    return res.status(200).json({ correct: true, alreadyDone: true });
  }

  const word = String(req.body?.word || "").trim().toUpperCase();
  const expected = await getConfig("stage2_secret_word");
  const correct = word === String(expected).trim().toUpperCase();

  if (correct) {
    await markStage2Complete(code);
  }

  res.status(200).json({
    correct,
    message: correct
      ? "That's the word. The boulder grinds aside — the cave mouth is open."
      : "Not quite what he said. Keep working him.",
  });
};
