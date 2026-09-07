import { prisma } from '@/lib/prisma';

/**
 * Puts `EvaluationCriterion` into a known state.
 *
 * WHY THIS EXISTS
 * ---------------
 * A level's maximum evaluation score is no longer a constant. It is the sum of
 * that level's ACTIVE criteria, falling back to `LevelState.maxScore` only when
 * a level has none (see `saveEvaluationAction`). That makes the criteria table
 * shared global state that decides whether a score is in range.
 *
 * Two suites — `evaluator-portal` and `dynamic-evaluation` — legitimately
 * `deleteMany({})` the whole table and seed their own criteria to exercise the
 * configurable behaviour. They do not restore it, and the suite runs in one
 * process against one database with `fileParallelism: false`. So any suite that
 * ran afterwards and depended on the seeded 4 x 250 inherited whatever the
 * previous file happened to leave.
 *
 * The symptom was three failures that appeared ONLY in a full run and passed in
 * isolation: a Level 2 maximum of 2000 instead of 1000, so scores of 1500 and
 * 2000 were accepted as in-range by tests written to prove they are not.
 *
 * Suites that depend on a level's maximum call this in `beforeEach`, so they
 * assert against a maximum they established rather than one they inherited.
 */

/** The canonical rubric: four equally-weighted criteria per evaluated level. */
export const CANONICAL_CRITERIA_MAX = 1000;
const CRITERION_COUNT = 4;
const PER_CRITERION = CANONICAL_CRITERIA_MAX / CRITERION_COUNT;

/** Levels that carry an evaluator rubric. Level 1 is scored automatically. */
const EVALUATED_LEVELS = [2, 3] as const;

export async function resetEvaluationCriteria(): Promise<void> {
  await prisma.evaluationCriterion.deleteMany({});

  for (const levelNumber of EVALUATED_LEVELS) {
    for (let i = 0; i < CRITERION_COUNT; i++) {
      await prisma.evaluationCriterion.create({
        data: {
          levelNumber,
          title: `L${levelNumber} Criterion ${i + 1}`,
          description: 'Canonical test rubric entry.',
          maxPoints: PER_CRITERION,
          sortOrder: i + 1,
          isActive: true,
          required: true,
        },
      });
    }
  }
}
