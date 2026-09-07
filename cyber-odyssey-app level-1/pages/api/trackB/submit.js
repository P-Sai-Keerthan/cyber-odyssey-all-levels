const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { recordTrackAttempt, getTrackAnswers, markTrackBComplete, incrementTrackAttempts } = require("../../../lib/teams");
const { getEventStatus } = require("../../../lib/eventClock");
const { QUESTIONS, QUESTION_ORDER, MAX_ATTEMPTS, HINT_PENALTY, checkAnswer } = require("../../../lib/trackB");
const { enqueueSolve, maybeDrain } = require("../../../lib/outbox");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const team = await getAuthenticatedTeam(req);
    if (!team) return res.status(401).json({ error: "not_logged_in" });

    const event = await getEventStatus();
    if (event.phase !== "running") {
      return res.status(403).json({
        error: event.phase === "paused" ? "event_paused" : (event.phase === "not_started" ? "not_started" : "event_ended"),
        message: event.phase === "paused" ? "Event is paused. Submissions are temporarily held." : undefined,
      });
    }

    if (!team.stage1CompletedAt) {
      return res.status(403).json({ error: "track_locked", message: "Track A must be completed before accessing Track B." });
    }

    const questionCode = String(req.body?.questionCode || "").toUpperCase();
    const question = QUESTIONS[questionCode];
    if (!question) return res.status(400).json({ error: "unknown_question" });

    const priorAnswers = await getTrackAnswers(team.id, questionCode);
    const priorRow = priorAnswers[0];
    const priorCorrect = Boolean(priorRow?.correct);
    const priorLocked = !priorCorrect && (priorRow?.attempts || 0) >= MAX_ATTEMPTS;

    // Track-level attempt enforcement: exactly 3 attempts per track
    if ((team.trackBAttempts || 0) >= MAX_ATTEMPTS || priorLocked) {
      return res.status(200).json({
        correct: false,
        alreadyDone: priorCorrect,
        locked: true,
        attemptsRemaining: 0,
        pointsAwarded: 0,
        attempts: MAX_ATTEMPTS,
        trackComplete: true,
        message: `Locked — your crew used all ${MAX_ATTEMPTS} attempts on Track B.`,
      });
    }

    const answer = String(req.body?.answer || "").trim();
    const evidence = String(req.body?.evidence || "").trim().slice(0, 1000);
    const correct = answer.length > 0 && checkAnswer(questionCode, answer);

    const hintUsed = Boolean(priorRow?.hintUsed);
    const effectivePoints = hintUsed ? Math.max(0, question.points - HINT_PENALTY) : question.points;

    // If incorrect and not already solved, increment track B attempts
    let currentTrackAttempts = team.trackBAttempts || 0;
    if (!correct && !priorCorrect) {
      currentTrackAttempts = await incrementTrackAttempts(team.id, "B");
    }

    const result = await recordTrackAttempt(team.id, questionCode, {
      correct,
      points: effectivePoints,
      evidence,
      maxAttempts: MAX_ATTEMPTS,
    });

    const locked = !result.correct && (result.attempts >= MAX_ATTEMPTS || currentTrackAttempts >= MAX_ATTEMPTS);

    // Report the solve. Only the SOLVE is reported here — the hint deduction is a
    // separate event, queued when the hint is unlocked (pages/api/trackB/hint.js),
    // because a squad can buy a hint for a question it never solves. The Portal
    // charges its own penalty value; the locally-reduced `effectivePoints` above
    // is Level 1's own display figure and never crosses the bridge.
    if (result.correct) {
      await enqueueSolve(team, questionCode, result.firstCorrectAt).catch((err) =>
        console.error("[OUTBOX] enqueue failed (will be repaired by reconcile):", err.message)
      );
      maybeDrain();
    }

    const all = await getTrackAnswers(team.id, "B");
    const resolved = (qc) => {
      const row = all.find((a) => a.questionCode === qc);
      if (!row) return false;
      return row.correct || row.attempts >= MAX_ATTEMPTS;
    };
    const trackResolved = currentTrackAttempts >= MAX_ATTEMPTS || QUESTION_ORDER.every(resolved);

    let trackComplete = Boolean(team.trackbCompletedAt);
    if (trackResolved && !team.trackbCompletedAt) {
      await markTrackBComplete(team.code);
      trackComplete = true;
    }

    return res.status(200).json({
      correct: result.correct,
      alreadyDone: priorCorrect,
      locked,
      hintUsed,
      pointsAwarded: result.pointsAwarded,
      attempts: result.attempts,
      trackComplete: trackComplete || trackResolved,
      message: priorCorrect
        ? "Already confirmed for your crew."
        : priorLocked
        ? `This one's locked — your crew used all ${MAX_ATTEMPTS} attempts.`
        : result.correct
        ? hintUsed
          ? `Confirmed — that checks out. (${HINT_PENALTY}pt hint penalty applied.)`
          : "Confirmed — that checks out."
        : locked
        ? `Wrong, and that was attempt ${MAX_ATTEMPTS} — this question is now locked. Move on to the others.`
        : "Not quite. Decode it again and double-check the field.",
    });
  } catch (err) {
    console.error("Track B submit error:", err);
    return res.status(500).json({ error: "server_error", message: "Failed to submit answer" });
  }
}
