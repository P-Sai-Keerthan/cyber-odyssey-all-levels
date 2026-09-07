import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import {
  getEvaluatorSubmissionDetailsAction,
  startEvaluationAction,
  saveEvaluationAction,
} from '@/lib/actions/evaluator-actions';
import {
  getEvaluationQueueAction,
  approveEvaluationAction,
  rejectEvaluationAction,
} from '@/lib/actions/evaluation-approval-actions';
import { getLeaderboardStandings } from '@/lib/leaderboard/standings';
import { APPROVAL_STATUS } from '@/lib/evaluation/approval';
import { getLevelMaxScore, resetLevelStateVerificationCache } from '@/lib/event/level-state';
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

describe('Unified Database-Driven Evaluator Engine — Production Specification', () => {
  let evaluator: TestUser;
  let admin: TestUser;
  let participant: TestUser;
  let team: { id: string; name: string; score: number };
  let l2Submission: { id: string; teamId: string; level: number };
  let l3Submission: { id: string; teamId: string; level: number };

  beforeEach(async () => {
    resetLevelStateVerificationCache();

    // Clean tables
    await prisma.evaluationScore.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});

    // Ensure LevelState records have database-configured maxScore
    await prisma.levelState.upsert({
      where: { levelNumber: 1 },
      update: { maxScore: 500 },
      create: {
        levelNumber: 1,
        name: 'Level 1 — The Initial Trace',
        codename: 'INITIAL TRACE',
        maxScore: 500,
        status: 'LOCKED',
      },
    });

    await prisma.levelState.upsert({
      where: { levelNumber: 2 },
      update: { maxScore: 1000 },
      create: {
        levelNumber: 2,
        name: "Level 2 — The Boar's Mark",
        codename: "THE BOAR'S MARK",
        maxScore: 1000,
        status: 'LIVE',
      },
    });

    await prisma.levelState.upsert({
      where: { levelNumber: 3 },
      update: { maxScore: 1000 },
      create: {
        levelNumber: 3,
        name: 'Level 3 — The Twelve Axes',
        codename: 'THE TWELVE AXES',
        maxScore: 1000,
        status: 'LOCKED',
      },
    });

    const passwordHash = await hashPassword('Odyssey2026!');

    evaluator = await prisma.user.create({
      data: {
        email: 'evaluator@acn.org',
        username: 'cyber_evaluator',
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });

    admin = await prisma.user.create({
      data: {
        email: 'admin@acn.org',
        username: 'chief_admin',
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    participant = await prisma.user.create({
      data: {
        email: 'squad_lead@alpha.org',
        username: 'alpha_lead',
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    team = await prisma.team.create({
      data: {
        name: 'Squad Phoenix',
        code: 'SQUAD-PHOENIX-01',
        passwordHash,
        creatorId: participant.id,
        score: 0,
        status: 'ACTIVE',
      },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: participant.id,
        role: 'HEAD',
        slot: 1,
      },
    });

    l2Submission = await prisma.submission.create({
      data: {
        teamId: team.id,
        userId: participant.id,
        level: 2,
        status: 'SUBMITTED',
      },
    });

    // Attach sample deliverable file
    await prisma.submissionFile.create({
      data: {
        submissionId: l2Submission.id,
        fileName: 'phoenix_forensics_report.pdf',
        originalName: 'Phoenix_Forensic_Report_L2.pdf',
        fileSize: 1024 * 512,
        mimeType: 'application/pdf',
        storagePath: '/uploads/level-2/report.pdf',
      },
    });

    l3Submission = await prisma.submission.create({
      data: {
        teamId: team.id,
        userId: participant.id,
        level: 3,
        status: 'SUBMITTED',
      },
    });

    await prisma.submissionFile.create({
      data: {
        submissionId: l3Submission.id,
        fileName: 'phoenix_incident_report.pdf',
        originalName: 'Phoenix_Incident_Report_L3.pdf',
        fileSize: 1024 * 768,
        mimeType: 'application/pdf',
        storagePath: '/uploads/level-3/report.pdf',
      },
    });
  });

  function authenticateAs(user: TestUser) {
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(user as unknown as SessionUser);
  }

  it('A & B: Evaluator opens Level 2 submission and sees attached deliverables with database maxScore', async () => {
    authenticateAs(evaluator);

    const res = await getEvaluatorSubmissionDetailsAction(l2Submission.id);
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    // Verifies team & deliverable metadata
    expect(res.data!.teamName).toBe('Squad Phoenix');
    expect(res.data!.level).toBe(2);
    expect(res.data!.files).toHaveLength(1);
    expect(res.data!.files[0]!.originalName).toBe('Phoenix_Forensic_Report_L2.pdf');

    // Verifies database-driven max score (1000 for level 2)
    expect(res.data!.maxPossibleScore).toBe(1000);
  });

  it('Level 1 uses its configured database max score (500)', async () => {
    const l1Max = await getLevelMaxScore(1);
    expect(l1Max).toBe(500);

    const l2Max = await getLevelMaxScore(2);
    expect(l2Max).toBe(1000);

    const l3Max = await getLevelMaxScore(3);
    expect(l3Max).toBe(1000);
  });

  it('C & D: Evaluator enters 850, saves score as draft, and leaderboard does NOT count it', async () => {
    authenticateAs(evaluator);

    // Start review
    const startRes = await startEvaluationAction(l2Submission.id);
    expect(startRes.success).toBe(true);

    // Save draft score of 850
    const saveRes = await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 850,
      notes: 'Initial triage complete. Strong timeline.',
      feedback: 'Good forensic evidence provided.',
      status: 'IN_REVIEW',
      version: startRes.data!.version,
    });

    expect(saveRes.success).toBe(true);
    expect(saveRes.data!.score).toBe(850);
    expect(saveRes.data!.maxScore).toBe(1000);
    expect(saveRes.data!.status).toBe('IN_REVIEW');

    // Verify Evaluation in database is NOT_SUBMITTED (draft)
    const evalInDb = await prisma.evaluation.findUnique({
      where: { submissionId: l2Submission.id },
    });
    expect(evalInDb).not.toBeNull();
    expect(evalInDb!.approvalStatus).toBe(APPROVAL_STATUS.NOT_SUBMITTED);
    expect(evalInDb!.score).toBe(850);

    // G: Leaderboard does NOT count 850
    const standings = await getLeaderboardStandings();
    const phoenixRow = standings.rows.find((r) => r.id === team.id);
    expect(phoenixRow?.levelScores[2]).toBeNull();
    expect(phoenixRow?.totalScore).toBeNull();

    // Verify Team.score in database is 0
    const teamInDb = await prisma.team.findUnique({ where: { id: team.id } });
    expect(teamInDb!.score).toBe(0);
  });

  it('E, F, G: Evaluator submits evaluation -> PENDING_APPROVAL -> Leaderboard does NOT count it', async () => {
    authenticateAs(evaluator);

    // Save & submit evaluation
    const submitRes = await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 850,
      notes: 'Confidential: Flag verified on disk image.',
      feedback: 'Excellent reporting and root cause analysis.',
      status: 'EVALUATED',
      version: 1,
    });

    expect(submitRes.success).toBe(true);
    expect(submitRes.data!.status).toBe('EVALUATED');

    // F: Status becomes PENDING_APPROVAL
    const evalInDb = await prisma.evaluation.findUnique({
      where: { submissionId: l2Submission.id },
    });
    expect(evalInDb!.approvalStatus).toBe(APPROVAL_STATUS.PENDING_APPROVAL);
    expect(evalInDb!.submittedAt).not.toBeNull();

    // G: Leaderboard still does NOT count 850
    const standings = await getLeaderboardStandings();
    const phoenixRow = standings.rows.find((r) => r.id === team.id);
    expect(phoenixRow?.levelScores[2]).toBeNull();

    const teamInDb = await prisma.team.findUnique({ where: { id: team.id } });
    expect(teamInDb!.score).toBe(0);
  });

  it('H, I, J: Admin views attached deliverables, approves evaluation -> status APPROVED -> Leaderboard counts 850', async () => {
    // 1. Evaluator submits 850
    authenticateAs(evaluator);
    await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 850,
      status: 'EVALUATED',
      version: 1,
    });

    const pendingEval = await prisma.evaluation.findUniqueOrThrow({
      where: { submissionId: l2Submission.id },
    });

    // 2. Admin loads approval queue and inspects deliverables
    authenticateAs(admin);
    const queueRes = await getEvaluationQueueAction({ approvalStatus: 'PENDING_APPROVAL' });
    expect(queueRes.success).toBe(true);
    const queueItem = queueRes.data!.evaluations.find((e) => e.id === pendingEval.id);
    expect(queueItem).toBeDefined();
    expect(queueItem!.teamName).toBe('Squad Phoenix');
    expect(queueItem!.score).toBe(850);
    expect(queueItem!.maxScore).toBe(1000);
    expect(queueItem!.files).toHaveLength(1);
    expect(queueItem!.files[0]!.originalName).toBe('Phoenix_Forensic_Report_L2.pdf');

    // 3. Admin approves
    const approveRes = await approveEvaluationAction(pendingEval.id);
    expect(approveRes.success).toBe(true);
    expect(approveRes.data!.approvalStatus).toBe(APPROVAL_STATUS.APPROVED);
    expect(approveRes.data!.teamScore).toBe(850);

    // I: Status becomes APPROVED in DB
    const approvedEval = await prisma.evaluation.findUniqueOrThrow({
      where: { id: pendingEval.id },
    });
    expect(approvedEval.approvalStatus).toBe(APPROVAL_STATUS.APPROVED);
    expect(approvedEval.approvedById).toBe(admin.id);
    expect(approvedEval.approvedAt).not.toBeNull();

    // J: Leaderboard now counts 850
    const standings = await getLeaderboardStandings();
    const phoenixRow = standings.rows.find((r) => r.id === team.id);
    expect(phoenixRow?.levelScores[2]).toBe(850);
    expect(phoenixRow?.totalScore).toBe(850);

    const teamInDb = await prisma.team.findUnique({ where: { id: team.id } });
    expect(teamInDb!.score).toBe(850);
  });

  it('Score Validation: Reject score < 0, score > maxScore, and decimal scores', async () => {
    authenticateAs(evaluator);

    // Negative score
    await expect(
      saveEvaluationAction({
        submissionId: l2Submission.id,
        score: -10,
        status: 'IN_REVIEW',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/outside the permitted range|integer/i),
    });

    // Score above 1000
    await expect(
      saveEvaluationAction({
        submissionId: l2Submission.id,
        score: 1001,
        status: 'IN_REVIEW',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/outside the permitted range|exceeds/i),
    });

    // Non-integer score
    await expect(
      saveEvaluationAction({
        submissionId: l2Submission.id,
        score: 850.5,
        status: 'IN_REVIEW',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/valid integer/i),
    });
  });

  it('Authorization: Non-evaluator rejected, and evaluator cannot self-approve', async () => {
    // Participant cannot evaluate
    authenticateAs(participant);
    await expect(
      saveEvaluationAction({
        submissionId: l2Submission.id,
        score: 900,
        status: 'EVALUATED',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/permission|evaluator/i),
    });

    // Evaluator submits
    authenticateAs(evaluator);
    await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 900,
      status: 'EVALUATED',
    });
    const pendingEval = await prisma.evaluation.findUniqueOrThrow({
      where: { submissionId: l2Submission.id },
    });

    // Evaluator cannot approve own evaluation
    authenticateAs(evaluator);
    const selfApproveRes = await approveEvaluationAction(pendingEval.id);
    expect(selfApproveRes.success).toBe(false);
  });

  it('Admin return for revision allows evaluator to edit and resubmit', async () => {
    // Evaluator submits
    authenticateAs(evaluator);
    await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 500,
      status: 'EVALUATED',
    });
    const pendingEval = await prisma.evaluation.findUniqueOrThrow({
      where: { submissionId: l2Submission.id },
    });

    // Admin rejects with reason
    authenticateAs(admin);
    const rejectRes = await rejectEvaluationAction(
      pendingEval.id,
      'Evidence attachment #2 was not graded. Please review and revise score.',
    );
    expect(rejectRes.success).toBe(true);

    const rejectedEval = await prisma.evaluation.findUniqueOrThrow({
      where: { id: pendingEval.id },
    });
    expect([APPROVAL_STATUS.REJECTED, APPROVAL_STATUS.RETURNED_FOR_REVISION]).toContain(
      rejectedEval.approvalStatus,
    );
    expect(rejectedEval.rejectionReason).toContain('Evidence attachment #2');

    // Evaluator corrects and resubmits
    authenticateAs(evaluator);
    const resubmitRes = await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 875,
      notes: 'Revised after reviewing attachment #2.',
      status: 'EVALUATED',
      version: rejectedEval.version,
    });
    expect(resubmitRes.success).toBe(true);

    const resubmittedEval = await prisma.evaluation.findUniqueOrThrow({
      where: { id: pendingEval.id },
    });
    expect(resubmittedEval.approvalStatus).toBe(APPROVAL_STATUS.PENDING_APPROVAL);
    expect(resubmittedEval.score).toBe(875);
  });

  it('Concurrency Safety: Stale version triggers CONCURRENCY_CONFLICT', async () => {
    authenticateAs(evaluator);

    // Initial save creates evaluation at version 1
    const res1 = await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 700,
      status: 'IN_REVIEW',
    });
    expect(res1.success).toBe(true);
    expect(res1.data!.version).toBe(1);

    // Update with current version 1 advances to version 2
    const res2 = await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 720,
      status: 'IN_REVIEW',
      version: 1,
    });
    expect(res2.success).toBe(true);
    expect(res2.data!.version).toBe(2);

    // Attempt save with stale version 1
    const resStale = await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 750,
      status: 'IN_REVIEW',
      version: 1, // Stale!
    });
    expect(resStale.success).toBe(false);
    expect(resStale.error).toMatch(/modified by another evaluator|conflict/i);
  });

  it('Concurrency Safety: Duplicate admin approvals are safe and idempotent', async () => {
    authenticateAs(evaluator);
    await saveEvaluationAction({
      submissionId: l2Submission.id,
      score: 800,
      status: 'EVALUATED',
    });
    const pendingEval = await prisma.evaluation.findUniqueOrThrow({
      where: { submissionId: l2Submission.id },
    });

    authenticateAs(admin);
    // Concurrent approvals simulation
    const [res1, res2] = await Promise.all([
      approveEvaluationAction(pendingEval.id),
      approveEvaluationAction(pendingEval.id),
    ]);

    // Exactly one succeeds, the other fails safely due to conditional state check
    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Team score remains exactly 800 (not duplicated to 1600)
    const teamInDb = await prisma.team.findUnique({ where: { id: team.id } });
    expect(teamInDb!.score).toBe(800);
  });

  it('Level 3 Incident Report uses identical reusable evaluation architecture', async () => {
    authenticateAs(evaluator);

    // Evaluator opens Level 3 submission
    const details = await getEvaluatorSubmissionDetailsAction(l3Submission.id);
    expect(details.success).toBe(true);
    expect(details.data!.maxPossibleScore).toBe(1000);
    expect(details.data!.files[0]!.originalName).toBe('Phoenix_Incident_Report_L3.pdf');

    // Submit Level 3 evaluation
    const submitRes = await saveEvaluationAction({
      submissionId: l3Submission.id,
      score: 950,
      status: 'EVALUATED',
    });
    expect(submitRes.success).toBe(true);

    const evalInDb = await prisma.evaluation.findUniqueOrThrow({
      where: { submissionId: l3Submission.id },
    });
    expect(evalInDb.approvalStatus).toBe(APPROVAL_STATUS.PENDING_APPROVAL);

    // Admin approves Level 3
    authenticateAs(admin);
    const approveRes = await approveEvaluationAction(evalInDb.id);
    expect(approveRes.success).toBe(true);

    // Standings reflect Level 3 score
    const standings = await getLeaderboardStandings();
    const row = standings.rows.find((r) => r.id === team.id);
    expect(row?.levelScores[3]).toBe(950);
  });
});
