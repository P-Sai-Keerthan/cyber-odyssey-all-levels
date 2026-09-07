const { getAuthenticatedTeam } = require("../../../lib/requireTeam");
const { getTrackAnswers } = require("../../../lib/teams");
const { getConfig } = require("../../../lib/config");
const { getEventStatus } = require("../../../lib/eventClock");
const { QUESTIONS, QUESTION_ORDER, TOTAL_POINTS, MAX_ATTEMPTS } = require("../../../lib/trackA");
const {
  QUESTIONS: B_QUESTIONS,
  QUESTION_ORDER: B_QUESTION_ORDER,
  TOTAL_POINTS: B_TOTAL_POINTS,
} = require("../../../lib/trackB");
const { MAX_ATTEMPTS: C_MAX_ATTEMPTS } = require("../../../lib/trackC");

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const team = await getAuthenticatedTeam(req);
    if (!team) return res.status(401).json({ error: "not_logged_in" });

    const event = await getEventStatus();

    // Calculate this team's points across each track
    const [answersA, answersB, answersC] = await Promise.all([
      getTrackAnswers(team.id, "A"),
      getTrackAnswers(team.id, "B"),
      getTrackAnswers(team.id, "C"),
    ]);

    const trackAPts = answersA.reduce((sum, a) => sum + (a.correct ? Number(a.pointsAwarded || 0) : 0), 0);
    const trackBPts = answersB.reduce((sum, a) => sum + (a.correct ? Number(a.pointsAwarded || 0) : 0), 0);
    const trackCPts = answersC.reduce((sum, a) => sum + (a.correct ? Number(a.pointsAwarded || 0) : 0), 0);
    const totalScore = trackAPts + trackBPts + trackCPts;

    const scoreSummary = {
      trackA: trackAPts,
      trackB: trackBPts,
      trackC: trackCPts,
      total: totalScore,
      maxPoints: 100,
    };

    const attempts = {
      trackA: team.trackAAttempts ?? 0,
      trackB: team.trackBAttempts ?? 0,
      trackC: team.trackCAttempts ?? 0,
      maxAttempts: 3,
    };

    const finalScore = {
      totalPoints: totalScore,
      maxPoints: 100,
      trackA: trackAPts,
      trackB: trackBPts,
      trackC: trackCPts,
      completed: Boolean(team.trackcCompletedAt),
      finishedAt: team.trackcCompletedAt || null,
      attempts,
    };

    const base = {
      team: { code: team.code, name: team.name },
      event,
      scoreSummary,
      attempts,
      finalScore: (event.phase === "ended" || team.trackcCompletedAt) ? finalScore : undefined,
    };

    if (event.phase === "not_started") {
      return res.status(200).json({ ...base, stage: "waiting" });
    }

    // Track A (Scam Bazaar)
    if (!team.stage1CompletedAt) {
      const questions = QUESTION_ORDER.map((qc) => {
        const row = answersA.find((a) => a.questionCode === qc);
        const correct = row?.correct || false;
        const attempts = row?.attempts || 0;
        return {
          code: qc,
          title: QUESTIONS[qc].title,
          prompt: QUESTIONS[qc].prompt,
          placeholder: QUESTIONS[qc].placeholder,
          evidenceLabel: QUESTIONS[qc].evidenceLabel,
          points: QUESTIONS[qc].points,
          correct,
          attempts,
          maxAttempts: MAX_ATTEMPTS,
          locked: !correct && attempts >= MAX_ATTEMPTS,
        };
      });
      return res.status(200).json({
        ...base,
        stage: "stage1",
        stage1: {
          evidenceUrl: "/api/trackA/evidence",
          questions,
          pointsEarned: trackAPts,
          totalPoints: TOTAL_POINTS,
        },
      });
    }

    // Track B (Session Hijack)
    if (!team.trackbCompletedAt) {
      const questions = B_QUESTION_ORDER.map((qc) => {
        const row = answersB.find((a) => a.questionCode === qc);
        const correct = row?.correct || false;
        const attempts = row?.attempts || 0;
        return {
          code: qc,
          title: B_QUESTIONS[qc].title,
          prompt: B_QUESTIONS[qc].prompt,
          placeholder: B_QUESTIONS[qc].placeholder,
          evidenceLabel: B_QUESTIONS[qc].evidenceLabel,
          points: B_QUESTIONS[qc].points,
          correct,
          attempts,
          maxAttempts: MAX_ATTEMPTS,
          locked: !correct && attempts >= MAX_ATTEMPTS,
          hintUsed: row?.hintUsed || false,
        };
      });
      return res.status(200).json({
        ...base,
        stage: "trackB",
        trackB: {
          evidenceUrl: "/api/trackB/evidence",
          questions,
          pointsEarned: trackBPts,
          totalPoints: B_TOTAL_POINTS,
        },
      });
    }

    // Track C (Forensics Hub)
    if (!team.trackcCompletedAt) {
      const c1Row = answersC.find((a) => a.questionCode === "C1");
      const c2Row = answersC.find((a) => a.questionCode === "C2");
      const c3Row = answersC.find((a) => a.questionCode === "C3");

      const c1Solved = Boolean(c1Row?.correct);
      const c1Attempts = c1Row?.attempts || 0;
      const c1Locked = !c1Solved && c1Attempts >= C_MAX_ATTEMPTS;

      const c2Solved = Boolean(c2Row?.correct);
      const c2Attempts = c2Row?.attempts || 0;
      const c2Locked = !c2Solved && c2Attempts >= C_MAX_ATTEMPTS;

      const c3Solved = Boolean(c3Row?.correct);
      const c3Attempts = c3Row?.attempts || 0;
      const c3Locked = !c3Solved && c3Attempts >= C_MAX_ATTEMPTS;

      let c1Slots = [null, null, null, null, null];
      if (c1Row?.evidence) {
        try {
          const parsed = JSON.parse(c1Row.evidence);
          if (Array.isArray(parsed) && parsed.length === 5) c1Slots = parsed;
        } catch {}
      }

      let c2Order = null;
      if (c2Row?.evidence) {
        try {
          const parsed = JSON.parse(c2Row.evidence);
          if (Array.isArray(parsed) && parsed.length === 10) c2Order = parsed;
        } catch {}
      }

      return res.status(200).json({
        ...base,
        stage: "trackC",
        trackC: {
          totalPoints: 40,
          pointsEarned: trackCPts,
          c1: { solved: c1Solved, attempts: c1Attempts, maxAttempts: C_MAX_ATTEMPTS, locked: c1Locked, slots: c1Slots },
          c2: { solved: c2Solved, attempts: c2Attempts, maxAttempts: C_MAX_ATTEMPTS, locked: c2Locked, order: c2Order },
          c3: { solved: c3Solved, attempts: c3Attempts, maxAttempts: C_MAX_ATTEMPTS, locked: c3Locked, answer: c3Row?.evidence || "" },
          completed: Boolean(team.trackcCompletedAt),
        },
      });
    }

    // Completing Track C clears the event and unlocks Ithaca!
    const address = await getConfig("round2_address");
    return res.status(200).json({
      ...base,
      stage: "complete",
      complete: { finishedAt: team.trackcCompletedAt || new Date().toISOString(), address },
    });
  } catch (err) {
    console.error("Team state error:", err);
    return res.status(500).json({ error: "server_error", message: "Failed to load team state" });
  }
}
