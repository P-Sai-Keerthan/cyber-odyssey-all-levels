/**
 * Level 3 event scoring policy.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS AND IS NOT
 * ---------------------------------------------------------------------------
 * These are the event's POLICY DEFAULTS — the numbers a Creator is offered when
 * they add a bug, and the fixed cost of a hint.
 *
 * They are NOT the authority on what a squad scored. That lives in the database:
 * `Level3Bug.points` for an award and `Level3Penalty.points` for a deduction,
 * both snapshotted at the moment they were earned or charged. A Creator can price
 * a bug off-tier, and editing a value here must never retroactively rewrite a
 * score a squad already holds.
 *
 * The maximum possible Level 3 score is likewise never hardcoded — it is summed
 * from the active bug records, so adding or retiring a bug needs no code change.
 *
 * Deliberately free of imports so it can be used by server code, client
 * components and the seed script without pulling a database client into a bundle.
 */

export const LEVEL3_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'CRITICAL'] as const;
export type Level3Difficulty = (typeof LEVEL3_DIFFICULTIES)[number];

/** Default award per difficulty tier. The event scale, not ORION's. */
export const LEVEL3_DIFFICULTY_POINTS: Record<Level3Difficulty, number> = {
  EASY: 100,
  MEDIUM: 200,
  HARD: 300,
  CRITICAL: 500,
};

export const LEVEL3_DIFFICULTY_LABELS: Record<Level3Difficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
  CRITICAL: 'Critical',
};

/**
 * Cost of unlocking a hint, by hint number.
 *
 * Fixed by policy rather than stored per hint: a per-hint price would let two
 * bugs of the same tier charge differently for the same help, which participants
 * experience as arbitrary. Charged server-side — the client is never asked what a
 * hint costs, only told.
 */
export const LEVEL3_HINT_PENALTIES: Record<number, number> = {
  1: 15,
  2: 35,
};

export const LEVEL3_MAX_HINT_NUMBER = 2;

export function isLevel3Difficulty(value: string): value is Level3Difficulty {
  return (LEVEL3_DIFFICULTIES as readonly string[]).includes(value);
}

/** Default award for a tier; 0 for an unrecognised value rather than a throw. */
export function defaultPointsForDifficulty(difficulty: string): number {
  return isLevel3Difficulty(difficulty) ? LEVEL3_DIFFICULTY_POINTS[difficulty] : 0;
}

export function isValidHintNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= LEVEL3_MAX_HINT_NUMBER;
}

/** Server-side authority for what a hint costs. Never accepts a client value. */
export function hintPenaltyFor(hintNumber: number): number {
  return LEVEL3_HINT_PENALTIES[hintNumber] ?? 0;
}

/**
 * Combines the three Level 3 components into the official figure.
 *
 * Clamped at zero: a squad that buys more hints than it earns points finishes on
 * 0, not on a negative number that would drag down its event total and read as a
 * penalty for taking part. The raw arithmetic is preserved separately by the
 * caller so the reason for a clamp remains visible.
 */
export function combineLevel3Score(
  discoveryPoints: number,
  penaltyPoints: number,
  approvedReportScore: number,
): number {
  return Math.max(0, discoveryPoints - penaltyPoints + approvedReportScore);
}
