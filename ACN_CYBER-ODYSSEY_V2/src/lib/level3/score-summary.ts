import 'server-only';
import { prisma } from '@/lib/prisma';
import { getLevel3Config, type Level3TargetConfig } from '@/lib/level3/target-config';
import { resolveLevelEvaluationScale } from '@/lib/evaluation/level-max-score';

/**
 * Level 3 scoring summary — ONE authoritative shape, read by everybody.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * A participant seeing one Level 3 ceiling, the evaluator console another and
 * the leaderboard a third is the failure mode that makes a scoring dispute
 * unresolvable on event day. Before this file the participant page carried the
 * literal `1000` in two places while the evaluator's maximum came from the
 * criteria table and the /event card said `1200 PTS` — three numbers, none of
 * them agreeing, none of them wrong on its own terms.
 *
 * Now there is one function. The participant workspace, the Creator console and
 * the /event card all call it; the evaluator console derives its maximum from
 * the same criteria rows this reads.
 *
 * ---------------------------------------------------------------------------
 * AVAILABLE vs EARNED
 * ---------------------------------------------------------------------------
 * AVAILABLE is the ceiling — what a perfect squad could reach right now.
 * EARNED is what a squad actually holds, and it comes from `Level3Discovery`,
 * `Level3Penalty` and an APPROVED evaluation. This file computes the ceiling
 * only. Nothing here can award anything.
 *
 * TRACK 2 IS CUMULATIVE. `availableDiscoveryPoints` is one of the two configured
 * figures, never their sum — see the note on `Level3Config.track2Points`.
 */

/** Stable keys for the two Level 3 criteria whose maxima are shown to participants. */
export const LEVEL3_REPORT_KEY = 'LEVEL3_REPORT';
export const LEVEL3_RESPONSE_KEY = 'LEVEL3_RESPONSE';

/**
 * Fallback maxima, used ONLY when the keyed criteria rows are absent — a
 * database that has not been seeded yet. The seeded rows are the authority the
 * moment they exist, including when a Creator changes them.
 */
export const LEVEL3_DEFAULT_REPORT_POINTS = 200;

/**
 * The Level 3 Response criterion is RETIRED — the final report carries the
 * level's full evaluated value on its own. The key is kept so an existing
 * inactive row still resolves (and reads 0) rather than falling back to a
 * figure nobody configured.
 */
export const LEVEL3_DEFAULT_RESPONSE_POINTS = 0;

export interface Level3ScoreSummary {
  /** Points available in Track 1, before Track 2 is released. */
  track1Points: number;
  /** CUMULATIVE points available once Track 2 is released. Includes Track 1. */
  track2Points: number;
  track2Released: boolean;
  /** Whichever of the two above applies right now. Never their sum. */
  availableDiscoveryPoints: number;
  /** Maximum for the final investigation report. */
  reportPoints: number;
  /** Maximum for the Level 3 response. */
  responsePoints: number;
  /** reportPoints + responsePoints — the evaluated portion's ceiling. */
  evaluatedPoints: number;
  /** availableDiscoveryPoints + evaluatedPoints — the whole level's ceiling now. */
  availableTotalPoints: number;
  /** The ceiling once Track 2 is released, whether or not it has been. */
  fullTotalPoints: number;
  targetIp: string | null;
  /** True when both keyed criteria were found in the database. */
  criteriaConfigured: boolean;
}

/**
 * Report and Response maxima, resolved by KEY rather than title.
 *
 * Only ACTIVE criteria count: deactivating a criterion is how an Admin retires
 * it, and a retired criterion contributes nothing to the evaluator's maximum, so
 * it must contribute nothing to the displayed ceiling either.
 */
export async function getLevel3EvaluatedPoints(): Promise<{
  reportPoints: number;
  responsePoints: number;
  /** The authoritative Level 3 evaluation ceiling: `LevelState.maxScore`. */
  evaluatedPoints: number;
  criteriaConfigured: boolean;
}> {
  const [rows, scale] = await Promise.all([
    prisma.evaluationCriterion.findMany({
      where: {
        levelNumber: 3,
        isActive: true,
        key: { in: [LEVEL3_REPORT_KEY, LEVEL3_RESPONSE_KEY] },
      },
      select: { key: true, maxPoints: true },
    }),
    // The SAME resolver the evaluator console and the save path use, so the
    // denominator a squad sees on its approved result is by construction the
    // ceiling the evaluator scored against. These were two independent sums.
    resolveLevelEvaluationScale(prisma, 3),
  ]);

  const report = rows.find((r) => r.key === LEVEL3_REPORT_KEY);
  const response = rows.find((r) => r.key === LEVEL3_RESPONSE_KEY);

  return {
    reportPoints: report?.maxPoints ?? LEVEL3_DEFAULT_REPORT_POINTS,
    responsePoints: response?.maxPoints ?? LEVEL3_DEFAULT_RESPONSE_POINTS,
    evaluatedPoints: scale.maxScore,
    // The REPORT alone. The Response criterion is retired, so requiring it here
    // would report a correctly-configured level as unconfigured.
    criteriaConfigured: Boolean(report),
  };
}

/**
 * The whole Level 3 ceiling, from the database.
 *
 * Two queries, issued together. This is on the Level 3 participant render path.
 */
export async function getLevel3ScoreSummary(
  config?: Level3TargetConfig,
): Promise<Level3ScoreSummary> {
  const [cfg, evaluated] = await Promise.all([
    config ? Promise.resolve(config) : getLevel3Config(),
    getLevel3EvaluatedPoints(),
  ]);

  // The configured level maximum, NOT the sum of the two component figures.
  // They agree when the rubric is configured correctly, and when they do not the
  // configured maximum is the one that governs scoring — so it is the one shown.
  const evaluatedPoints = evaluated.evaluatedPoints;

  return {
    track1Points: cfg.track1Points,
    track2Points: cfg.track2Points,
    track2Released: cfg.track2Released,
    availableDiscoveryPoints: cfg.availableDiscoveryPoints,
    reportPoints: evaluated.reportPoints,
    responsePoints: evaluated.responsePoints,
    evaluatedPoints,
    availableTotalPoints: cfg.availableDiscoveryPoints + evaluatedPoints,
    fullTotalPoints: cfg.track2Points + evaluatedPoints,
    targetIp: cfg.targetIp,
    criteriaConfigured: evaluated.criteriaConfigured,
  };
}
