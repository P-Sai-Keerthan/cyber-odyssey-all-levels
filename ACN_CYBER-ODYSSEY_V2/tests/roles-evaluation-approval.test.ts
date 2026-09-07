/**
 * Role & Permission implementation — evaluation approval gate, Level 1 exclusion,
 * credential recovery, and Admin→Creator reporting.
 *
 * The central claim under test:
 *
 *   ONLY an APPROVED evaluation may contribute to the official leaderboard.
 *
 * That is asserted against the DATABASE, not against a UI flag — every test reads
 * `Team.score`, which is what /leaderboard renders.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type * as SessionModule from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';
import { APPROVAL_STATUS } from '@/lib/evaluation/approval';
import { resetEvaluationCriteria } from './helpers/evaluation-criteria';

let sessionUserId: string | null = null;

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<typeof SessionModule>('@/lib/auth/session');
  return {
    ...actual,
    getSessionUser: async () => {
      if (!sessionUserId) return null;
      return prismaRef.user.findUnique({
        where: { id: sessionUserId },
        include: { membership: { include: { team: true } } },
      });
    },
  };
});

const prismaRef = prisma;

const { saveEvaluationAction, startEvaluationAction } =
  await import('@/lib/actions/evaluator-actions');
const { approveEvaluationAction, rejectEvaluationAction, getEvaluationQueueAction } =
  await import('@/lib/actions/evaluation-approval-actions');
const { generateTemporaryAccountPasswordAction, generateTemporaryTeamPasswordAction } =
  await import('@/lib/actions/credential-recovery-actions');
const { createCreatorReportAction, listCreatorReportsAction } =
  await import('@/lib/actions/creator-report-actions');

const PASSWORD = 'RolesPhaseTest!2026';

interface Fixture {
  id: string;
  username: string;
  email: string;
}

let creator: Fixture;
let admin: Fixture;
let adminTwo: Fixture;
let evaluator: Fixture;
let evaluatorTwo: Fixture;
let participant: Fixture;
let team: { id: string; name: string; code: string };

async function makeUser(tag: string, role: string): Promise<Fixture> {
  return prisma.user.create({
    data: {
      email: `${tag}@roles.test`,
      username: tag,
      passwordHash: await hashPassword(PASSWORD),
      role,
      status: 'ACTIVE',
    },
    select: { id: true, username: true, email: true },
  });
}

/** Creates a submission at `level` with an evaluation already finalised by `evaluatorId`. */
async function submissionWithFinalisedEvaluation(level: number, evaluatorId: string) {
  const submission = await prisma.submission.create({
    data: { teamId: team.id, userId: participant.id, level, status: 'SUBMITTED' },
  });

  sessionUserId = evaluatorId;
  await startEvaluationAction(submission.id);
  const res = await saveEvaluationAction({
    submissionId: submission.id,
    score: 82,
    status: 'EVALUATED',
    feedback: 'Solid analysis.',
  });
  expect(res.success).toBe(true);

  const evaluation = await prisma.evaluation.findUniqueOrThrow({
    where: { submissionId: submission.id },
  });
  return { submission, evaluation };
}

async function teamScore(): Promise<number> {
  const t = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
  return t.score;
}

async function reset() {
  await prisma.creatorReport.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.evaluation.deleteMany({});
  await prisma.submissionFile.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.teamMember.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.user.deleteMany({});
}

