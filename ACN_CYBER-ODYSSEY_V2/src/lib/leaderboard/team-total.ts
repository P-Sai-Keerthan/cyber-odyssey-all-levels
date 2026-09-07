import 'server-only';
import type { Prisma } from '@prisma/client';
import { APPROVAL_STATUS } from '@/lib/evaluation/approval-status';
import { combineLevel1Score } from '@/lib/level1/scoring-policy';
import { combineLevel3Score } from '@/lib/level3/scoring-policy';

/**
 * ONE squad's official total, computed exactly as the leaderboard computes it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The portal had TWO definitions of "a squad's score" and they disagreed.
 *
 *   `getLeaderboardStandings()` — Level 1 automatic results minus hint
 *      penalties, plus APPROVED Level 2 and Level 3 report scores, plus Level 3
 *      discoveries minus their penalties, plus approved score adjustments.
 *
 *   `Team.score` — the sum of APPROVED evaluations. Nothing else.
 *
 * `Team.score` is what the participant dashboard prints as "PTS" and what its
 * rank widget counts against (`count(score > myScore)`). So a squad that had
 * earned Level 1 points saw 0 PTS and a meaningless rank on their own dashboard
 * while the leaderboard showed the real figure. Worse, `recomputeTeamScore`
 * OVERWRITES the column, so the moment a Level 2 evaluation was approved, any
 * Level 1 points a seed had put there were erased.
 *
 * This module is now the single arithmetic. `recomputeTeamScore` calls it, and
 * every path that changes a component of a squad's score calls that. The
 * leaderboard still computes from source on every read — it is not reading this
 * column — so the two can no longer drift apart in meaning, only in freshness.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST MAKE THE DASHBOARD CALL THE LEADERBOARD
 * ---------------------------------------------------------------------------
 * Because `Team.score` is also the rank query and the `db:doctor` integrity
 * invariant. Leaving a column named `score` holding something that is not the
 * score, and teaching every reader to ignore it, is how the next reader gets it
 * wrong too. The column is now correct.
 */

/** Minimal transaction-client surface this module needs. */
type TxClient = Prisma.TransactionClient;

export interface TeamLevelBreakdown {
  level1: number;
  level2: number;
  level3: number;
  total: number;
}

/**
 * Computes a squad's official total from current database state.
 *
 * Runs inside whatever client it is handed, so it can participate in the same
 * transaction as the change that triggered it — the score and the state that
 * produced it are then written together or not at all.
 *
 * Zero, not null. This is the STORED aggregate, and a column cannot express
 * "not scored yet"; the leaderboard keeps that distinction because it is the
 * surface where it matters (see the null-is-not-zero note in standings.ts).
 */
export async function computeTeamOfficialTotal(
  tx: TxClient,
  teamId: string,
): Promise<TeamLevelBreakdown> {
  const [
    level1Results,
    level1Penalties,
    level3Discoveries,
    level3Penalties,
    approvedEvaluations,
    approvedAdjustments,
  ] = await Promise.all([
    tx.level1Result.aggregate({ where: { teamId }, _sum: { awardedPoints: true } }),
    tx.level1Penalty.aggregate({ where: { teamId }, _sum: { points: true } }),
    tx.level3Discovery.aggregate({ where: { teamId }, _sum: { awardedPoints: true } }),
    tx.level3Penalty.aggregate({ where: { teamId }, _sum: { points: true } }),
    tx.evaluation.groupBy({
      by: ['level'],
      where: { teamId, approvalStatus: APPROVAL_STATUS.APPROVED },
      _sum: { score: true },
    }),
    tx.scoreAdjustment.groupBy({
      by: ['level'],
      where: { teamId, status: 'APPROVED' },
      _sum: { points: true },
    }),
  ]);

  const approvedByLevel = new Map(approvedEvaluations.map((e) => [e.level, e._sum.score ?? 0]));
  const adjustmentByLevel = new Map(approvedAdjustments.map((a) => [a.level, a._sum.points ?? 0]));

  // Level 1 has no evaluation stage; its score is the automatic component alone.
  const level1 =
    combineLevel1Score(level1Results._sum.awardedPoints ?? 0, level1Penalties._sum.points ?? 0) +
    (adjustmentByLevel.get(1) ?? 0);

  // Level 2 is the approved report score only.
  const level2 = (approvedByLevel.get(2) ?? 0) + (adjustmentByLevel.get(2) ?? 0);

  // Level 3 combines verified discoveries, hint penalties and the approved report.
  const level3 =
    combineLevel3Score(
      level3Discoveries._sum.awardedPoints ?? 0,
      level3Penalties._sum.points ?? 0,
      approvedByLevel.get(3) ?? 0,
    ) + (adjustmentByLevel.get(3) ?? 0);

  return { level1, level2, level3, total: level1 + level2 + level3 };
}
