const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { recordTrackAttempt, getTrackAnswers, markTrackCComplete, incrementTrackAttempts } = require("../../../lib/teams");
const { getEventStatus } = require("../../../lib/eventClock");
const { verifyChain, verifyVolatility, verifyC3, MAX_ATTEMPTS } = require("../../../lib/trackC");
const { enqueueSolve, maybeDrain } = require("../../../lib/outbox");

/**
 * Reports a Track C solve to the Portal. Shared by C1/C2/C3, which are otherwise
 * three near-identical blocks; putting the reporting in one place means a fourth
 * challenge cannot be added with the bridge call quietly missing.
 */
async function reportSolve(team, challengeCode, attemptResult) {
  if (!attemptResult || !attemptResult.correct) return;
  await enqueueSolve(team, challengeCode, attemptResult.firstCorrectAt).catch((err) =>
    console.error("[OUTBOX] enqueue failed (will be repaired by reconcile):", err.message)
  );
  maybeDrain();
}

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

    // Progression gating: Track B must be completed before Track C
    if (!team.trackbCompletedAt) {
      return res.status(403).json({ error: "track_locked", message: "Track B must be completed before accessing Track C." });
    }

    // Track-level attempt enforcement: exactly 3 attempts per track
    if ((team.trackCAttempts || 0) >= MAX_ATTEMPTS) {
      return res.status(200).json({
        valid: false,
        locked: true,
        attempts: MAX_ATTEMPTS,
        maxAttempts: MAX_ATTEMPTS,
        message: `Locked — your crew used all ${MAX_ATTEMPTS} attempts on Track C.`,
      });
    }

    const challenge = String(req.body?.challenge || "C1").toUpperCase();

    async function isTrackCResolved() {
      const answers = await getTrackAnswers(team.id, "C");
      const isRes = (ch) => {
        const row = answers.find((a) => a.questionCode === ch);
        return row?.correct || (row?.attempts || 0) >= MAX_ATTEMPTS;
      };
      return isRes("C1") && isRes("C2") && isRes("C3");
    }

    if (challenge === "C1") {
      const slots = req.body?.slots;
      if (!Array.isArray(slots) || slots.length !== 5) {
        return res.status(400).json({ error: "invalid_payload", message: "Please provide an array of 5 evidence slots." });
      }

      const prior = await getTrackAnswers(team.id, "C1");
      const priorRow = prior[0];
      if (priorRow?.correct) {
        const trackComplete = await isTrackCResolved();
        return res.status(200).json({
          valid: true,
          locked: false,
          attempts: priorRow.attempts,
          maxAttempts: MAX_ATTEMPTS,
          pointsAwarded: priorRow.pointsAwarded,
          trackComplete,
          message: "Forensic Attack Chain already verified for your crew.",
        });
      }
      if ((priorRow?.attempts || 0) >= MAX_ATTEMPTS) {
        return res.status(200).json({
          valid: false,
          locked: true,
          attempts: MAX_ATTEMPTS,
          message: `Locked — your crew used all ${MAX_ATTEMPTS} attempts on Challenge C1.`,
        });
      }

      const verification = verifyChain(slots);

      let currentTrackAttempts = team.trackCAttempts || 0;
      if (!verification.valid) {
        currentTrackAttempts = await incrementTrackAttempts(team.id, "C");
      }

      const attemptResult = await recordTrackAttempt(team.id, "C1", {
        correct: verification.valid,
        points: verification.valid ? 15 : 0,
        evidence: JSON.stringify(slots),
        maxAttempts: MAX_ATTEMPTS,
      });

      const locked = !attemptResult.correct && (attemptResult.attempts >= MAX_ATTEMPTS || currentTrackAttempts >= MAX_ATTEMPTS);

      await reportSolve(team, "C1", attemptResult);

      const trackComplete = await isTrackCResolved();

      if (trackComplete && !team.trackcCompletedAt) {
        await markTrackCComplete(team.code);
      }

      return res.status(200).json({
        valid: verification.valid,
        locked,
        attempts: attemptResult.attempts,
        maxAttempts: MAX_ATTEMPTS,
        pointsAwarded: attemptResult.pointsAwarded,
        trackComplete,
        message: locked && !verification.valid
          ? `Sequence incorrect, and that was attempt #${MAX_ATTEMPTS} — Challenge C1 is now locked!`
          : verification.message,
      });
    }

    if (challenge === "C2") {
      // Challenge sequence check: C1 must be resolved before C2
      const c1Prior = await getTrackAnswers(team.id, "C1");
      const c1Row = c1Prior[0];
      const c1Resolved = c1Row?.correct || (c1Row?.attempts || 0) >= MAX_ATTEMPTS;
      if (!c1Resolved) {
        return res.status(403).json({ error: "challenge_locked", message: "Challenge C1 must be resolved before accessing Challenge C2." });
      }

      const volatilityOrder = req.body?.order;
      if (!Array.isArray(volatilityOrder) || volatilityOrder.length !== 10) {
        return res.status(400).json({ error: "invalid_payload", message: "Please provide an array of 10 volatility items." });
      }

      const prior = await getTrackAnswers(team.id, "C2");
      const priorRow = prior[0];
      if (priorRow?.correct) {
        const trackComplete = await isTrackCResolved();
        return res.status(200).json({
          valid: true,
          locked: false,
          attempts: priorRow.attempts,
          maxAttempts: MAX_ATTEMPTS,
          pointsAwarded: priorRow.pointsAwarded,
          trackComplete,
          message: "Order of Volatility already verified for your crew.",
        });
      }
      if ((priorRow?.attempts || 0) >= MAX_ATTEMPTS) {
        return res.status(200).json({
          valid: false,
          locked: true,
          attempts: MAX_ATTEMPTS,
          message: `Locked — your crew used all ${MAX_ATTEMPTS} attempts on Challenge C2.`,
        });
      }

      const verification = verifyVolatility(volatilityOrder);

      let currentTrackAttempts = team.trackCAttempts || 0;
      if (!verification.valid) {
        currentTrackAttempts = await incrementTrackAttempts(team.id, "C");
      }

      const attemptResult = await recordTrackAttempt(team.id, "C2", {
        correct: verification.valid,
        points: verification.valid ? 15 : 0,
        evidence: JSON.stringify(volatilityOrder),
        maxAttempts: MAX_ATTEMPTS,
      });

      const locked = !attemptResult.correct && (attemptResult.attempts >= MAX_ATTEMPTS || currentTrackAttempts >= MAX_ATTEMPTS);

      await reportSolve(team, "C2", attemptResult);

      const trackComplete = await isTrackCResolved();

      if (trackComplete && !team.trackcCompletedAt) {
        await markTrackCComplete(team.code);
      }

      return res.status(200).json({
        valid: verification.valid,
        locked,
        attempts: attemptResult.attempts,
        maxAttempts: MAX_ATTEMPTS,
        pointsAwarded: attemptResult.pointsAwarded,
        trackComplete,
        message: locked && !verification.valid
          ? `Volatility ranking incorrect, and that was attempt #${MAX_ATTEMPTS} — Challenge C2 is now locked!`
          : verification.message,
      });
    }

    if (challenge === "C3") {
      // Challenge sequence check: C2 must be resolved before C3
      const c2Prior = await getTrackAnswers(team.id, "C2");
      const c2Row = c2Prior[0];
      const c2Resolved = c2Row?.correct || (c2Row?.attempts || 0) >= MAX_ATTEMPTS;
      if (!c2Resolved) {
        return res.status(403).json({ error: "challenge_locked", message: "Challenge C2 must be resolved before accessing Challenge C3." });
      }

      const answer = String(req.body?.answer || "").trim();

      const prior = await getTrackAnswers(team.id, "C3");
      const priorRow = prior[0];
      if (priorRow?.correct) {
        const trackComplete = await isTrackCResolved();
        return res.status(200).json({
          valid: true,
          locked: false,
          attempts: priorRow.attempts,
          maxAttempts: MAX_ATTEMPTS,
          pointsAwarded: priorRow.pointsAwarded,
          trackComplete,
          message: "Power-Loss Volatility Audit already verified for your crew.",
        });
      }
      if ((priorRow?.attempts || 0) >= MAX_ATTEMPTS) {
        return res.status(200).json({
          valid: false,
          locked: true,
          attempts: MAX_ATTEMPTS,
          message: `Locked — your crew used all ${MAX_ATTEMPTS} attempts on Challenge C3.`,
        });
      }

      const verification = verifyC3(answer);

      let currentTrackAttempts = team.trackCAttempts || 0;
      if (!verification.valid) {
        currentTrackAttempts = await incrementTrackAttempts(team.id, "C");
      }

      const attemptResult = await recordTrackAttempt(team.id, "C3", {
        correct: verification.valid,
        points: verification.valid ? 10 : 0,
        evidence: answer,
        maxAttempts: MAX_ATTEMPTS,
      });

      const locked = !attemptResult.correct && (attemptResult.attempts >= MAX_ATTEMPTS || currentTrackAttempts >= MAX_ATTEMPTS);

      await reportSolve(team, "C3", attemptResult);

      const trackComplete = await isTrackCResolved();

      if (trackComplete && !team.trackcCompletedAt) {
        await markTrackCComplete(team.code);
      }

      return res.status(200).json({
        valid: verification.valid,
        locked,
        attempts: attemptResult.attempts,
        maxAttempts: MAX_ATTEMPTS,
        pointsAwarded: attemptResult.pointsAwarded,
        trackComplete,
        message: locked && !verification.valid
          ? `Volatility degradation audit incorrect, and that was attempt #${MAX_ATTEMPTS} — Challenge C3 is now locked!`
          : verification.message,
      });
    }

    return res.status(400).json({ error: "unknown_challenge" });
  } catch (err) {
    console.error("Track C submit error:", err);
    return res.status(500).json({ error: "server_error", message: "Failed to submit Track C challenge" });
  }
}
