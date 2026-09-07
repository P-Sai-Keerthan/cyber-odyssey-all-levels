import 'server-only';
import { prisma } from '@/lib/prisma';
import { getLevel3Config } from '@/lib/level3/target-config';

/**
 * The point figure a PARTICIPANT is shown for a level.
 *
 * ---------------------------------------------------------------------------
 * WHY A HELPER AND NOT A CONSTANT
 * ---------------------------------------------------------------------------
 * The three levels do not have the same shape, so "the level's points" is not
 * one column:
 *
 *   LEVEL 1  automatic only — scored by the challenge bridge. Its figure is the
 *            level's configured maximum.
 *   LEVEL 2  a single evaluated deliverable. Also the configured maximum.
 *   LEVEL 3  discovery points PLUS an evaluated report, and the discovery
 *            ceiling itself moves when the Creator releases Track 2.
 *
 * Before this, the /event card and each level page carried their own literal —
 * `points="100 PTS"` on the Level 1 page, `'1000 PTS'` and `'1200 PTS'` in
 * EVENT_LEVELS — and they disagreed with the database and with each other. The
 * label is now derived, so an Admin changing a level's maximum changes every
 * surface that mentions it without a redeploy.
 *
 * This is the PARTICIPANT-FACING label only. It is not a scoring authority:
 * `LevelState.maxScore` caps evaluation, `Level1Result`/`Level3Discovery` carry
 * what a squad actually earned, and `computeTeamOfficialTotal` is the total.
 */

/** Participant-facing maximum for one level, from configuration. */
export async function getLevelDisplayPoints(levelNumber: number): Promise<number> {
  const state = await prisma.levelState.findUnique({
    where: { levelNumber },
    select: { maxScore: true },
  });
  const configuredMax = state?.maxScore ?? 0;

  if (levelNumber !== 3) return configuredMax;

  // Level 3 alone adds a discovery ceiling on top of the evaluated maximum.
  // `availableDiscoveryPoints` is already the correct one of the two track
  // figures — never their sum, since Track 2 is cumulative.
  const level3 = await getLevel3Config();
  return level3.availableDiscoveryPoints + configuredMax;
}

/** Formatted for display, e.g. `3,900 PTS`. */
export async function getLevelDisplayPointsLabel(levelNumber: number): Promise<string> {
  const points = await getLevelDisplayPoints(levelNumber);
  return `${points.toLocaleString()} PTS`;
}

/** All three labels in one round of queries, for the /event card grid. */
export async function getAllLevelDisplayPointLabels(): Promise<Record<number, string>> {
  const [states, level3] = await Promise.all([
    prisma.levelState.findMany({ select: { levelNumber: true, maxScore: true } }),
    getLevel3Config(),
  ]);

  const labels: Record<number, string> = {};
  for (const state of states) {
    const total =
      state.levelNumber === 3 ? level3.availableDiscoveryPoints + state.maxScore : state.maxScore;
    labels[state.levelNumber] = `${total.toLocaleString()} PTS`;
  }
  return labels;
}
