import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import * as sessionModule from '@/lib/auth/session';
import { resolveLevelEvaluationScale } from '@/lib/evaluation/level-max-score';
import {
  getEvaluatorSubmissionDetailsAction,
  saveEvaluationAction,
} from '@/lib/actions/evaluator-actions';
import { approveEvaluationAction } from '@/lib/actions/evaluation-approval-actions';
import { computeTeamOfficialTotal } from '@/lib/leaderboard/team-total';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

/**
 * The evaluator scoring scale, across all three levels.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE UNDER TEST
 * ---------------------------------------------------------------------------
 * `LevelState.maxScore` is the level's configured maximum. Evaluation criteria
 * are a BREAKDOWN of it and may never redefine it.
 *
 * The portal used to resolve the cap as `criteriaSum > 0 ? criteriaSum : maxScore`,
 * in two independently written copies. That made the criteria table silently
 * authoritative — and a suite that created four Level 2 criteria without removing
 * them left an evaluator scoring a 1000-point level out of 2000, with every
 * number on screen rendered faithfully from the database.
 */

let seq = 0;

async function makeUser(role: 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN') {
  seq++;
  const tag = `scale_${role.toLowerCase()}_${seq}_${Date.now()}`;
  return prisma.user.create({
    data: {
      email: `${tag}@evaluator-scale.test`,
      username: tag,
      passwordHash: await hashPassword('TestPass!2026'),
      role,
      status: 'ACTIVE',
    },
  });
}

function mockSession(user: { id: string; role: string; status: string; username: string } | null) {
  vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(user as never);
}

/** Sets a level's configured maximum without touching its lifecycle state. */
async function configureLevelMax(levelNumber: number, maxScore: number) {
  await prisma.levelState.upsert({
    where: { levelNumber },
    update: { maxScore },
    create: {
      levelNumber,
      name: `Level ${levelNumber}`,
      codename: `LEVEL_${levelNumber}`,
      status: 'LIVE',
      maxScore,
      durationMinutes: 60,
      durationSeconds: 3600,
      remainingSeconds: 3600,
    },
  });
}

async function makeTeamWithSubmission(level: number) {
  seq++;
  const participant = await makeUser('PARTICIPANT');
  const team = await prisma.team.create({
    data: {
      name: `Scale Squad ${seq}_${Date.now()}`,
      code: `SC${seq}${Date.now()}`.slice(0, 12),
      status: 'ACTIVE',
      passwordHash: await hashPassword('SquadPass!2026'),
      creatorId: participant.id,
    },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: participant.id, slot: 1, role: 'HEAD' },
  });
  const submission = await prisma.submission.create({
    data: { teamId: team.id, userId: participant.id, level, status: 'SUBMITTED' },
  });
  return { team, participant, submission };
}

async function cleanup() {
  await prisma.evaluationScore.deleteMany({});
  await prisma.evaluation.deleteMany({});
  await prisma.evaluationCriterion.deleteMany({});
  await prisma.submissionFile.deleteMany({});
  await prisma.submission.deleteMany({ where: { team: { name: { startsWith: 'Scale Squad ' } } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: 'Scale Squad ' } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: 'Scale Squad ' } } });
  await prisma.session.deleteMany({
    where: { user: { email: { contains: '@evaluator-scale.test' } } },
  });
  await prisma.auditLog.deleteMany({
    where: { actor: { email: { contains: '@evaluator-scale.test' } } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: '@evaluator-scale.test' } } });
}

