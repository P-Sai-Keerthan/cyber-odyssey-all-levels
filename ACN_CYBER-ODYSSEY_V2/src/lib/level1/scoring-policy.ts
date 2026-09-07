/**
 * Level 1 event scoring policy.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS AND IS NOT
 * ---------------------------------------------------------------------------
 * These are the event's POLICY numbers. They are NOT the authority on what a
 * squad scored — that lives in the database, as `Level1Result.awardedPoints` and
 * `Level1Penalty.points`, both snapshotted at the moment they were earned or
 * charged. Editing a value here must never retroactively rewrite a score a squad
 * already holds.
 *
 * Deliberately free of imports, matching lib/level3/scoring-policy.ts, so it can
 * be used by server code, client components and the seed script without pulling a
 * database client into a bundle.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PORTAL PRICES A HINT AND NOT LEVEL 1
 * ---------------------------------------------------------------------------
 * The Level 1 application applies its own deduction locally so its own screens
 * show the right number. This portal does NOT read that figure. It is told only
 * THAT a hint was unlocked, for which question, and charges the value below.
 *
 * The alternative — accepting the deduction Level 1 calculated — would mean a
 * compromised Level 1 could send a negative or zero penalty, or omit the event
 * entirely. The same reasoning that keeps award values here keeps deduction
 * values here.
 *
 * The value MUST be kept in step with `HINT_PENALTY` in the Level 1 application
 * (lib/trackShared.js). They are two systems' views of one policy; if they drift,
 * a squad sees one number in Level 1 and a different one on the leaderboard.
 * `tests/level1-integration.test.ts` pins the expected value so a change here is
 * a deliberate act.
 */

/**
 * Cost of unlocking one Level 1 hint.
 *
 * Level 1 offers hints on Track B only, one per question, at a flat 5 points —
 * see `HINT_PENALTY` in the Level 1 application's lib/trackShared.js.
 */
export const LEVEL1_HINT_PENALTIES: Record<number, number> = {
  1: 5,
};

/** Level 1 offers a single hint tier today. */
export const LEVEL1_MAX_HINT_NUMBER = 1;

export function isValidLevel1HintNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= LEVEL1_MAX_HINT_NUMBER;
}

/** Server-side authority for what a Level 1 hint costs. Never a client value. */
export function level1HintPenaltyFor(hintNumber: number): number {
  return LEVEL1_HINT_PENALTIES[hintNumber] ?? 0;
}

/**
 * Combines the two Level 1 components into the official figure.
 *
 * Clamped at zero for the same reason Level 3 is: a squad that spends more on
 * hints than it earns finishes on 0, not on a negative number that would drag
 * down its event total and read as a punishment for taking part.
 */
export function combineLevel1Score(resultPoints: number, penaltyPoints: number): number {
  return Math.max(0, resultPoints - penaltyPoints);
}

/**
 * Event types the Level 1 bridge accepts.
 *
 * An explicit allowlist rather than a free string: an unrecognised event type is
 * rejected and recorded, so a sender that starts emitting something new fails
 * loudly here instead of being silently ignored.
 */
export const LEVEL1_EVENT_TYPES = ['LEVEL1_CHALLENGE_SOLVED', 'LEVEL1_HINT_UNLOCKED'] as const;
export type Level1EventType = (typeof LEVEL1_EVENT_TYPES)[number];

export function isLevel1EventType(value: string): value is Level1EventType {
  return (LEVEL1_EVENT_TYPES as readonly string[]).includes(value);
}
