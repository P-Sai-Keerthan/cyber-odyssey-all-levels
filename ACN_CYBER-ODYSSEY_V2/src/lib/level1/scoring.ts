import 'server-only';
import { prisma } from '@/lib/prisma';
import { combineLevel1Score } from '@/lib/level1/scoring-policy';

/**
 * Level 1 scoring.
 *
 * ---------------------------------------------------------------------------
 * TWO COMPONENTS, NEVER MERGED AT REST
 * ---------------------------------------------------------------------------
 *   RESULTS    sum(Level1Result.awardedPoints) — questions the Level 1
 *              application verified, priced from this portal's own catalogue.
 *              Official the moment they exist.
 *   PENALTIES  sum(Level1Penalty.points) — hints the squad chose to spend.
 *
 * Combined at READ time, never written into a shared column. A stored total would
 * need updating by two independent writers — result ingestion and hint charges —
 * which arrive as separate events and can arrive concurrently. Deriving it means
 * there is nothing to get out of step.
 *
 * Modelled deliberately on lib/level3/scoring.ts: Level 1 and Level 3 are both
 * externally-verified, automatically-scored levels, and two different shapes for
 * the same problem would be two things to reason about.
 *
 * `Team.score` is untouched. It remains the sum of APPROVED evaluations only,
 * feeding the dashboard rank widget and the db:doctor invariant. Redefining it
 * here would silently change both — see the Known Limitations note in the Phase 1
 * report for why that reconciliation is deliberately out of this phase.
 */

export const LEVEL_1 = 1 as const;

export interface Level1TeamScore {
  /** Sum of verified results. `null` when the squad has solved nothing. */
  resultPoints: number | null;
  /** Sum of hint deductions charged. Always a number; 0 when none. */
  penaltyPoints: number;
  /**
   * results − penalties, clamped at zero. `null` only when the squad has no
   * results AND no penalties, i.e. has genuinely not started — which is what lets
   * the leaderboard show an em dash rather than a zero it did not earn.
   */
  officialScore: number | null;
  solvedCount: number;
  hintsUsed: number;
}

/**
 * Official Level 1 standing for one squad.
 *
 * Two aggregates, no per-question round trips — this runs on every render of the
 * Level 1 page for every participant, so it must not scale with the catalogue.
 */
export async function getTeamLevel1Score(teamId: string): Promise<Level1TeamScore> {
  const [results, penalties] = await Promise.all([
    prisma.level1Result.aggregate({
      where: { teamId },
      _sum: { awardedPoints: true },
      _count: { _all: true },
    }),
    prisma.level1Penalty.aggregate({
      where: { teamId },
      _sum: { points: true },
      _count: { _all: true },
    }),
  ]);

  const resultCount = results._count._all;
  const penaltyCount = penalties._count._all;
  const resultPoints = resultCount === 0 ? null : (results._sum.awardedPoints ?? 0);
  const penaltyPoints = penalties._sum.points ?? 0;

  // A squad that spent a hint has started, even with nothing solved yet — so it
  // is scored (at 0 after the clamp), not unscored.
  const started = resultCount > 0 || penaltyCount > 0;

  return {
    resultPoints,
    penaltyPoints,
    officialScore: started ? combineLevel1Score(resultPoints ?? 0, penaltyPoints) : null,
    solvedCount: resultCount,
    hintsUsed: penaltyCount,
  };
}
