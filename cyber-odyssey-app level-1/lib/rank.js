function stageReached(team) {
  if (team.trackcCompletedAt || team.finalCompletedAt) return 3;
  if (team.trackbCompletedAt || team.stage2CompletedAt) return 2;
  if (team.stage1CompletedAt) return 1;
  return 0;
}

function reachedAt(team) {
  return (
    team.trackcCompletedAt ||
    team.finalCompletedAt ||
    team.trackbCompletedAt ||
    team.stage2CompletedAt ||
    team.stage1CompletedAt ||
    null
  );
}

function rankTeams(teams, pointsMapA = {}, pointsMapB = {}, pointsMapC = {}, attemptsMap = {}) {
  const scoredTeams = teams.map((team) => {
    const trackAPoints = pointsMapA[team.id] || 0;
    const trackBPoints = pointsMapB[team.id] || 0;
    const trackCPoints = pointsMapC[team.id] || 0;
    const totalPoints = trackAPoints + trackBPoints + trackCPoints;
    const stage = stageReached(team);
    const at = reachedAt(team);

    // Track-level attempts (0..3)
    const trackAAttempts = team.trackAAttempts !== undefined ? team.trackAAttempts : (team.stage1Attempts || 0);
    const trackBAttempts = team.trackBAttempts !== undefined ? team.trackBAttempts : (team.stage2Attempts || 0);
    const trackCAttempts = team.trackCAttempts !== undefined ? team.trackCAttempts : (team.finalAttempts || 0);
    const totalAttempts =
      attemptsMap && attemptsMap[team.id] !== undefined
        ? attemptsMap[team.id]
        : (trackAAttempts + trackBAttempts + trackCAttempts);

    return {
      ...team,
      stageReached: stage,
      reachedAt: at,
      trackAPoints,
      trackBPoints,
      trackCPoints,
      totalPoints,
      trackAAttempts,
      trackBAttempts,
      trackCAttempts,
      totalAttempts,
    };
  });

  // Only teams with points > 0 receive ranks
  const teamsWithPoints = scoredTeams.filter((t) => t.totalPoints > 0);
  const teamsWithoutPoints = scoredTeams.filter((t) => t.totalPoints === 0);

  teamsWithPoints.sort((a, b) => {
    // 1. TOTAL SCORE — descending
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    // 2. FINISH TIME — ascending, when applicable
    if (a.reachedAt && b.reachedAt) {
      const diff = new Date(a.reachedAt) - new Date(b.reachedAt);
      if (diff !== 0) return diff;
    } else if (a.reachedAt && !b.reachedAt) {
      return -1;
    } else if (!a.reachedAt && b.reachedAt) {
      return 1;
    }
    // 3. TOTAL ATTEMPTS — ascending (fewer is better)
    if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
    // 4. TEAM ID — ascending as the final deterministic tie-breaker
    return (a.id || 0) - (b.id || 0);
  });

  teamsWithoutPoints.sort((a, b) => (a.id || 0) - (b.id || 0));

  const ranked = teamsWithPoints.map((team, index) => ({
    ...team,
    rank: index + 1,
  }));

  const unranked = teamsWithoutPoints.map((team) => ({
    ...team,
    rank: "—",
  }));

  return [...ranked, ...unranked];
}

module.exports = { rankTeams, stageReached, reachedAt };