describe('Evaluator scoring scale — configured maximum governs every level', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  // =========================================================================
  // THE RESOLVER
  // =========================================================================
  describe('resolveLevelEvaluationScale', () => {
    it('uses LevelState.maxScore when no rubric is configured', async () => {
      await configureLevelMax(2, 1000);
      const scale = await resolveLevelEvaluationScale(prisma, 2);

      expect(scale.maxScore).toBe(1000);
      expect(scale.criteria).toHaveLength(0);
      expect(scale.usesCriteriaBreakdown).toBe(false);
      expect(scale.criteriaMismatch).toBeNull();
    });

    it('uses the rubric when it sums to the configured maximum', async () => {
      await configureLevelMax(2, 1000);
      await prisma.evaluationCriterion.createMany({
        data: [1, 2, 3, 4].map((n) => ({
          levelNumber: 2,
          title: `Criterion ${n}`,
          maxPoints: 250,
          sortOrder: n,
          isActive: true,
        })),
      });

      const scale = await resolveLevelEvaluationScale(prisma, 2);
      expect(scale.maxScore).toBe(1000);
      expect(scale.criteriaSum).toBe(1000);
      expect(scale.criteria).toHaveLength(4);
      expect(scale.usesCriteriaBreakdown).toBe(true);
      expect(scale.criteriaMismatch).toBeNull();
    });

    it('SUPPRESSES a rubric that does not sum to the configured maximum', async () => {
      // The exact shape of the reported bug: leaked fixtures alongside the real
      // rows, doubling the apparent ceiling of a 1000-point level.
      await configureLevelMax(2, 1000);
      await prisma.evaluationCriterion.createMany({
        data: Array.from({ length: 8 }, (_, i) => ({
          levelNumber: 2,
          title: `Criterion ${i + 1}`,
          maxPoints: 250,
          sortOrder: i + 1,
          isActive: true,
        })),
      });

      const scale = await resolveLevelEvaluationScale(prisma, 2);

      // The ceiling does NOT become 2000.
      expect(scale.maxScore).toBe(1000);
      expect(scale.criteriaSum).toBe(2000);
      expect(scale.criteria).toHaveLength(0);
      expect(scale.usesCriteriaBreakdown).toBe(false);
      expect(scale.criteriaMismatch).toContain('2000');
      expect(scale.criteriaMismatch).toContain('1000');
    });

    it('ignores inactive criteria when totalling the rubric', async () => {
      await configureLevelMax(2, 1000);
      await prisma.evaluationCriterion.createMany({
        data: [
          ...[1, 2, 3, 4].map((n) => ({
            levelNumber: 2,
            title: `Active ${n}`,
            maxPoints: 250,
            sortOrder: n,
            isActive: true,
          })),
          { levelNumber: 2, title: 'Retired', maxPoints: 500, sortOrder: 9, isActive: false },
        ],
      });

      const scale = await resolveLevelEvaluationScale(prisma, 2);
      expect(scale.criteriaSum).toBe(1000);
      expect(scale.usesCriteriaBreakdown).toBe(true);
    });

    it('reports a level with no configured maximum rather than inventing one', async () => {
      await prisma.levelState.deleteMany({ where: { levelNumber: 7 } });
      const scale = await resolveLevelEvaluationScale(prisma, 7);
      expect(scale.maxScore).toBe(0);
    });
  });

  // =========================================================================
  // ALL THREE LEVELS, END TO END
  // =========================================================================
  /**
   * LEVEL 1 IS DELIBERATELY NOT EVALUABLE.
   *
   * `EVALUABLE_LEVELS = [2, 3]` in lib/auth/permissions.ts, and the comment above
   * it says why: Level 1 has no evaluation workflow. Its score comes from the
   * challenge bridge (`Level1Result` minus `Level1Penalty`), which is also how
   * `computeTeamOfficialTotal` defines the Level 1 component.
   *
   * So "the evaluator portal must support all levels" means every level that HAS
   * an evaluation stage. Level 1 is not missing support; it is excluded by the
   * event's scoring model, enforced server-side rather than merely hidden.
   */
  describe('Level 1 — automatic scoring, no evaluation stage', () => {
    it('still opens for inspection, reporting the configured maximum', async () => {
      await configureLevelMax(1, 100);
      const { submission } = await makeTeamWithSubmission(1);
      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      const details = await getEvaluatorSubmissionDetailsAction(submission.id);
      expect(details.success).toBe(true);
      expect(details.data?.maxPossibleScore).toBe(100);
    });

    it('REFUSES to score, with a reason, however the request is crafted', async () => {
      await configureLevelMax(1, 100);
      const { submission } = await makeTeamWithSubmission(1);
      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      for (const score of [0, 50, 100, 5000]) {
        const res = await saveEvaluationAction({
          submissionId: submission.id,
          score,
          status: 'IN_REVIEW',
        });
        expect(res.success, `score ${score}`).toBe(false);
        expect(res.error, `score ${score}`).toContain('not evaluated');
      }

      expect(await prisma.evaluation.count({ where: { submissionId: submission.id } })).toBe(0);
    });

    it('keeps Level 1 out of the leaderboard evaluation component entirely', async () => {
      await configureLevelMax(1, 100);
      const { team } = await makeTeamWithSubmission(1);

      const total = await computeTeamOfficialTotal(prisma, team.id);
      // No Level1Result rows, so no automatic points, and no evaluation path.
      expect(total.level1).toBe(0);
    });
  });

  describe.each([
    { level: 2, configuredMax: 1000 },
    { level: 3, configuredMax: 200 },
  ])('Level $level (configured maximum $configuredMax)', ({ level, configuredMax }) => {
    it('opens the submission and reports the configured maximum', async () => {
      await configureLevelMax(level, configuredMax);
      const { submission } = await makeTeamWithSubmission(level);
      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      const details = await getEvaluatorSubmissionDetailsAction(submission.id);
      expect(details.success).toBe(true);
      expect(details.data?.maxPossibleScore).toBe(configuredMax);
      expect(details.data?.criteriaMismatch).toBeNull();
    });

    it('accepts a valid score and rejects one above the configured maximum', async () => {
      await configureLevelMax(level, configuredMax);
      const { submission } = await makeTeamWithSubmission(level);
      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      const ok = await saveEvaluationAction({
        submissionId: submission.id,
        score: configuredMax,
        status: 'IN_REVIEW',
      });
      expect(ok.success).toBe(true);
      expect(ok.data?.score).toBe(configuredMax);
      expect(ok.data?.maxScore).toBe(configuredMax);

      const tooHigh = await saveEvaluationAction({
        submissionId: submission.id,
        score: configuredMax + 1,
        status: 'IN_REVIEW',
        // Spread rather than assign: `exactOptionalPropertyTypes` distinguishes
        // "absent" from "present and undefined", and the action's signature
        // accepts the former only.
        ...(typeof ok.data?.version === 'number' ? { version: ok.data.version } : {}),
      });
      expect(tooHigh.success).toBe(false);
      expect(tooHigh.error).toContain(String(configuredMax));
    });

    it('rejects a negative and a non-integer score server-side', async () => {
      await configureLevelMax(level, configuredMax);
      const { submission } = await makeTeamWithSubmission(level);
      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      const negative = await saveEvaluationAction({
        submissionId: submission.id,
        score: -1,
        status: 'IN_REVIEW',
      });
      expect(negative.success).toBe(false);

      const fractional = await saveEvaluationAction({
        submissionId: submission.id,
        score: configuredMax / 3,
        status: 'IN_REVIEW',
      });
      expect(fractional.success).toBe(false);
    });

    it('follows the configured maximum when an Admin changes it', async () => {
      await configureLevelMax(level, configuredMax);
      const { submission } = await makeTeamWithSubmission(level);
      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      expect(
        (await getEvaluatorSubmissionDetailsAction(submission.id)).data?.maxPossibleScore,
      ).toBe(configuredMax);

      const changed = configuredMax * 2;
      await configureLevelMax(level, changed);

      // No redeploy, no code change: the console follows the configuration.
      expect(
        (await getEvaluatorSubmissionDetailsAction(submission.id)).data?.maxPossibleScore,
      ).toBe(changed);

      // And the new ceiling is what the server validates against.
      const res = await saveEvaluationAction({
        submissionId: submission.id,
        score: changed,
        status: 'IN_REVIEW',
      });
      expect(res.success).toBe(true);
    });

    it('reaches the leaderboard only through Admin approval, exactly once', async () => {
      await configureLevelMax(level, configuredMax);
      const { team, submission } = await makeTeamWithSubmission(level);
      const evaluator = await makeUser('EVALUATOR');
      const admin = await makeUser('ADMIN');

      const awarded = Math.floor(configuredMax / 2);

      mockSession(evaluator);
      const submitted = await saveEvaluationAction({
        submissionId: submission.id,
        score: awarded,
        status: 'EVALUATED',
      });
      expect(submitted.success).toBe(true);

      // Submitted but not approved contributes nothing.
      const before = await computeTeamOfficialTotal(prisma, team.id);
      const levelKeyBefore = before[`level${level}` as 'level1' | 'level2' | 'level3'];
      expect(levelKeyBefore).toBe(0);

      const evaluation = await prisma.evaluation.findUnique({
        where: { submissionId: submission.id },
      });

      mockSession(admin);
      const approved = await approveEvaluationAction(evaluation!.id);
      expect(approved.success).toBe(true);

      const after = await computeTeamOfficialTotal(prisma, team.id);
      const levelKeyAfter = after[`level${level}` as 'level1' | 'level2' | 'level3'];

      expect(levelKeyAfter).toBe(awarded);

      // A second approval must not apply the score twice.
      const again = await approveEvaluationAction(evaluation!.id);
      expect(again.success).toBe(false);

      const afterDuplicate = await computeTeamOfficialTotal(prisma, team.id);
      expect(afterDuplicate).toEqual(after);
    });
  });

  // =========================================================================
  // CONCURRENCY
  // =========================================================================
  describe('Concurrency', () => {
    it('two evaluators saving the same evaluation cannot both win', async () => {
      await configureLevelMax(2, 1000);
      const { submission } = await makeTeamWithSubmission(2);
      const evaluatorA = await makeUser('EVALUATOR');
      const evaluatorB = await makeUser('EVALUATOR');

      mockSession(evaluatorA);
      const first = await saveEvaluationAction({
        submissionId: submission.id,
        score: 400,
        status: 'IN_REVIEW',
      });
      expect(first.success).toBe(true);
      const staleVersion = first.data!.version;

      // A saves again, moving the version on.
      const second = await saveEvaluationAction({
        submissionId: submission.id,
        score: 500,
        status: 'IN_REVIEW',
        version: staleVersion,
      });
      expect(second.success).toBe(true);

      // B still holds the version it loaded before A's second save.
      mockSession(evaluatorB);
      const stale = await saveEvaluationAction({
        submissionId: submission.id,
        score: 900,
        status: 'IN_REVIEW',
        version: staleVersion,
      });
      expect(stale.success).toBe(false);

      const stored = await prisma.evaluation.findUnique({ where: { submissionId: submission.id } });
      expect(stored?.score).toBe(500);
    });

    it('concurrent saves leave exactly one evaluation row and a score within range', async () => {
      await configureLevelMax(2, 1000);
      const { submission } = await makeTeamWithSubmission(2);
      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      const results = await Promise.allSettled(
        [100, 200, 300, 400, 500, 600].map((score) =>
          saveEvaluationAction({ submissionId: submission.id, score, status: 'IN_REVIEW' }),
        ),
      );
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

      const rows = await prisma.evaluation.findMany({ where: { submissionId: submission.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.score).toBeGreaterThanOrEqual(0);
      expect(rows[0]!.score).toBeLessThanOrEqual(1000);
    });

    it('concurrent approvals apply the score once and leave the total consistent', async () => {
      await configureLevelMax(2, 1000);
      const { team, submission } = await makeTeamWithSubmission(2);
      const evaluator = await makeUser('EVALUATOR');
      const adminA = await makeUser('ADMIN');
      const adminB = await makeUser('ADMIN');

      mockSession(evaluator);
      await saveEvaluationAction({ submissionId: submission.id, score: 750, status: 'EVALUATED' });
      const evaluation = await prisma.evaluation.findUnique({
        where: { submissionId: submission.id },
      });

      mockSession(adminA);
      const [a, b] = await Promise.allSettled([
        approveEvaluationAction(evaluation!.id),
        approveEvaluationAction(evaluation!.id),
      ]);

      const succeeded = [a, b].filter(
        (r) => r.status === 'fulfilled' && (r.value as { success: boolean }).success,
      );
      expect(succeeded).toHaveLength(1);
      expect(adminB.id).toBeTruthy(); // second admin account exists; approval is still single

      const total = await computeTeamOfficialTotal(prisma, team.id);
      expect(total.level2).toBe(750);

      const stored = await prisma.team.findUnique({ where: { id: team.id } });
      expect(stored?.score).toBe(total.total);
    });

    it('never applies one squad’s score to another', async () => {
      await configureLevelMax(2, 1000);
      const squadA = await makeTeamWithSubmission(2);
      const squadB = await makeTeamWithSubmission(2);
      const evaluator = await makeUser('EVALUATOR');
      const admin = await makeUser('ADMIN');

      mockSession(evaluator);
      await saveEvaluationAction({
        submissionId: squadA.submission.id,
        score: 800,
        status: 'EVALUATED',
      });
      await saveEvaluationAction({
        submissionId: squadB.submission.id,
        score: 300,
        status: 'EVALUATED',
      });

      const evalA = await prisma.evaluation.findUnique({
        where: { submissionId: squadA.submission.id },
      });
      mockSession(admin);
      await approveEvaluationAction(evalA!.id);

      const totalA = await computeTeamOfficialTotal(prisma, squadA.team.id);
      const totalB = await computeTeamOfficialTotal(prisma, squadB.team.id);

      expect(totalA.level2).toBe(800);
      // B's evaluation is submitted but unapproved — it must stay at zero, and it
      // must certainly not pick up A's 800.
      expect(totalB.level2).toBe(0);
    });
  });

  // =========================================================================
  // MISCONFIGURED RUBRIC, THROUGH THE ACTION
  // =========================================================================
  describe('A rubric that disagrees with the configured maximum', () => {
    it('refuses a criterion-by-criterion save rather than scoring against it', async () => {
      await configureLevelMax(2, 1000);
      const { submission } = await makeTeamWithSubmission(2);

      await prisma.evaluationCriterion.createMany({
        data: Array.from({ length: 8 }, (_, i) => ({
          levelNumber: 2,
          title: `Leaked ${i + 1}`,
          maxPoints: 250,
          sortOrder: i + 1,
          isActive: true,
        })),
      });

      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      const criteria = (
        await prisma.evaluationCriterion.findMany({ where: { levelNumber: 2, isActive: true } })
      ).map((c) => ({
        id: c.id,
        criterionId: c.id,
        name: c.title,
        maxMarks: c.maxPoints,
        awardedMarks: 250,
      }));

      const res = await saveEvaluationAction({
        submissionId: submission.id,
        score: 2000,
        criteria,
        status: 'IN_REVIEW',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('2000');
    });

    it('still allows a single total score within the configured maximum', async () => {
      await configureLevelMax(2, 1000);
      const { submission } = await makeTeamWithSubmission(2);
      await prisma.evaluationCriterion.createMany({
        data: Array.from({ length: 8 }, (_, i) => ({
          levelNumber: 2,
          title: `Leaked ${i + 1}`,
          maxPoints: 250,
          sortOrder: i + 1,
          isActive: true,
        })),
      });

      const evaluator = await makeUser('EVALUATOR');
      mockSession(evaluator);

      const ok = await saveEvaluationAction({
        submissionId: submission.id,
        score: 900,
        status: 'IN_REVIEW',
      });
      expect(ok.success).toBe(true);
      expect(ok.data?.maxScore).toBe(1000);

      const over = await saveEvaluationAction({
        submissionId: submission.id,
        score: 1500,
        status: 'IN_REVIEW',
        // Spread rather than assign: `exactOptionalPropertyTypes` distinguishes
        // "absent" from "present and undefined", and the action's signature
        // accepts the former only.
        ...(typeof ok.data?.version === 'number' ? { version: ok.data.version } : {}),
      });
      expect(over.success).toBe(false);
    });
  });
});

// ===========================================================================
// PARTICIPANT VIEWS CARRY NO EVALUATOR-SCORE SUMMARY
// ===========================================================================
//
// SOURCE assertions, deliberately: the question is which component tree renders
// a rubric ceiling, which is a property of the module graph rather than of any
// one rendered DOM. If an "Evaluator scored" card is ever pasted back onto a
// participant page, this fails on the next run.
describe('Participant workspaces show no evaluator rubric ceiling', () => {
  const PARTICIPANT_VIEWS = [
    'src/components/event/level-2-workspace.tsx',
    'src/components/event/level-3-workspace.tsx',
  ];

  /** Strips JSX and block comments so an explanatory note cannot satisfy a check. */
  function code(rel: string): string {
    return fs
      .readFileSync(path.join(process.cwd(), rel), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
  }

  it('renders no "Evaluator scored" label anywhere a participant can see', () => {
    for (const rel of PARTICIPANT_VIEWS) {
      expect(code(rel), rel).not.toMatch(/Evaluator scored/i);
    }
  });

  it('renders no "LEVEL n RESPONSE" rubric card', () => {
    for (const rel of PARTICIPANT_VIEWS) {
      expect(code(rel), rel).not.toMatch(/LEVEL\s*\d\s*RESPONSE/i);
    }
  });

  it('does not print the report or response rubric ceilings to participants', () => {
    const l3 = code('src/components/event/level-3-workspace.tsx');
    // `scoring.reportPoints` / `scoring.responsePoints` are the per-component
    // maxima an EVALUATOR works to. They belong in the evaluator console.
    expect(l3).not.toContain('scoring.reportPoints');
    expect(l3).not.toContain('scoring.responsePoints');
  });

  it('keeps the squad OWN approved result, which is not an evaluator summary', () => {
    // Removing a squad's own outcome would be a different — and unrequested —
    // change. The distinction under test: a ceiling is internal, a result is theirs.
    const l3 = code('src/components/event/level-3-workspace.tsx');
    expect(l3).toContain('evaluationScore');
  });
});
