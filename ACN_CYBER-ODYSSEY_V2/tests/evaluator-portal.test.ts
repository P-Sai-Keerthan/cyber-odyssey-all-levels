import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import {
  getEvaluatorOverviewStatsAction,
  getEvaluatorTeamsAction,
  getEvaluatorTeamDetailsAction,
  getEvaluatorSubmissionsAction,
  getEvaluatorSubmissionDetailsAction,
  startEvaluationAction,
  saveEvaluationAction,
  getEvaluatorActivityLogsAction,
  getEvaluatorSquadSubmissionStatusesAction,
} from '@/lib/actions/evaluator-actions';
import {
  approveStaffAction,
  deleteAccountAction,
  setPortalStatusAction,
} from '@/lib/actions/creator-actions';
import * as sessionModule from '@/lib/auth/session';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

interface TestUser {
  id: string;
  email: string;
  username: string;
  passwordHash?: string;
  role: string;
  status: string;
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof sessionModule.getSessionUser>>>;

describe('ACN Cyber Odyssey — Evaluator Portal Test Suite', () => {
  let evaluatorUser: TestUser;
  let evaluatorUser2: TestUser;
  let participantUser: TestUser;
  let testTeam: { id: string; name: string; code: string; score: number };
  let testSubmission: { id: string; teamId: string; userId: string; level: number; status: string };

  beforeEach(async () => {
    // Reset database tables before each test
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

    // Seed Level 2 evaluation criteria (4 x 250 = 1000 points total)
    await prisma.evaluationCriterion.createMany({
      data: [
        {
          levelNumber: 2,
          title: 'Vector Triage',
          description: 'Intrusion Vector Identification',
          maxPoints: 250,
          sortOrder: 1,
          isActive: true,
        },
        {
          levelNumber: 2,
          title: 'Payload Analysis',
          description: 'Decrypted Evidence Verification',
          maxPoints: 250,
          sortOrder: 2,
          isActive: true,
        },
        {
          levelNumber: 2,
          title: 'Persistence Mechanism',
          description: 'Adversary Persistence Mechanism',
          maxPoints: 250,
          sortOrder: 3,
          isActive: true,
        },
        {
          levelNumber: 2,
          title: 'Report Quality',
          description: 'Forensics Investigation Report Quality',
          maxPoints: 250,
          sortOrder: 4,
          isActive: true,
        },
      ],
    });

    const passwordHash = await hashPassword('CyberOdyssey2026!');

    // 1. Seed Evaluator
    evaluatorUser = await prisma.user.create({
      data: {
        email: 'evaluator1@acn.org',
        username: 'evaluator_alpha',
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });

    // 2. Seed Second Evaluator (for concurrency tests)
    evaluatorUser2 = await prisma.user.create({
      data: {
        email: 'evaluator2@acn.org',
        username: 'evaluator_bravo',
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });

    // 3. Seed Participant
    participantUser = await prisma.user.create({
      data: {
        email: 'participant1@cyber.org',
        username: 'analyst_zero',
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    // 6. Seed Team with Join Code
    testTeam = await prisma.team.create({
      data: {
        name: 'Cyber Phantoms',
        code: 'CYB-SECRET-JOIN-9999',
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

    // 7. Seed Level 2 Forensic Submission
    testSubmission = await prisma.submission.create({
      data: {
        teamId: testTeam.id,
        userId: participantUser.id,
        level: 2,
        status: 'SUBMITTED',
        answers: JSON.stringify({
          q1_intrusionVector: 'Spear-phishing email with malicious macro ISO',
          q2_decryptedHash: 'e99a18c428cb38d5f260853678922e03',
          q3_persistenceMechanism: 'Scheduled Task impersonating Windows Update Service',
        }),
      },
    });

    // Seed attached deliverable file
    await prisma.submissionFile.create({
      data: {
        submissionId: testSubmission.id,
        fileName: 'lvl2_test_report.pdf',
        originalName: 'forensics_investigation_report.pdf',
        fileSize: 1048576,
        mimeType: 'application/pdf',
        storagePath: 'uploads/submissions/level-2/lvl2_test_report.pdf',
      },
    });

    // Default mock session to evaluatorUser
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
      evaluatorUser as unknown as SessionUser,
    );
  });

  // =========================================================================
  // 1. EVALUATOR AUTHORIZATION & BOUNDARIES (Requirements 1, 18)
  // =========================================================================
  describe('1. Evaluator Role & Boundary Isolation', () => {
    it('allows verified ACTIVE Evaluator to access evaluator overview', async () => {
      const result = await getEvaluatorOverviewStatsAction();
      expect(result.success).toBe(true);
      expect(result.data?.totalTeams).toBe(1);
      expect(result.data?.totalSubmissions).toBe(1);
      expect(result.data?.activeLevel).toBe(2);
    });

    it('rejects unauthenticated user from accessing evaluator actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(null);

      const result = await getEvaluatorOverviewStatsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('session has expired');
    });

    it('rejects PARTICIPANT from accessing evaluator actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUser as unknown as SessionUser,
      );

      const result = await getEvaluatorOverviewStatsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not have permission to access the evaluation console');
    });

    it('denies EVALUATOR from accessing Creator staff approval action', async () => {
      // Evaluator tries to execute a Creator action
      const result = await approveStaffAction(evaluatorUser2.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized. Creator privilege');
    });

    it('denies EVALUATOR from deleting accounts (Creator boundary)', async () => {
      const result = await deleteAccountAction(participantUser.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized. Creator privilege');
    });

    it('denies EVALUATOR from modifying portal online/offline status (Creator boundary)', async () => {
      const result = await setPortalStatusAction(false);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized. Creator privilege');
    });

    it('rejects BLOCKED or SUSPENDED Evaluator from performing actions', async () => {
      const blockedEvaluator = await prisma.user.create({
        data: {
          email: 'blocked_evaluator@acn.org',
          username: 'blocked_evaluator',
          passwordHash: 'hash',
          role: 'EVALUATOR',
          status: 'BLOCKED',
        },
      });

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        blockedEvaluator as unknown as SessionUser,
      );

      const result = await getEvaluatorOverviewStatsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not have permission to access the evaluation console');
    });
  });

  // =========================================================================
  // 2. SQUAD DIRECTORY & PRIVACY (Requirements 5, 14, 15)
  // =========================================================================
  describe('2. Squad Directory & Privacy Guards', () => {
    it('retrieves squad list and NEVER exposes team join codes', async () => {
      const result = await getEvaluatorTeamsAction({ page: 1, limit: 10 });
      expect(result.success).toBe(true);
      expect(result.data?.teams.length).toBe(1);

      const team = result.data?.teams[0];
      expect(team?.name).toBe('Cyber Phantoms');
      expect(team?.teamHead).toBe('@analyst_zero');
      expect(team?.membersCount).toBe(1);
      // Verify join code is completely omitted
      expect((team as unknown as Record<string, unknown>)['code']).toBeUndefined();
      expect((team as unknown as Record<string, unknown>)['passwordHash']).toBeUndefined();
    });

    it('retrieves squad details with level breakdown and no private secrets', async () => {
      const result = await getEvaluatorTeamDetailsAction(testTeam.id);
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Cyber Phantoms');
      expect(result.data?.roster.length).toBe(1);
      expect(result.data?.roster[0]?.role).toBe('Team Head');
      expect((result.data as unknown as Record<string, unknown>)['code']).toBeUndefined();
      expect(result.data?.levelScores.total).toBe(0);
    });

    it('returns error when requesting non-existent team ID', async () => {
      const result = await getEvaluatorTeamDetailsAction('non_existent_team_id_999');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // =========================================================================
  // 3. SUBMISSIONS & INVESTIGATION INTAKE (Requirements 6, 7, 8)
  // =========================================================================
  describe('3. Submissions & Forensic Intake', () => {
    it('lists submissions and supports filtering by level and status', async () => {
      const result = await getEvaluatorSubmissionsAction({ level: 2, status: 'PENDING' });
      expect(result.success).toBe(true);
      expect(result.data?.submissions.length).toBe(1);

      const sub = result.data?.submissions[0];
      expect(sub?.teamName).toBe('Cyber Phantoms');
      expect(sub?.level).toBe(2);
      expect(sub?.filesCount).toBe(1);
    });

    it('retrieves detailed submission payload, parsed answers, and logs SUBMISSION_OPENED', async () => {
      const result = await getEvaluatorSubmissionDetailsAction(testSubmission.id);
      expect(result.success).toBe(true);
      expect(result.data?.answers?.['q1_intrusionVector']).toContain('Spear-phishing');
      expect(result.data?.files.length).toBe(1);
      expect(result.data?.files[0]?.originalName).toBe('forensics_investigation_report.pdf');

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'SUBMISSION_OPENED', actorId: evaluatorUser.id },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('opened Level 2 deliverables');
    });

    it('strictly excludes Level 1 from deliverable submissions and returns summary stats', async () => {
      // Level 1 explicitly requested returns 0 deliverable submissions
      const level1Res = await getEvaluatorSubmissionsAction({ level: 1 });
      expect(level1Res.success).toBe(true);
      expect(level1Res.data?.submissions.length).toBe(0);
      expect(level1Res.data?.totalCount).toBe(0);

      // Submissions summary stats returned and reflect real database counts
      expect(level1Res.data?.summaryStats).toBeDefined();
      expect(level1Res.data?.summaryStats.totalSubmissions).toBeGreaterThanOrEqual(1);
      expect(level1Res.data?.summaryStats.level2Submissions).toBeGreaterThanOrEqual(1);
    });

    it('resolves submitter display name, team head, and deliverable breakdown', async () => {
      const result = await getEvaluatorSubmissionsAction({ level: 2 });
      expect(result.success).toBe(true);
      const sub = result.data?.submissions[0];
      expect(sub).toBeDefined();
      expect(sub?.submitterName).toBeDefined();
      expect(sub?.submitterRole).toBeDefined();
      expect(sub?.teamHead).toBeDefined();
      expect(sub?.deliverablesSummary).toBeDefined();
      expect(sub?.hasReport).toBe(true);
    });

    it('queries squad submission status matrix distinguishing submitted vs unsubmitted teams without fake records', async () => {
      const result = await getEvaluatorSquadSubmissionStatusesAction();
      expect(result.success).toBe(true);
      expect(result.data?.squads.length).toBeGreaterThanOrEqual(1);

      const teamStatus = result.data?.squads.find((s) => s.teamId === testTeam.id);
      expect(teamStatus).toBeDefined();
      expect(teamStatus?.teamName).toBe('Cyber Phantoms');
      expect(teamStatus?.level2Submission.submitted).toBe(true);
      expect(teamStatus?.level2Submission.submissionId).toBe(testSubmission.id);
      expect(teamStatus?.level3Submission.submitted).toBe(false);
    });

    it('handles non-existent submission gracefully', async () => {
      const result = await getEvaluatorSubmissionDetailsAction('non_existent_sub_id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // =========================================================================
  // 4. EVALUATION & SCORING (Requirements 9, 10, 11, 20)
  // =========================================================================
  describe('4. Forensic Evaluation, Scoring & Concurrency', () => {
    it('starts evaluation workflow, transitions to IN_REVIEW, and emits EVALUATION_STARTED audit', async () => {
      const startRes = await startEvaluationAction(testSubmission.id);
      expect(startRes.success).toBe(true);
      expect(startRes.data?.version).toBe(1);

      const evaluation = await prisma.evaluation.findUnique({
        where: { submissionId: testSubmission.id },
      });
      expect(evaluation?.status).toBe('IN_REVIEW');
      expect(evaluation?.evaluatorId).toBe(evaluatorUser.id);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'EVALUATION_STARTED' },
      });
      expect(audit).toBeDefined();
    });

    it('submits evaluation, updates submission status to ACCEPTED, and recalculates team score', async () => {
      // 1. Start evaluation
      await startEvaluationAction(testSubmission.id);

      // 2. Submit evaluation with criteria marks
      const criteria = [
        { id: 'crit_1', name: 'Vector Triage', maxMarks: 250, awardedMarks: 200 },
        { id: 'crit_2', name: 'Payload Analysis', maxMarks: 250, awardedMarks: 220 },
        { id: 'crit_3', name: 'Persistence Mechanism', maxMarks: 250, awardedMarks: 230 },
        { id: 'crit_4', name: 'Report Quality', maxMarks: 250, awardedMarks: 250 },
      ];

      const saveRes = await saveEvaluationAction({
        submissionId: testSubmission.id,
        score: 900,
        criteria,
        notes: 'High quality forensic artifact reconstruction.',
        feedback: 'Excellent lateral movement timeline analysis.',
        status: 'EVALUATED',
        version: 1,
      });

      expect(saveRes.success).toBe(true);
      expect(saveRes.data?.score).toBe(900);
      expect(saveRes.data?.maxScore).toBe(1000);
      expect(saveRes.data?.status).toBe('EVALUATED');

      // APPROVAL GATE: the evaluator's score is recorded but withheld from the
      // leaderboard until an Admin approves it (Admin spec section 10).
      const storedEval = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: testSubmission.id },
      });
      expect(storedEval.score).toBe(900);
      expect(storedEval.maxScore).toBe(1000);
      expect(storedEval.approvalStatus).toBe('PENDING_APPROVAL');

      const updatedTeam = await prisma.team.findUnique({ where: { id: testTeam.id } });
      expect(updatedTeam?.score).toBe(0);

      // Check Submission status
      const updatedSub = await prisma.submission.findUnique({ where: { id: testSubmission.id } });
      expect(updatedSub?.status).toBe('ACCEPTED');

      // Check Audit Log
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'EVALUATION_SUBMITTED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('Score 900/1000');
    });

    it('rejects invalid scores outside [0, maxScore]', async () => {
      const invalidRes1 = await saveEvaluationAction({
        submissionId: testSubmission.id,
        score: -5,
        status: 'EVALUATED',
      });
      expect(invalidRes1.success).toBe(false);
      expect(invalidRes1.error).toContain('outside the permitted range');

      const invalidRes2 = await saveEvaluationAction({
        submissionId: testSubmission.id,
        score: 1500,
        status: 'EVALUATED',
      });
      expect(invalidRes2.success).toBe(false);
      expect(invalidRes2.error).toContain('outside the permitted range');
    });

    it('enforces optimistic concurrency control to prevent overwriting conflicting evaluator edits', async () => {
      // Start evaluation at version 1
      await startEvaluationAction(testSubmission.id);

      // First evaluator saves version 1 -> advances to version 2
      const res1 = await saveEvaluationAction({
        submissionId: testSubmission.id,
        score: 80,
        status: 'IN_REVIEW',
        version: 1,
      });
      expect(res1.success).toBe(true);

      // Second evaluator attempts to save with stale version 1
      const staleRes = await saveEvaluationAction({
        submissionId: testSubmission.id,
        score: 85,
        status: 'EVALUATED',
        version: 1, // Stale version!
      });
      expect(staleRes.success).toBe(false);
      expect(staleRes.error).toContain('modified by another evaluator');
    });

    it('supports returning deliverables for squad revision', async () => {
      const returnRes = await saveEvaluationAction({
        submissionId: testSubmission.id,
        score: 0,
        feedback: 'Incomplete PCAP memory dump triage. Please re-upload.',
        status: 'RETURNED',
      });

      expect(returnRes.success).toBe(true);
      expect(returnRes.data?.status).toBe('RETURNED');

      const sub = await prisma.submission.findUnique({ where: { id: testSubmission.id } });
      expect(sub?.status).toBe('REJECTED');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'EVALUATION_RETURNED' },
      });
      expect(audit).toBeDefined();
    });
  });

  // =========================================================================
  // 5. AUDIT TELEMETRY & ACTIVITY LOG (Requirements 12, 13)
  // =========================================================================
  describe('5. Evaluator Activity Telemetry', () => {
    it('retrieves paginated evaluator activity logs', async () => {
      await prisma.auditLog.createMany({
        data: [
          {
            actorId: evaluatorUser.id,
            targetId: participantUser.id,
            action: 'SUBMISSION_OPENED',
            details: 'Test opened',
          },
          {
            actorId: evaluatorUser.id,
            targetId: participantUser.id,
            action: 'EVALUATION_SUBMITTED',
            details: 'Test submitted',
          },
        ],
      });

      const result = await getEvaluatorActivityLogsAction({ page: 1, limit: 10 });
      expect(result.success).toBe(true);
      expect(result.data?.logs.length).toBeGreaterThanOrEqual(2);
    });

    it('filters activity logs by action type', async () => {
      await prisma.auditLog.createMany({
        data: [
          {
            actorId: evaluatorUser.id,
            targetId: participantUser.id,
            action: 'FILE_ACCESSED',
            details: 'Downloaded evidence report',
          },
          {
            actorId: evaluatorUser.id,
            targetId: participantUser.id,
            action: 'SCORE_UPDATED',
            details: 'Score adjusted',
          },
        ],
      });

      const result = await getEvaluatorActivityLogsAction({
        page: 1,
        limit: 10,
        action: 'FILE_ACCESSED',
      });
      expect(result.success).toBe(true);
      expect(result.data?.logs.every((l) => l.action === 'FILE_ACCESSED')).toBe(true);
    });
  });
});
