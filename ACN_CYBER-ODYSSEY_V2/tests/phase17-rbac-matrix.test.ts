/**
 * Phase 17 — Role-Based Access Control Matrix
 *
 * Every privileged server action is invoked DIRECTLY as each role, bypassing the
 * UI entirely. This is the test that matters: hiding a button in the sidebar is
 * not an authorization control, and a participant who reads the client bundle
 * can call any server action by its action id.
 *
 * The matrix below is the specification. A cell marked DENY must be refused by
 * the action itself, on the server, regardless of what the client sends.
 *
 *   action group                 PARTICIPANT  EVALUATOR  ADMIN   CREATOR  ANON
 *   creator governance                DENY       DENY     DENY   ALLOW    DENY
 *   creator level-2 resources         DENY       DENY     DENY   ALLOW    DENY
 *   admin operations                  DENY       DENY    ALLOW    DENY    DENY
 *   evaluator scoring                 DENY      ALLOW     DENY    DENY    DENY
 *
 * Note that CREATOR is intentionally DENIED on admin-only and evaluator-only
 * actions: the roles are separate authorities, not a hierarchy in which Creator
 * silently inherits everything. Creator supremacy is expressed by exclusive
 * access to governance, not by being able to score submissions.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';
import * as sessionModule from '@/lib/auth/session';

import {
  getCreatorOverviewStatsAction,
  getPendingStaffAction,
  approveStaffAction,
  rejectStaffAction,
  getAccountsAction,
  blockAccountAction,
  unblockAccountAction,
  deleteAccountAction,
  getTeamsAction,
  blockTeamAction,
  deleteTeamAction,
  getActivityLogsAction,
  getActiveSessionsAction,
  setPortalStatusAction,
} from '@/lib/actions/creator-actions';
import {
  getCreatorLevelResourcesAction,
  uploadOrReplaceLevelResourceAction,
  removeLevelResourceAction,
  toggleLevelResourcePublishAction,
} from '@/lib/actions/creator-resource-actions';
import {
  getAdminOverviewStatsAction,
  getAdminParticipantsAction,
  getAdminTeamsAction,
  getAdminLevelsAction,
  startLevelAction,
  stopLevelAction,
  configureLevelDurationAction,
  createAnnouncementAction,
  toggleEventPortalStatusAction,
} from '@/lib/actions/admin-actions';
import {
  getEvaluatorOverviewStatsAction,
  getEvaluatorTeamsAction,
  getEvaluatorSubmissionsAction,
  startEvaluationAction,
  saveEvaluationAction,
} from '@/lib/actions/evaluator-actions';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

type Role = 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN' | 'CREATOR' | 'ANON';

interface Fixture {
  id: string;
  username: string;
  role: string;
  status: string;
}

const actors: Partial<Record<Role, Fixture>> = {};
let targetTeamId = '';
let targetSubmissionId = '';
let pendingStaffId = '';

/** Impersonates a role for the duration of one action call. */
function actAs(role: Role) {
  if (role === 'ANON') {
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(null);
    return;
  }
  const actor = actors[role];
  vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
    ...actor,
    membership: null,
  } as unknown as Awaited<ReturnType<typeof sessionModule.getSessionUser>>);
}

/**
 * An action is considered DENIED when it either rejects, or resolves with
 * `success: false` carrying an authorization message. Both shapes appear across
 * the codebase; either is an acceptable refusal, silence is not.
 */
async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = (await fn()) as { success?: boolean; error?: string } | undefined;
    if (result && result.success === false) {
      const msg = (result.error ?? '').toLowerCase();
      return (
        msg.includes('unauthor') ||
        msg.includes('privileg') ||
        msg.includes('permission') ||
        msg.includes('creator') ||
        msg.includes('admin') ||
        msg.includes('evaluator') ||
        msg.includes('sign in') ||
        msg.includes('authentication')
      );
    }
    return false;
  } catch {
    // A thrown guard is a refusal.
    return true;
  }
}

