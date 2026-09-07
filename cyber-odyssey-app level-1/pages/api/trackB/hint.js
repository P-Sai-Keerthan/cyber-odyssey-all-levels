const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { recordHintUsed, getTrackAnswers } = require("../../../lib/teams");
const { getEventStatus } = require("../../../lib/eventClock");
const { QUESTIONS } = require("../../../lib/trackB");
const { enqueueHint, maybeDrain } = require("../../../lib/outbox");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const team = await getAuthenticatedTeam(req);
    if (!team) return res.status(401).json({ error: "not_logged_in" });

    const event = await getEventStatus();
    if (event.phase !== "running") {
      return res.status(403).json({ error: event.phase === "not_started" ? "not_started" : "event_ended" });
    }

    if (!team.stage1CompletedAt) {
      return res.status(403).json({ error: "track_locked", message: "Track A must be completed before accessing Track B." });
    }

    const questionCode = String(req.body?.questionCode || "").toUpperCase();
    const question = QUESTIONS[questionCode];
    if (!question) return res.status(400).json({ error: "unknown_question" });

    const existing = await getTrackAnswers(team.id, questionCode);
    if (existing[0]?.correct) {
      return res.status(200).json({ hint: question.hint, alreadySolved: true });
    }

    await recordHintUsed(team.id, questionCode);

    // Report the deduction. Enqueue is idempotent on (team, question, type,
    // hintNumber), so a second Unlock press costs nothing here and, because the
    // Portal's Level1Penalty carries the same unique key, nothing there either.
    await enqueueHint(team, questionCode, 1).catch((err) =>
      console.error("[OUTBOX] hint enqueue failed (will be repaired by reconcile):", err.message)
    );
    maybeDrain();

    return res.status(200).json({ hint: question.hint, alreadySolved: false });
  } catch (err) {
    console.error("Track B hint error:", err);
    return res.status(500).json({ error: "server_error", message: "Failed to reveal hint" });
  }
}
