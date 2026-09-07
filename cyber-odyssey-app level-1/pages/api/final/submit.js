const { recordFinalAttempt } = require("../../../lib/teams");
const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { getConfig } = require("../../../lib/config");
const { getEventStatus } = require("../../../lib/eventClock");
const { computeFinalAnswer } = require("../../../lib/finalLock");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // PLATFORM AUTH — see the note in pages/api/chat.js. Beyond the impersonation
  // this allowed, the unverified read also exposed config.round2_address (the
  // Round 2 location) to anyone holding a team code. The Great Bow puzzle itself
  // (lib/finalLock.js) is unchanged.
  const team = await getAuthenticatedTeam(req);
  if (!team) return res.status(401).json({ error: "not_logged_in" });
  const code = team.code;

  const event = await getEventStatus();
  if (event.phase !== "running") {
    return res.status(403).json({ error: event.phase === "not_started" ? "not_started" : "event_ended" });
  }

  if (!team.stage2CompletedAt) return res.status(403).json({ error: "stage2_not_done" });

  if (team.finalCompletedAt) {
    const address = await getConfig("round2_address");
    return res.status(200).json({ correct: true, alreadyDone: true, address });
  }

  const answer = String(req.body?.answer || "").trim().toUpperCase();
  const [stage1Code, secretWord] = await Promise.all([
    getConfig("stage1_code"),
    getConfig("stage2_secret_word"),
  ]);
  const expected = computeFinalAnswer(stage1Code, secretWord);
  const correct = answer === expected;

  await recordFinalAttempt(code, correct);

  if (!correct) {
    return res.status(200).json({ correct: false, message: "The seal doesn't budge. Check the shift." });
  }

  const address = await getConfig("round2_address");
  res.status(200).json({ correct: true, address });
};