beforeAll(async () => {
  const pwd = await hashPassword('RbacMatrix2026!');

  for (const role of ['PARTICIPANT', 'EVALUATOR', 'ADMIN', 'CREATOR'] as const) {
    actors[role] = await prisma.user.create({
      data: {
        email: `rbac_${role.toLowerCase()}@rbac.invalid`,
        username: `rbac_${role.toLowerCase()}`,
        passwordHash: pwd,
        role,
        status: 'ACTIVE',
      },
      select: { id: true, username: true, role: true, status: true },
    });
  }

  const pending = await prisma.user.create({
    data: {
      email: 'rbac_pending@rbac.invalid',
      username: 'rbac_pending',
      passwordHash: pwd,
      role: 'EVALUATOR',
      status: 'PENDING_APPROVAL',
    },
  });
  pendingStaffId = pending.id;

  const team = await prisma.team.create({
    data: {
      name: 'RBAC MATRIX SQUAD',
      code: generateTeamCode(),
      passwordHash: pwd,
      creatorId: actors.PARTICIPANT!.id,
    },
  });
  targetTeamId = team.id;

  await prisma.teamMember.create({
    data: { teamId: team.id, userId: actors.PARTICIPANT!.id, slot: 1, role: 'CREATOR' },
  });

  const submission = await prisma.submission.create({
    data: {
      teamId: team.id,
      userId: actors.PARTICIPANT!.id,
      level: 2,
      status: 'SUBMITTED',
    },
  });
  targetSubmissionId = submission.id;

  await prisma.levelState.upsert({
    where: { levelNumber: 2 },
    update: {},
    create: {
      levelNumber: 2,
      name: "Level 2 — The Boar's Mark",
      codename: "THE BOAR'S MARK",
      status: 'READY',
      durationMinutes: 120,
      durationSeconds: 7200,
      remainingSeconds: 7200,
    },
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.evaluation.deleteMany({ where: { teamId: targetTeamId } });
  await prisma.submission.deleteMany({ where: { teamId: targetTeamId } });
  await prisma.teamMember.deleteMany({ where: { teamId: targetTeamId } });
  await prisma.team.deleteMany({ where: { id: targetTeamId } });
  await prisma.auditLog.deleteMany({
    where: { actor: { email: { endsWith: '@rbac.invalid' } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@rbac.invalid' } } });
});

describe('Phase 17 — RBAC matrix (server-side enforcement)', () => {
  // =========================================================================
  // CREATOR GOVERNANCE — Creator only
  // =========================================================================
  describe('Creator governance actions', () => {
    const creatorOnly: Array<[string, () => Promise<unknown>]> = [
      ['getCreatorOverviewStatsAction', () => getCreatorOverviewStatsAction()],
      ['getPendingStaffAction', () => getPendingStaffAction()],
      ['approveStaffAction', () => approveStaffAction(pendingStaffId)],
      ['rejectStaffAction', () => rejectStaffAction(pendingStaffId)],
      ['getAccountsAction', () => getAccountsAction({})],
      ['blockAccountAction', () => blockAccountAction(pendingStaffId)],
      ['unblockAccountAction', () => unblockAccountAction(pendingStaffId)],
      ['deleteAccountAction', () => deleteAccountAction(pendingStaffId)],
      ['getTeamsAction', () => getTeamsAction({})],
      ['blockTeamAction', () => blockTeamAction(targetTeamId)],
      ['deleteTeamAction', () => deleteTeamAction(targetTeamId)],
      ['getActivityLogsAction', () => getActivityLogsAction({})],
      ['getActiveSessionsAction', () => getActiveSessionsAction()],
      ['setPortalStatusAction', () => setPortalStatusAction(true)],
    ];

    for (const role of ['PARTICIPANT', 'EVALUATOR', 'ADMIN', 'ANON'] as const) {
      for (const [name, fn] of creatorOnly) {
        it(`denies ${name} to ${role}`, async () => {
          actAs(role);
          expect(await isDenied(fn)).toBe(true);
        });
      }
    }
  });

  // =========================================================================
  // CREATOR-OWNED LEVEL 2 RESOURCES — Creator only
  // =========================================================================
  describe('Creator-owned Level 2 resource management', () => {
    function resourceUpload() {
      const fd = new FormData();
      fd.set('levelNumber', '2');
      fd.set('resourceKey', 'SAMPLE_REPORT');
      fd.set('file', new File(['%PDF-1.4 x'], 'r.pdf', { type: 'application/pdf' }));
      return uploadOrReplaceLevelResourceAction(fd);
    }

    const creatorOnly: Array<[string, () => Promise<unknown>]> = [
      ['getCreatorLevelResourcesAction', () => getCreatorLevelResourcesAction(2)],
      ['uploadOrReplaceLevelResourceAction', resourceUpload],
      ['removeLevelResourceAction', () => removeLevelResourceAction(2, 'SAMPLE_REPORT')],
      [
        'toggleLevelResourcePublishAction',
        () => toggleLevelResourcePublishAction(2, 'SAMPLE_REPORT', false),
      ],
    ];

    for (const role of ['PARTICIPANT', 'EVALUATOR', 'ADMIN', 'ANON'] as const) {
      for (const [name, fn] of creatorOnly) {
        it(`denies ${name} to ${role}`, async () => {
          actAs(role);
          expect(await isDenied(fn)).toBe(true);
        });
      }
    }

    it('allows the Creator to read Level 2 resources', async () => {
      actAs('CREATOR');
      const result = await getCreatorLevelResourcesAction(2);
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // ADMIN OPERATIONS — Admin only (Creator does NOT inherit)
  // =========================================================================
  describe('Admin operational actions', () => {
    const adminOnly: Array<[string, () => Promise<unknown>]> = [
      ['getAdminOverviewStatsAction', () => getAdminOverviewStatsAction()],
      ['getAdminParticipantsAction', () => getAdminParticipantsAction({})],
      ['getAdminTeamsAction', () => getAdminTeamsAction({})],
      ['getAdminLevelsAction', () => getAdminLevelsAction()],
      ['startLevelAction', () => startLevelAction(2)],
      ['stopLevelAction', () => stopLevelAction(2)],
      ['configureLevelDurationAction', () => configureLevelDurationAction(2, 90)],
      [
        'createAnnouncementAction',
        () => createAnnouncementAction({ title: 'rbac', content: 'rbac' }),
      ],
      ['toggleEventPortalStatusAction', () => toggleEventPortalStatusAction(true)],
    ];

    for (const role of ['PARTICIPANT', 'EVALUATOR', 'CREATOR', 'ANON'] as const) {
      for (const [name, fn] of adminOnly) {
        it(`denies ${name} to ${role}`, async () => {
          actAs(role);
          expect(await isDenied(fn)).toBe(true);
        });
      }
    }

    it('allows an Admin to read the levels console', async () => {
      actAs('ADMIN');
      const result = await getAdminLevelsAction();
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // EVALUATOR SCORING — Evaluator only
  // =========================================================================
  describe('Evaluator scoring actions', () => {
    const evaluatorOnly: Array<[string, () => Promise<unknown>]> = [
      ['getEvaluatorOverviewStatsAction', () => getEvaluatorOverviewStatsAction()],
      ['getEvaluatorTeamsAction', () => getEvaluatorTeamsAction({})],
      ['getEvaluatorSubmissionsAction', () => getEvaluatorSubmissionsAction({})],
      ['startEvaluationAction', () => startEvaluationAction(targetSubmissionId)],
      [
        'saveEvaluationAction',
        () =>
          saveEvaluationAction({
            submissionId: targetSubmissionId,
            score: 80,
            status: 'EVALUATED',
          }),
      ],
    ];

    for (const role of ['PARTICIPANT', 'ADMIN', 'CREATOR', 'ANON'] as const) {
      for (const [name, fn] of evaluatorOnly) {
        it(`denies ${name} to ${role}`, async () => {
          actAs(role);
          expect(await isDenied(fn)).toBe(true);
        });
      }
    }

    it('allows an Evaluator to read the submissions queue', async () => {
      actAs('EVALUATOR');
      const result = await getEvaluatorSubmissionsAction({});
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // NON-ACTIVE ACCOUNTS — status is enforced as well as role
  // =========================================================================
  describe('Account status is enforced independently of role', () => {
    for (const status of ['PENDING_APPROVAL', 'BLOCKED', 'SUSPENDED', 'REJECTED'] as const) {
      it(`denies an EVALUATOR with status ${status}`, async () => {
        vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
          id: 'status-test',
          username: 'status_test',
          role: 'EVALUATOR',
          status,
          membership: null,
        } as unknown as Awaited<ReturnType<typeof sessionModule.getSessionUser>>);

        expect(await isDenied(() => getEvaluatorSubmissionsAction({}))).toBe(true);
      });

      it(`denies a CREATOR with status ${status}`, async () => {
        vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
          id: 'status-test',
          username: 'status_test',
          role: 'CREATOR',
          status,
          membership: null,
        } as unknown as Awaited<ReturnType<typeof sessionModule.getSessionUser>>);

        expect(await isDenied(() => getAccountsAction({}))).toBe(true);
      });
    }
  });

  // =========================================================================
  // CLIENT-SUPPLIED ROLE IS NEVER TRUSTED
  // =========================================================================
  describe('Client-supplied role claims are ignored', () => {
    it('ignores a participant session that claims to be CREATOR in a form field', async () => {
      actAs('PARTICIPANT');
      const fd = new FormData();
      fd.set('role', 'CREATOR');
      fd.set('accountType', 'CREATOR');
      fd.set('levelNumber', '2');
      fd.set('resourceKey', 'SAMPLE_REPORT');
      fd.set('file', new File(['%PDF-1.4 x'], 'r.pdf', { type: 'application/pdf' }));

      const result = await uploadOrReplaceLevelResourceAction(fd);
      expect(result.success).toBe(false);
    });
  });
});
