const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { recordTrackAttempt, getTrackAnswers, markStage1Complete, incrementTrackAttempts } = require("../../../lib/teams");
const { getEventStatus } = require("../../../lib/eventClock");
const { QUESTIONS, QUESTION_ORDER, MAX_ATTEMPTS, checkAnswer } = require("../../../lib/trackA");
const { enqueueSolve, maybeDrain } = require("../../../lib/outbox");

// Never trust the client: the browser sends { questionCode, answer,
// evidence } and nothing else. Which question that code maps to, how many
// points it's worth, and whether the answer is right are all decided here
// server-side from lib/trackA.js — a team can't submit a forged
// "questionCode": "A3", "correct": true payload and have it stick.
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

    const questionCode = String(req.body?.questionCode || "").toUpperCase();
    const question = QUESTIONS[questionCode];
    if (!question) return res.status(400).json({ error: "unknown_question" });

    const priorAnswers = await getTrackAnswers(team.id, questionCode);
    const priorCorrect = Boolean(priorAnswers[0]?.correct);
    const priorLocked = !priorCorrect && (priorAnswers[0]?.attempts || 0) >= MAX_ATTEMPTS;

    // Track-level attempt enforcement: exactly 3 attempts per track
    if ((team.trackAAttempts || 0) >= MAX_ATTEMPTS || priorLocked) {
      return res.status(200).json({
        correct: false,
        alreadyDone: priorCorrect,
        locked: true,
        attemptsRemaining: 0,
        pointsAwarded: 0,
        attempts: MAX_ATTEMPTS,
        trackComplete: true,
        message: `Locked — your crew used all ${MAX_ATTEMPTS} attempts on Track A.`,
      });
    }

    const answer = String(req.body?.answer || "").trim();
    const evidence = String(req.body?.evidence || "").trim().slice(0, 1000);
    const correct = answer.length > 0 && checkAnswer(questionCode, answer);

    // If incorrect and not already solved, increment track A attempts
    let currentTrackAttempts = team.trackAAttempts || 0;
    if (!correct && !priorCorrect) {
      currentTrackAttempts = await incrementTrackAttempts(team.id, "A");
    }

    // recordTrackAttempt enforces question-level record
    const result = await recordTrackAttempt(team.id, questionCode, {
      correct,
      points: question.points,
      evidence,
      maxAttempts: MAX_ATTEMPTS,
    });

    const locked = !result.correct && (result.attempts >= MAX_ATTEMPTS || currentTrackAttempts >= MAX_ATTEMPTS);

    // Report the solve to the Portal. Queued, not sent — see lib/outbox.js.
    // Enqueue is idempotent on (team, question, type), so calling it on every
    // correct submission is harmless: only the first ever creates a row. The
    // Portal prices it from its own catalogue; nothing about points travels here.
    if (result.correct) {
      await enqueueSolve(team, questionCode, result.firstCorrectAt).catch((err) =>
        console.error("[OUTBOX] enqueue failed (will be repaired by reconcile):", err.message)
      );
      maybeDrain();
    }

    // A question counts as "resolved" once a team either solves it or burns
    // all 3 attempts. Track A is "cleared" once all questions in QUESTION_ORDER
    // are resolved or track attempts exhausted.
    const all = await getTrackAnswers(team.id, "A");
    const resolved = (qc) => {
      const row = all.find((a) => a.questionCode === qc);
      if (!row) return false;
      return row.correct || row.attempts >= MAX_ATTEMPTS;
    };
    const trackResolved = currentTrackAttempts >= MAX_ATTEMPTS || QUESTION_ORDER.every(resolved);

    let trackComplete = Boolean(team.stage1CompletedAt);
    if (trackResolved && !team.stage1CompletedAt) {
      await markStage1Complete(team.code);
      trackComplete = true;
    }

    return res.status(200).json({
      correct: result.correct,
      alreadyDone: priorCorrect,
      locked,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - result.attempts),
      pointsAwarded: result.pointsAwarded,
      attempts: result.attempts,
      trackComplete: trackComplete || trackResolved,
      message: priorCorrect
        ? "Already confirmed for your crew."
        : priorLocked
        ? `This one's locked — your crew used all ${MAX_ATTEMPTS} attempts.`
        : result.correct
        ? "Confirmed — that checks out."
        : locked
        ? `Wrong, and that was attempt ${MAX_ATTEMPTS} — this question is now locked. Move on to the others.`
        : "Not quite. Re-read the header block closely and try again.",
    });
  } catch (err) {
    console.error("Track A submit error:", err);
    return res.status(500).json({ error: "server_error", message: "Failed to submit answer" });
  }
}