describe('Roles phase — evaluation approval gate', () => {
  beforeEach(async () => {
    // The criteria table is global state that decides a level's maximum score,
    // and other suites replace it. Establish it here rather than inherit it.
    await resetEvaluationCriteria();
    sessionUserId = null;
    await reset();

    creator = await makeUser('roles_creator', 'CREATOR');
    admin = await makeUser('roles_admin', 'ADMIN');
    adminTwo = await makeUser('roles_admin2', 'ADMIN');
    evaluator = await makeUser('roles_evaluator', 'EVALUATOR');
    evaluatorTwo = await makeUser('roles_evaluator2', 'EVALUATOR');
    participant = await makeUser('roles_participant', 'PARTICIPANT');

    team = await prisma.team.create({
      data: {
        name: 'ROLES PHASE SQUAD',
        code: generateTeamCode(),
        passwordHash: await hashPassword(PASSWORD),
        creatorId: participant.id,
      },
      select: { id: true, name: true, code: true },
    });
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: participant.id, slot: 1, role: 'CREATOR' },
    });

    for (const level of [1, 2, 3]) {
      await prisma.levelState.upsert({
        where: { levelNumber: level },
        update: { status: 'LIVE' },
        create: {
          levelNumber: level,
          name: `Level ${level}`,
          codename: `LEVEL ${level}`,
          status: 'LIVE',
          durationMinutes: 120,
          durationSeconds: 7200,
          remainingSeconds: 7200,
        },
      });
    }
  });

  afterAll(async () => {
    sessionUserId = null;
    await reset();
  });

  // =========================================================================
  // THE LEADERBOARD GATE
  // =========================================================================
  describe('Only APPROVED evaluations reach the official leaderboard', () => {
    it('a finalised evaluation is PENDING and contributes ZERO to the leaderboard', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      expect(evaluation.approvalStatus).toBe(APPROVAL_STATUS.PENDING_APPROVAL);
      expect(evaluation.score).toBe(82);

      // The score exists on the evaluation but NOT on the leaderboard.
      expect(await teamScore()).toBe(0);
    });

    it('approving publishes exactly the evaluator’s score to the leaderboard', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = admin.id;
      const res = await approveEvaluationAction(evaluation.id);
      expect(res.success).toBe(true);

      expect(await teamScore()).toBe(82);

      const stored = await prisma.evaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
      expect(stored.approvalStatus).toBe(APPROVAL_STATUS.APPROVED);
      expect(stored.approvedById).toBe(admin.id);
      expect(stored.approvedAt).toBeInstanceOf(Date);
      // The Admin must not have altered the evaluator's score or identity.
      expect(stored.score).toBe(82);
      expect(stored.evaluatorId).toBe(evaluator.id);
    });

    it('rejecting keeps the score off the leaderboard and records the reason', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = admin.id;
      const res = await rejectEvaluationAction(
        evaluation.id,
        'Criteria 2 marks are not justified by the evidence provided.',
      );
      expect(res.success).toBe(true);

      expect(await teamScore()).toBe(0);

      const stored = await prisma.evaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
      expect(stored.approvalStatus).toBe(APPROVAL_STATUS.REJECTED);
      expect(stored.rejectedById).toBe(admin.id);
      expect(stored.rejectionReason).toContain('Criteria 2');
      // The record is preserved, never deleted.
      expect(stored.score).toBe(82);
    });

    it('rejection requires a substantive reason', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);
      sessionUserId = admin.id;

      for (const badReason of ['', '   ', 'no', 'bad']) {
        const res = await rejectEvaluationAction(evaluation.id, badReason);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/reason is required/i);
      }

      const stored = await prisma.evaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
      expect(stored.approvalStatus).toBe(APPROVAL_STATUS.PENDING_APPROVAL);
    });

    it('a rejected evaluation returns to PENDING when the evaluator resubmits', async () => {
      const { submission, evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = admin.id;
      await rejectEvaluationAction(evaluation.id, 'Please re-check the persistence findings.');

      // Evaluator corrects and resubmits.
      sessionUserId = evaluator.id;
      const resubmit = await saveEvaluationAction({
        submissionId: submission.id,
        score: 74,
        status: 'EVALUATED',
        feedback: 'Revised after review.',
      });
      expect(resubmit.success).toBe(true);

      const stored = await prisma.evaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
      expect(stored.approvalStatus).toBe(APPROVAL_STATUS.PENDING_APPROVAL);
      expect(stored.score).toBe(74);
      // The stale rejection decision is cleared, not left contradicting the state.
      expect(stored.rejectedById).toBeNull();
      expect(stored.rejectionReason).toBeNull();
      // Still not on the leaderboard until approved again.
      expect(await teamScore()).toBe(0);
    });

    it('the leaderboard total sums ONLY approved evaluations across levels', async () => {
      const l2 = await submissionWithFinalisedEvaluation(2, evaluator.id);
      const l3 = await submissionWithFinalisedEvaluation(3, evaluator.id);

      sessionUserId = admin.id;
      await approveEvaluationAction(l2.evaluation.id);
      // l3 deliberately left pending.

      expect(await teamScore()).toBe(82);

      await approveEvaluationAction(l3.evaluation.id);
      expect(await teamScore()).toBe(164);
    });

    it('keeps the evaluator associated with the evaluation through every decision', async () => {
      // Workflow: Team -> Evaluation -> Evaluator. The evaluator who performed the
      // evaluation must remain attached to the record after submission and after
      // the Admin approves or rejects it, so the Admin console can always answer
      // "who scored this team".
      const { submission, evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      const afterSubmit = await prisma.evaluation.findUniqueOrThrow({
        where: { id: evaluation.id },
      });
      expect(afterSubmit.evaluatorId).toBe(evaluator.id);

      // ...after rejection.
      sessionUserId = admin.id;
      await rejectEvaluationAction(evaluation.id, 'Please justify the Criteria 3 marks.');
      const afterReject = await prisma.evaluation.findUniqueOrThrow({
        where: { id: evaluation.id },
      });
      expect(afterReject.evaluatorId).toBe(evaluator.id);

      // ...after the evaluator corrects and resubmits.
      sessionUserId = evaluator.id;
      await saveEvaluationAction({
        submissionId: submission.id,
        score: 79,
        status: 'EVALUATED',
      });
      const afterResubmit = await prisma.evaluation.findUniqueOrThrow({
        where: { id: evaluation.id },
      });
      expect(afterResubmit.evaluatorId).toBe(evaluator.id);

      // ...and after approval.
      sessionUserId = admin.id;
      await approveEvaluationAction(evaluation.id);
      const afterApprove = await prisma.evaluation.findUniqueOrThrow({
        where: { id: evaluation.id },
      });
      expect(afterApprove.evaluatorId).toBe(evaluator.id);
      expect(afterApprove.score).toBe(79);
    });

    it('surfaces team, level, evaluator, score, status and timestamp to the Admin', async () => {
      // The exact set the Admin console must be able to display for each evaluation.
      await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = admin.id;
      const queue = await getEvaluationQueueAction();
      expect(queue.success).toBe(true);

      const row = queue.data!.evaluations[0]!;
      expect(row.teamName).toBe(team.name);
      expect(row.level).toBe(2);
      expect(row.evaluatorUsername).toBe(evaluator.username);
      expect(row.score).toBe(82);
      expect(row.maxScore).toBe(1000);
      expect(row.evaluationStatus).toBe('EVALUATED');
      expect(row.approvalStatus).toBe(APPROVAL_STATUS.PENDING_APPROVAL);
      expect(row.approvalStatusLabel).toBe('Pending Admin Approval');
      expect(row.submittedAt).toBeInstanceOf(Date);
    });

    it('an approved evaluation cannot be silently re-decided', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = admin.id;
      await approveEvaluationAction(evaluation.id);

      const reReject = await rejectEvaluationAction(evaluation.id, 'Changed my mind about this.');
      expect(reReject.success).toBe(false);
      expect(reReject.error).toMatch(/already been approved/i);

      expect(await teamScore()).toBe(82);
    });

    it('two admins deciding simultaneously produce exactly one decision', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      // Both act on the same pending evaluation at once.
      const results = await Promise.allSettled([
        (async () => {
          sessionUserId = admin.id;
          return approveEvaluationAction(evaluation.id);
        })(),
        (async () => {
          sessionUserId = adminTwo.id;
          return rejectEvaluationAction(evaluation.id, 'Rejecting for insufficient evidence.');
        })(),
      ]);

      const succeeded = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as { success: boolean }).success,
      );
      expect(succeeded.length).toBe(1);

      const stored = await prisma.evaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
      // Whichever won, the state is one of the two terminal decisions, never both.
      expect([APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED]).toContain(stored.approvalStatus);
      const expectedScore = stored.approvalStatus === APPROVAL_STATUS.APPROVED ? 82 : 0;
      expect(await teamScore()).toBe(expectedScore);
    });
  });

  // =========================================================================
  // SEPARATION OF DUTIES
  // =========================================================================
  describe('Who may approve', () => {
    it('an evaluator cannot approve their own evaluation', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = evaluator.id;
      const res = await approveEvaluationAction(evaluation.id);

      expect(res.success).toBe(false);
      expect(await teamScore()).toBe(0);
    });

    it('a different evaluator still cannot approve — approval is Admin authority', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = evaluatorTwo.id;
      const res = await approveEvaluationAction(evaluation.id);

      expect(res.success).toBe(false);
      expect(await teamScore()).toBe(0);
    });

    it('the Creator cannot approve evaluations', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = creator.id;
      const res = await approveEvaluationAction(evaluation.id);

      expect(res.success).toBe(false);
      expect(await teamScore()).toBe(0);
    });

    it('a participant cannot approve evaluations or read the queue', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = participant.id;
      expect((await approveEvaluationAction(evaluation.id)).success).toBe(false);
      expect((await rejectEvaluationAction(evaluation.id, 'trying to reject this')).success).toBe(
        false,
      );
      expect((await getEvaluationQueueAction()).success).toBe(false);
      expect(await teamScore()).toBe(0);
    });

    it('an unauthenticated caller cannot approve', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);

      sessionUserId = null;
      expect((await approveEvaluationAction(evaluation.id)).success).toBe(false);
      expect(await teamScore()).toBe(0);
    });

    it('a blocked Admin cannot approve', async () => {
      const { evaluation } = await submissionWithFinalisedEvaluation(2, evaluator.id);
      await prisma.user.update({ where: { id: admin.id }, data: { status: 'BLOCKED' } });

      sessionUserId = admin.id;
      const res = await approveEvaluationAction(evaluation.id);

      expect(res.success).toBe(false);
      expect(await teamScore()).toBe(0);
    });

    it('the Admin queue flags an evaluation the viewing admin authored', async () => {
      // An account that is Admin but also authored an evaluation is the case the
      // self-approval rule exists for.
      const submission = await prisma.submission.create({
        data: { teamId: team.id, userId: participant.id, level: 2, status: 'SUBMITTED' },
      });
      await prisma.evaluation.create({
        data: {
          submissionId: submission.id,
          evaluatorId: admin.id,
          teamId: team.id,
          level: 2,
          score: 50,
          status: 'EVALUATED',
          approvalStatus: APPROVAL_STATUS.PENDING_APPROVAL,
        },
      });

      sessionUserId = admin.id;
      const queue = await getEvaluationQueueAction();
      expect(queue.success).toBe(true);
      const own = queue.data!.evaluations.find((e) => e.evaluatorId === admin.id);
      expect(own?.canDecide).toBe(false);
    });
  });

  // =========================================================================
  // LEVEL 1 HAS NO EVALUATION
  // =========================================================================
  describe('Level 1 exclusion', () => {
    it('refuses to start an evaluation on a Level 1 submission', async () => {
      const submission = await prisma.submission.create({
        data: { teamId: team.id, userId: participant.id, level: 1, status: 'SUBMITTED' },
      });

      sessionUserId = evaluator.id;
      const res = await startEvaluationAction(submission.id);

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not evaluated/i);
      expect(await prisma.evaluation.count({ where: { submissionId: submission.id } })).toBe(0);
    });

    it('refuses to save an evaluation on a Level 1 submission', async () => {
      const submission = await prisma.submission.create({
        data: { teamId: team.id, userId: participant.id, level: 1, status: 'SUBMITTED' },
      });

      sessionUserId = evaluator.id;
      const res = await saveEvaluationAction({
        submissionId: submission.id,
        score: 90,
        status: 'EVALUATED',
      });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not evaluated/i);
      expect(await prisma.evaluation.count({ where: { submissionId: submission.id } })).toBe(0);
      expect(await teamScore()).toBe(0);
    });

    it('accepts evaluation for Level 2 and Level 3', async () => {
      for (const level of [2, 3]) {
        const submission = await prisma.submission.create({
          data: { teamId: team.id, userId: participant.id, level, status: 'SUBMITTED' },
        });
        sessionUserId = evaluator.id;
        const res = await saveEvaluationAction({
          submissionId: submission.id,
          score: 60,
          status: 'EVALUATED',
        });
        expect(res.success).toBe(true);
      }
    });
  });

  // =========================================================================
  // CREDENTIAL RECOVERY
  // =========================================================================
  describe('Temporary credential recovery', () => {
    it('issues a working temporary password and invalidates the old one', async () => {
      sessionUserId = creator.id;
      const res = await generateTemporaryAccountPasswordAction(participant.id);

      expect(res.success).toBe(true);
      const temp = res.data!.temporaryPassword;
      expect(temp.length).toBeGreaterThanOrEqual(16);

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: participant.id } });
      // Old credential no longer works; new one does.
      expect(await verifyPassword(PASSWORD, updated.passwordHash)).toBe(false);
      expect(await verifyPassword(temp, updated.passwordHash)).toBe(true);
    });

    it('revokes every active session for the account', async () => {
      await prisma.session.create({
        data: {
          userId: participant.id,
          token: 'roles-test-session-token',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      expect(await prisma.session.count({ where: { userId: participant.id } })).toBe(1);

      sessionUserId = creator.id;
      await generateTemporaryAccountPasswordAction(participant.id);

      expect(await prisma.session.count({ where: { userId: participant.id } })).toBe(0);
    });

    it('never writes the temporary password into the audit log', async () => {
      sessionUserId = creator.id;
      const res = await generateTemporaryAccountPasswordAction(participant.id);
      const temp = res.data!.temporaryPassword;

      const logs = await prisma.auditLog.findMany({ select: { details: true, action: true } });
      expect(logs.some((l) => l.action === 'ACCOUNT_CREDENTIAL_RESET')).toBe(true);
      for (const log of logs) {
        expect(log.details ?? '').not.toContain(temp);
      }
    });

    it('issues a working temporary squad password and invalidates the old one', async () => {
      sessionUserId = creator.id;
      const res = await generateTemporaryTeamPasswordAction(team.id);

      expect(res.success).toBe(true);
      const temp = res.data!.temporaryPassword;

      const updated = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
      expect(await verifyPassword(PASSWORD, updated.passwordHash)).toBe(false);
      expect(await verifyPassword(temp, updated.passwordHash)).toBe(true);
    });

    it('never records the squad join code in the reset audit entry', async () => {
      sessionUserId = creator.id;
      await generateTemporaryTeamPasswordAction(team.id);

      const logs = await prisma.auditLog.findMany({ select: { details: true } });
      for (const log of logs) {
        expect(log.details ?? '').not.toContain(team.code);
      }
    });

    it('refuses to reset a Creator account from inside the portal', async () => {
      const otherCreator = await makeUser('roles_creator2', 'CREATOR');
      sessionUserId = creator.id;

      const res = await generateTemporaryAccountPasswordAction(otherCreator.id);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/out-of-band/i);
    });

    it('denies credential recovery to Admin, Evaluator and Participant', async () => {
      for (const actor of [admin, evaluator, participant]) {
        sessionUserId = actor.id;
        expect((await generateTemporaryAccountPasswordAction(participant.id)).success).toBe(false);
        expect((await generateTemporaryTeamPasswordAction(team.id)).success).toBe(false);
      }

      // The original credential is untouched by any of those attempts.
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: participant.id } });
      expect(await verifyPassword(PASSWORD, stored.passwordHash)).toBe(true);
    });
  });

  // =========================================================================
  // ADMIN → CREATOR REPORTS
  // =========================================================================
  describe('Admin reports issues to the Creator', () => {
    it('an Admin can raise a report about a squad', async () => {
      sessionUserId = admin.id;
      const res = await createCreatorReportAction({
        teamId: team.id,
        issueType: 'TEAM_CONDUCT',
        description: 'Squad appears to be sharing answers with another squad.',
      });

      expect(res.success).toBe(true);
      expect(await prisma.creatorReport.count()).toBe(1);
    });

    it('the Creator sees the report in their inbox', async () => {
      sessionUserId = admin.id;
      await createCreatorReportAction({
        teamId: team.id,
        issueType: 'TECHNICAL',
        description: 'Squad reports the evidence package will not download for them.',
      });

      sessionUserId = creator.id;
      const list = await listCreatorReportsAction();
      expect(list.success).toBe(true);
      expect(list.data!.openCount).toBe(1);
      expect(list.data!.reports[0]!.teamName).toBe(team.name);
      expect(list.data!.reports[0]!.authorUsername).toBe(admin.username);
    });

    it('requires a subject and a substantive description', async () => {
      sessionUserId = admin.id;

      expect(
        (
          await createCreatorReportAction({
            issueType: 'OTHER',
            description: 'Something is wrong here somewhere.',
          })
        ).success,
      ).toBe(false);

      expect(
        (
          await createCreatorReportAction({
            teamId: team.id,
            issueType: 'OTHER',
            description: 'bad',
          })
        ).success,
      ).toBe(false);

      expect(await prisma.creatorReport.count()).toBe(0);
    });

    it('participants and evaluators cannot raise reports', async () => {
      for (const actor of [participant, evaluator]) {
        sessionUserId = actor.id;
        const res = await createCreatorReportAction({
          teamId: team.id,
          issueType: 'OTHER',
          description: 'Attempting to file a report without authority.',
        });
        expect(res.success).toBe(false);
      }
      expect(await prisma.creatorReport.count()).toBe(0);
    });
  });
});
