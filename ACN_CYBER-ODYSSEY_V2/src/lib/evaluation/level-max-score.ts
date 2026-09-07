import 'server-only';
import type { Prisma } from '@prisma/client';
// Type-only: this module never issues a query itself, it is handed a client.
import type { prisma } from '@/lib/prisma';

/**
 * The authoritative maximum an evaluator may award for a level.
 *
 * ---------------------------------------------------------------------------
 * ONE RULE, IN ONE PLACE
 * ---------------------------------------------------------------------------
 * `LevelState.maxScore` IS the level's configured maximum. Evaluation criteria
 * are a BREAKDOWN of that maximum, never a redefinition of it.
 *
 * The portal previously resolved the cap as:
 *
 *     criteriaSum > 0 ? criteriaSum : levelState.maxScore
 *
 * — written twice, once on the open path and once on the save path. That makes
 * the criteria table silently authoritative: any row present for a level moves
 * the ceiling, and nothing anywhere checks the result against the level's
 * configured maximum.
 *
 * It is not hypothetical. `tests/dynamic-evaluation.test.ts` creates four Level 2
 * criteria of its own. Run against a database that also holds the four real
 * seeded ones and the evaluator console offers **eight criteria and a 2000-point
 * total** for a level configured at 1000 — with every number rendered faithfully
 * from the database, so nothing looks wrong until someone adds up the rubric.
 *
 * So the cap is now always `LevelState.maxScore`, and criteria are used for the
 * breakdown ONLY when they sum to exactly that. When they disagree the level is
 * misconfigured: scoring falls back to a single total against the configured
 * maximum, and `criteriaMismatch` says so, so the evaluator is told rather than
 * quietly handed the wrong denominator.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT LET THE CRITERIA WIN
 * ---------------------------------------------------------------------------
 * Because a rubric is a way of arriving at a score, and the score's ceiling is a
 * property of the EVENT. If an Admin genuinely wants Level 2 to be worth 2000,
 * that is a change to the level's configuration — one deliberate edit, visible
 * in one place — not an emergent consequence of how many rubric rows happen to
 * exist.
 */

/** Works inside a transaction or against the base client. */
type Db = Prisma.TransactionClient | typeof prisma;

export interface LevelCriterion {
  id: string;
  name: string;
  description: string;
  maxMarks: number;
  guidance: string;
}

export interface LevelEvaluationScale {
  /** The authoritative cap. Always `LevelState.maxScore`. */
  maxScore: number;
  /** Active criteria for the level, in display order. May be empty. */
  criteria: LevelCriterion[];
  /** Sum of `criteria[].maxMarks`. 0 when there are none. */
  criteriaSum: number;
  /**
   * True when a rubric exists AND sums to the configured maximum, so the
   * evaluator scores criterion-by-criterion. False means a single total score.
   */
  usesCriteriaBreakdown: boolean;
  /**
   * Set when criteria exist but do NOT sum to the configured maximum. Carries a
   * sentence written for the evaluator looking at the screen; the rubric is
   * suppressed and the configured maximum is used instead.
   */
  criteriaMismatch: string | null;
}

/**
 * Fallback when a level has no `LevelState` row at all.
 *
 * `ensureLevelStatesExist` creates the three rows on first request, so reaching
 * this means the level genuinely is not configured. Zero rather than a guessed
 * number: an evaluator who can award nothing asks why, which is the correct
 * outcome. A plausible-looking default would be scored against silently.
 */
const NO_LEVEL_CONFIGURED = 0;

export async function resolveLevelEvaluationScale(
  db: Db,
  levelNumber: number,
): Promise<LevelEvaluationScale> {
  const [levelState, activeCriteria] = await Promise.all([
    db.levelState.findUnique({
      where: { levelNumber },
      select: { maxScore: true },
    }),
    db.evaluationCriterion.findMany({
      where: { levelNumber, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, description: true, maxPoints: true, guidance: true },
    }),
  ]);

  const maxScore = levelState?.maxScore ?? NO_LEVEL_CONFIGURED;

  const criteria: LevelCriterion[] = activeCriteria.map((c) => ({
    id: c.id,
    name: c.title,
    description: c.description ?? '',
    maxMarks: c.maxPoints,
    guidance: c.guidance ?? '',
  }));

  const criteriaSum = criteria.reduce((sum, c) => sum + c.maxMarks, 0);

  if (criteria.length === 0) {
    // No rubric configured. A single total score against the configured maximum
    // is the correct model, not an error — see Level 3, which is scored that way.
    return {
      maxScore,
      criteria,
      criteriaSum: 0,
      usesCriteriaBreakdown: false,
      criteriaMismatch: null,
    };
  }

  if (criteriaSum !== maxScore) {
    return {
      maxScore,
      // Suppressed deliberately. Rendering a rubric whose total is not the
      // level's maximum is how an evaluator ends up scoring out of the wrong
      // denominator without noticing.
      criteria: [],
      criteriaSum,
      usesCriteriaBreakdown: false,
      criteriaMismatch:
        `Level ${levelNumber} has ${criteria.length} active evaluation criteria totalling ` +
        `${criteriaSum} PTS, but the level is configured for a maximum of ${maxScore} PTS. ` +
        `The rubric is not being used until that is corrected — score the deliverable out of ` +
        `${maxScore} PTS. An Admin can fix the criteria at Admin → Evaluations → Criteria & Rubric.`,
    };
  }

  return { maxScore, criteria, criteriaSum, usesCriteriaBreakdown: true, criteriaMismatch: null };
}
