const { requireAdmin } = require("../../../lib/requireAdmin");
const { listAllTeams, getTrackPointsByTeam, getTrackAttemptsByTeam } = require("../../../lib/teams");
const { getEventStatus } = require("../../../lib/eventClock");
const { rankTeams } = require("../../../lib/rank");
const { summary: outboxSummary } = require("../../../lib/outbox");

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  try {
    const [teams, event, pointsA, pointsB, pointsC, attemptsMap, outbox] = await Promise.all([
      listAllTeams(),
      getEventStatus(),
      getTrackPointsByTeam("A"),
      getTrackPointsByTeam("B"),
      getTrackPointsByTeam("C"),
      getTrackAttemptsByTeam(),
      // Portal sync health. Without this the only way an organiser can tell that
      // scores have stopped reaching the Portal is for a crew to complain, and by
      // then the event is over. Degrades to nulls rather than failing the whole
      // dashboard if the outbox table is not present yet.
      outboxSummary().catch(() => null),
    ]);

    const standings = rankTeams(teams, pointsA, pointsB, pointsC, attemptsMap);

    const summary = {
      totalTeams: teams.length,
      completed: teams.filter((t) => t.trackcCompletedAt || t.finalCompletedAt).length,
      onTrackC: teams.filter((t) => (t.trackbCompletedAt || t.stage2CompletedAt) && !t.trackcCompletedAt && !t.finalCompletedAt).length,
      onTrackB: teams.filter((t) => t.stage1CompletedAt && !t.trackbCompletedAt && !t.stage2CompletedAt).length,
      onTrackA: teams.filter((t) => !t.stage1CompletedAt).length,
    };

    return res.status(200).json({ event, summary, standings, portalSync: outbox });
  } catch (err) {
    console.error("Admin status error:", err);
    return res.status(500).json({ error: "server_error", message: "Failed to load admin status" });
  }
}
