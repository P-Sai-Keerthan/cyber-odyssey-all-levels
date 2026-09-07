import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import {
  getEvaluatorSubmissionDetailsAction,
  startEvaluationAction,
  saveEvaluationAction,
} from '@/lib/actions/evaluator-actions';
import {
  approveEvaluationAction,
  rejectEvaluationAction,
} from '@/lib/actions/evaluation-approval-actions';
import {
  createEvaluationCriterionAction,
  updateEvaluationCriterionAction,
} from '@/lib/actions/evaluation-criteria-actions';
import * as sessionModule from '@/lib/auth/session';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

interface TestUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof sessionModule.getSessionUser>>>;

describe('ACN Cyber Odyssey — Dynamic Evaluation Engine Test Suite', () => {
  let evaluator1: TestUser;
  let evaluator2: TestUser;
  let adminUser: TestUser;
  let participantUser: TestUser;
  let testTeam: { id: string; name: string; score: number };
  let level2Submission: { id: string; teamId: string; level: number };
  let level3Submission: { id: string; teamId: string; level: number };

  /**
   * Removes the criteria this suite creates.
   *
   * WHY: `beforeEach` wipes EvaluationCriterion and inserts four Level 2 rows of
   * its own. Without a matching teardown those four SURVIVE the run — and the
   * seed then re-adds the four real ones, so the evaluator console renders EIGHT
   * criteria totalling 2000 PTS for a level configured at 1000. Every number is
   * faithfully from the database, which is what makes it hard to spot.
   *
   * The tests point at a disposable database (see vitest.config.mts), so this is
   * belt-and-braces — but the failure mode it prevents is one that reaches an
   * evaluator's screen, and a suite that cleans up after itself cannot cause it
   * wherever it is pointed.
   */
  afterAll(async () => {
    await prisma.evaluationScore.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.evaluationCriterion.deleteMany({});
  });

  beforeEach(async () => {
    // Clean up relevant tables
    await prisma.evaluationScore.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.evaluationCriterion.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});

    const passwordHash = await hashPassword('Odyssey2026!');

    evaluator1 = await prisma.user.create({
      data: {
        email: 'evaluator1@acn.org',
        username: 'evaluator_one',
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });

    evaluator2 = await prisma.user.create({
      data: {
        email: 'evaluator2@acn.org',
        username: 'evaluator_two',
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });

    adminUser = await prisma.user.create({
      data: {
        email: 'admin@acn.org',
        username: 'admin_lead',
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    participantUser = await prisma.user.create({
      data: {
        email: 'lead@squad1.org',
        username: 'squad_leader',
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    testTeam = await prisma.team.create({
      data: {
        name: 'Alpha Defense Unit',
        code: 'SQUAD-ALPHA-999',
        passwordHash,
        creatorId: participantUser.id,
        score: 0,
        status: 'ACTIVE',
      },
    });

    await prisma.teamMember.create({
      data: {
        teamId: testTeam.id,
        userId: participantUser.id,
        role: 'HEAD',
      },
    });

    // Seed Level 2 Submission
    level2Submission = await prisma.submission.create({
      data: {
        teamId: testTeam.id,
        userId: participantUser.id,
        level: 2,
        status: 'SUBMITTED',
      },
    });

    // Seed Level 3 Submission
    level3Submission = await prisma.submission.create({
      data: {
        teamId: testTeam.id,
        userId: participantUser.id,
        level: 3,
        status: 'SUBMITTED',
      },
    });

    // The level maximum each rubric below breaks down.
    //
    // `LevelState.maxScore` is the authoritative ceiling and a rubric is a
    // breakdown of it, so a fixture that seeds criteria must seed the matching
    // maximum too. Without this the suite inherited whatever maximum a
    // previously-run suite happened to leave, which made it pass or fail
    // depending on file order.
    for (const levelNumber of [2, 3]) {
      await prisma.levelState.upsert({
        where: { levelNumber },
        update: { maxScore: 1000 },
        create: {
          levelNumber,
          name: `Level ${levelNumber}`,
          codename: `LEVEL_${levelNumber}`,
          status: 'LIVE',
          maxScore: 1000,
          durationMinutes: 120,
          durationSeconds: 7200,
          remainingSeconds: 7200,
        },
      });
    }

    // Seed Level 2 Criteria (4 x 250 = 1000 pts)
    await prisma.evaluationCriterion.createMany({
      data: [
        {
          levelNumber: 2,
          title: 'Initial Access & Attack Vector',
          description: 'Identification of entry point',
          maxPoints: 250,
          sortOrder: 1,
          isActive: true,
          guidance: 'Verify correlation between access logs and macro artifact.',
        },
        {
          levelNumber: 2,
          title: 'Execution & Weaponization Analysis',
          description: 'Detailed disassembly or behavioural breakdown',
          maxPoints: 250,
          sortOrder: 2,
          isActive: true,
        },
        {
          levelNumber: 2,
          title: 'Lateral Movement Tracking',
          description: 'Pivoting and credential dumping documentation',
          maxPoints: 250,
          sortOrder: 3,
          isActive: true,
        },
        {
          levelNumber: 2,
          title: 'Evidence Preservation & Final Forensics Report',
          description: 'Chain of custody, hash verifications, quality',
          maxPoints: 250,
          sortOrder: 4,
          isActive: true,
        },
      ],
    });

    // Seed Level 3 Criteria (4 x 250 = 1000 pts)
    await prisma.evaluationCriterion.createMany({
      data: [
        {
          levelNumber: 3,
          title: 'Executive Summary & Business Impact',
          description: 'Clarity for senior decision-makers',
          maxPoints: 250,
          sortOrder: 1,
          isActive: true,
        },
        {
          levelNumber: 3,
          title: 'Root Cause & Vulnerability Analysis',
          description: 'Technical depth of the web flaw exploited',
          maxPoints: 250,
          sortOrder: 2,
          isActive: true,
        },
        {
          levelNumber: 3,
          title: 'Remediation Architecture & Hardening Roadmap',
          description: 'Concrete patches and preventative measures',
          maxPoints: 250,
          sortOrder: 3,
          isActive: true,
        },
        {
          levelNumber: 3,
          title: 'IOC & SIEM Rule Quality',
          description: 'Actionable detection rules (Sigma/YARA)',
          maxPoints: 250,
          sortOrder: 4,
          isActive: true,
        },
      ],
    });

    // Default session: evaluator1
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
      evaluator1 as unknown as SessionUser,
    );
  });

  // =========================================================================
  // 1. DYNAMIC MAX SCORE CALCULATION
  // =========================================================================
  describe('1. Dynamic Max Score Resolution', () => {
    it('calculates dynamic max score from sum of active criteria for Level 2', async () => {
      const details = await getEvaluatorSubmissionDetailsAction(level2Submission.id);
      expect(details.success).toBe(true);
      expect(details.data?.maxPossibleScore).toBe(1000);
      expect(details.data?.criteria.length).toBe(4);
    });

    it('dynamically recalculates max score when an admin adds or modifies criteria', async () => {
      // Mock session to admin to add a 5th criterion of 100 points
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );

      const addRes = await createEvaluationCriterionAction({
        levelNumber: 2,
        title: 'Bonus Threat Intel Attribution',
        maxPoints: 100,
      });
      expect(addRes.success).toBe(true);

      // Switch back to evaluator
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluator1 as unknown as SessionUser,
      );

      const details = await getEvaluatorSubmissionDetailsAction(level2Submission.id);
      expect(details.success).toBe(true);

      // ARCHITECTURE CHANGE (deliberate): the ceiling is the LEVEL's configured
      // maximum, and a rubric is a breakdown of it. Adding a criterion no longer
      // raises the cap to 1100 — the level is still configured at 1000, so the
      // rubric now disagrees with it and is SUPPRESSED rather than silently
      // becoming authoritative.
      //
      // The old behaviour is precisely how a leaked test fixture turned Level 2
      // into an 8-criterion, 2000-point level on a real evaluator's screen with
      // every figure rendered faithfully from the database.
      expect(details.data?.maxPossibleScore).toBe(1000);
      expect(details.data?.criteria.length).toBe(0);
      expect(details.data?.criteriaMismatch).toContain('1100');
      expect(details.data?.criteriaMismatch).toContain('1000');
    });

    it('uses the rubric when an admin keeps it summing to the configured maximum', async () => {
      // The same edit, done consistently: shrink an existing criterion by the
      // amount the new one adds. The rubric still totals 1000, so it is used.
      const existing = await prisma.evaluationCriterion.findFirst({
        where: { levelNumber: 2, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );
      await updateEvaluationCriterionAction(existing!.id, { maxPoints: 150 });
      const addRes = await createEvaluationCriterionAction({
        levelNumber: 2,
        title: 'Bonus Threat Intel Attribution',
        maxPoints: 100,
      });
      expect(addRes.success).toBe(true);

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluator1 as unknown as SessionUser,
      );

      const details = await getEvaluatorSubmissionDetailsAction(level2Submission.id);
      expect(details.success).toBe(true);
      expect(details.data?.maxPossibleScore).toBe(1000);
      expect(details.data?.criteria.length).toBe(5);
      expect(details.data?.criteriaMismatch).toBeNull();
    });

    it('excludes inactive criteria from the dynamic max score', async () => {
      // Deactivate one 250-pt criterion
      const crit = await prisma.evaluationCriterion.findFirst({
        where: { levelNumber: 2, title: 'Lateral Movement Tracking' },
      });
      expect(crit).toBeDefined();

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );
      await updateEvaluationCriterionAction(crit!.id, { isActive: false });

      // Switch back to evaluator
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluator1 as unknown as SessionUser,
      );

      const details = await getEvaluatorSubmissionDetailsAction(level2Submission.id);
      expect(details.success).toBe(true);

      // The inactive criterion is still excluded — that part is unchanged, and
      // the mismatch message proves it by reporting 750, not 1000.
      //
      // What changed is the consequence: 750 no longer becomes the ceiling. The
      // level is configured at 1000, the rubric no longer adds up to it, so the
      // rubric is suppressed and the evaluator scores out of the configured
      // maximum with an explanation instead of a silently reduced denominator.
      expect(details.data?.maxPossibleScore).toBe(1000);
      expect(details.data?.criteria.length).toBe(0);
      expect(details.data?.criteriaMismatch).toContain('750');
      expect(details.data?.criteriaMismatch).toContain('3 active evaluation criteria');
    });
  });

  // =========================================================================
  // 2. SCORING & CRITERIA VALIDATION
  // =========================================================================
  describe('2. Criteria Score Validation & Error Handling', () => {
    it('rejects evaluation when a criterion awarded score is negative', async () => {
      const activeCriteria = await prisma.evaluationCriterion.findMany({
        where: { levelNumber: 2, isActive: true },
      });

      const criteria = activeCriteria.map((c, i) => ({
        id: c.id,
        criterionId: c.id,
        name: c.title,
        maxMarks: c.maxPoints,
        awardedMarks: i === 0 ? -10 : 200,
      }));

      const res = await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 590,
        criteria,
        status: 'IN_REVIEW',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('cannot be negative');
    });

    it('rejects evaluation when a criterion awarded score exceeds its maxPoints', async () => {
      const activeCriteria = await prisma.evaluationCriterion.findMany({
        where: { levelNumber: 2, isActive: true },
      });

      const criteria = activeCriteria.map((c, i) => ({
        id: c.id,
        criterionId: c.id,
        name: c.title,
        maxMarks: c.maxPoints,
        awardedMarks: i === 0 ? 300 : 200, // 300 > 250 max
      }));

      const res = await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 900,
        criteria,
        status: 'IN_REVIEW',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('exceed the maximum allowable');
    });

    it('rejects total score exceeding dynamic level maximum', async () => {
      const res = await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 1200, // 1200 > 1000 max
        status: 'EVALUATED',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('outside the permitted range');
    });
  });

  // =========================================================================
  // 3. NORMALIZED PERSISTENCE IN EVALUATIONSCORE
  // =========================================================================
  describe('3. Normalized EvaluationScore Persistence', () => {
    it('persists individual criteria scores into EvaluationScore table', async () => {
      await startEvaluationAction(level2Submission.id);

      const activeCriteria = await prisma.evaluationCriterion.findMany({
        where: { levelNumber: 2, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });

      const criteriaInput = [
        {
          id: activeCriteria[0]!.id,
          criterionId: activeCriteria[0]!.id,
          name: activeCriteria[0]!.title,
          maxMarks: 250,
          awardedMarks: 230,
          feedback: 'Accurate ISO macro identification.',
        },
        {
          id: activeCriteria[1]!.id,
          criterionId: activeCriteria[1]!.id,
          name: activeCriteria[1]!.title,
          maxMarks: 250,
          awardedMarks: 240,
          feedback: 'Solid shellcode extraction.',
        },
        {
          id: activeCriteria[2]!.id,
          criterionId: activeCriteria[2]!.id,
          name: activeCriteria[2]!.title,
          maxMarks: 250,
          awardedMarks: 210,
          feedback: 'Clear lateral movement graph.',
        },
        {
          id: activeCriteria[3]!.id,
          criterionId: activeCriteria[3]!.id,
          name: activeCriteria[3]!.title,
          maxMarks: 250,
          awardedMarks: 250,
          feedback: 'Exemplary forensic report formatting.',
        },
      ];

      const saveRes = await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 930,
        criteria: criteriaInput,
        notes: 'Confidential evaluator note: validated hashes with SIEM.',
        feedback: 'Great investigation overall.',
        status: 'EVALUATED',
        version: 1,
      });

      expect(saveRes.success).toBe(true);
      expect(saveRes.data?.score).toBe(930);
      expect(saveRes.data?.maxScore).toBe(1000);

      // Verify EvaluationScore rows in database
      const evaluation = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: level2Submission.id },
        include: { scores: true },
      });

      expect(evaluation.scores.length).toBe(4);
      const score1 = evaluation.scores.find((s) => s.criterionId === activeCriteria[0]!.id);
      expect(score1?.awardedScore).toBe(230);
      expect(score1?.notes).toBe('Accurate ISO macro identification.');

      const score4 = evaluation.scores.find((s) => s.criterionId === activeCriteria[3]!.id);
      expect(score4?.awardedScore).toBe(250);

      // Verify confidential notes vs squad feedback separation
      expect(evaluation.notes).toBe('Confidential evaluator note: validated hashes with SIEM.');
      expect(evaluation.feedback).toBe('Great investigation overall.');
    });
  });

  // =========================================================================
  // 4. CONCURRENCY & OPTIMISTIC LOCKING
  // =========================================================================
  describe('4. Optimistic Locking & Concurrency Protection', () => {
    it('prevents concurrent evaluator edits from silently overwriting scores', async () => {
      // Evaluator 1 starts evaluation
      await startEvaluationAction(level2Submission.id);

      // Evaluator 1 saves draft v1 -> moves to v2
      const save1 = await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 750,
        status: 'IN_REVIEW',
        version: 1,
      });
      expect(save1.success).toBe(true);
      expect(save1.data?.version).toBe(2);

      // Switch to Evaluator 2
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluator2 as unknown as SessionUser,
      );

      // Evaluator 2 attempts to save with stale v1
      const staleSave = await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 800,
        status: 'EVALUATED',
        version: 1, // Stale!
      });

      expect(staleSave.success).toBe(false);
      expect(staleSave.error).toContain('modified by another evaluator');

      // Evaluator 2 reloads (gets v2) and saves -> succeeds
      const freshSave = await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 850,
        status: 'EVALUATED',
        version: 2,
      });

      expect(freshSave.success).toBe(true);
      expect(freshSave.data?.score).toBe(850);
      expect(freshSave.data?.version).toBe(3);
    });
  });

  // =========================================================================
  // 5. ADMIN APPROVAL & LEADERBOARD GATE
  // =========================================================================
  describe('5. Admin Approval & Leaderboard Gate Isolation', () => {
    it('keeps evaluation isolated from leaderboard until Admin approval', async () => {
      // 1. Evaluator submits 950 points
      await startEvaluationAction(level2Submission.id);
      await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 950,
        status: 'EVALUATED',
        version: 1,
      });

      // Verification 1: Evaluation is PENDING_APPROVAL
      const evaluation = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: level2Submission.id },
      });
      expect(evaluation.approvalStatus).toBe('PENDING_APPROVAL');

      // Verification 2: Team score is NOT updated on leaderboard
      let team = await prisma.team.findUniqueOrThrow({ where: { id: testTeam.id } });
      expect(team.score).toBe(0);

      // 2. Admin logs in and approves evaluation
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );

      const approveRes = await approveEvaluationAction(evaluation.id);
      expect(approveRes.success).toBe(true);
      expect(approveRes.data?.teamScore).toBe(950);

      // Verification 3: Team score is now atomically updated on leaderboard
      team = await prisma.team.findUniqueOrThrow({ where: { id: testTeam.id } });
      expect(team.score).toBe(950);

      const approvedEval = await prisma.evaluation.findUniqueOrThrow({
        where: { id: evaluation.id },
      });
      expect(approvedEval.approvalStatus).toBe('APPROVED');
      expect(approvedEval.approvedById).toBe(adminUser.id);
    });

    it('handles admin rejection and returns evaluation for revision', async () => {
      await startEvaluationAction(level2Submission.id);
      await saveEvaluationAction({
        submissionId: level2Submission.id,
        score: 600,
        status: 'EVALUATED',
        version: 1,
      });

      const evaluation = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: level2Submission.id },
      });

      // Admin rejects with mandatory reason
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );

      const rejectRes = await rejectEvaluationAction(
        evaluation.id,
        'Criteria 3 marks were not justified by attached evidence.',
      );
      expect(rejectRes.success).toBe(true);

      const rejectedEval = await prisma.evaluation.findUniqueOrThrow({
        where: { id: evaluation.id },
      });
      expect(rejectedEval.approvalStatus).toBe('REJECTED');
      expect(rejectedEval.rejectionReason).toBe(
        'Criteria 3 marks were not justified by attached evidence.',
      );

      // Team score must remain 0
      const team = await prisma.team.findUniqueOrThrow({ where: { id: testTeam.id } });
      expect(team.score).toBe(0);
    });
  });

  // =========================================================================
  // 6. LEVEL 3 INCIDENT REPORT EVALUATION
  // =========================================================================
  describe('6. Level 3 Report Dynamic Evaluation', () => {
    it('evaluates Level 3 incident report using dynamic Level 3 criteria', async () => {
      // Evaluator starts Level 3 evaluation
      const startRes = await startEvaluationAction(level3Submission.id);
      expect(startRes.success).toBe(true);

      const details = await getEvaluatorSubmissionDetailsAction(level3Submission.id);
      expect(details.success).toBe(true);
      expect(details.data?.level).toBe(3);
      expect(details.data?.maxPossibleScore).toBe(1000);
      expect(details.data?.criteria[0]?.name).toBe('Executive Summary & Business Impact');

      // Evaluator saves Level 3 evaluation
      const saveRes = await saveEvaluationAction({
        submissionId: level3Submission.id,
        score: 880,
        criteria: details.data!.criteria.map((c) => ({
          ...c,
          awardedMarks: 220,
        })),
        notes: 'Well articulated incident timeline and business impact.',
        feedback: 'Excellent Sigma detection rules for the web exploit.',
        status: 'EVALUATED',
        version: 1,
      });

      expect(saveRes.success).toBe(true);
      expect(saveRes.data?.score).toBe(880);
      expect(saveRes.data?.maxScore).toBe(1000);

      const eval3 = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: level3Submission.id },
        include: { scores: true },
      });
      expect(eval3.level).toBe(3);
      expect(eval3.scores.length).toBe(4);
    });
  });
});
