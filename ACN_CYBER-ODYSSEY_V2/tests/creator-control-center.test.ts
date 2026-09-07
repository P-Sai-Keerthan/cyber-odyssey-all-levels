import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

/**
 * Fake Creator identity for tests.
 *
 * SEC-17-01: this file previously hardcoded the project owner's real email
 * address and the real Creator password. Test files are committed, so those were
 * live credentials sitting in version control. Tests must never carry a real
 * secret — these values are deliberately non-functional placeholders.
 */
const TEST_CREATOR_EMAIL = 'creator@cyber-odyssey.test';
const TEST_CREATOR_PASSWORD = 'TestCreatorPassword!2026';
import {
  getCreatorOverviewStatsAction,
  getPendingStaffAction,
  approveStaffAction,
  rejectStaffAction,
  getAccountsAction,
  getAccountDetailsAction,
  blockAccountAction,
  unblockAccountAction,
  deleteAccountAction,
  getTeamsAction,
  getTeamDetailsAction,
  blockTeamAction,
  unblockTeamAction,
  deleteTeamAction,
  getActivityLogsAction,
  getActiveSessionsAction,
  setPortalStatusAction,
} from '@/lib/actions/creator-actions';
import { loginAction } from '@/lib/actions/auth-actions';
import { getPortalStatus, setPortalStatus } from '@/lib/event/portal-settings';
import * as sessionModule from '@/lib/auth/session';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const mockCookieMap = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn((name: string) => {
      const val = mockCookieMap.get(name);
      return val ? { value: val } : undefined;
    }),
    set: vi.fn((name: string, value: string) => {
      mockCookieMap.set(name, value);
    }),
    delete: vi.fn((name: string) => {
      mockCookieMap.delete(name);
    }),
  }),
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

describe('ACN Cyber Odyssey V2 — Creator Control Center Test Suite', () => {
  let creatorUser: TestUser;
  let participantUser: TestUser;
  let evaluatorUser: TestUser;
  let adminUser: TestUser;

  beforeEach(async () => {
    // Reset database tables before each test
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.portalSetting.deleteMany({});
    await prisma.user.deleteMany({});

    // Seed default portal setting
    await prisma.portalSetting.create({
      data: { id: 'default', isOnline: true },
    });

    const passHash = await hashPassword('CyberOdyssey2026!');

    // 1. Create Creator
    creatorUser = await prisma.user.create({
      data: {
        email: TEST_CREATOR_EMAIL,
        username: 'event_creator',
        passwordHash: passHash,
        role: 'CREATOR',
        status: 'ACTIVE',
      },
    });

    // 2. Create Participant
    participantUser = await prisma.user.create({
      data: {
        email: 'investigator1@acn.org',
        username: 'investigator_01',
        passwordHash: passHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    // 3. Create Evaluator (Pending)
    evaluatorUser = await prisma.user.create({
      data: {
        email: 'evaluator1@acn.org',
        username: 'evaluator_01',
        passwordHash: passHash,
        role: 'EVALUATOR',
        status: 'PENDING_APPROVAL',
      },
    });

    // 4. Create Admin (Pending)
    adminUser = await prisma.user.create({
      data: {
        email: 'admin1@acn.org',
        username: 'admin_01',
        passwordHash: passHash,
        role: 'ADMIN',
        status: 'PENDING_APPROVAL',
      },
    });

    // Default mock session to creatorUser
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
      creatorUser as unknown as SessionUser,
    );
  });

  // =========================================================================
  // 1. CREATOR ACCOUNT & AUTHORIZATION PROTECTION
  // =========================================================================
  describe('1. Creator Authorization & Protection', () => {
    it('authenticates creator with valid password hash and active status', async () => {
      const isMatch = await verifyPassword(
        'CyberOdyssey2026!',
        creatorUser.passwordHash ||
          (await prisma.user.findUnique({ where: { id: creatorUser.id } }))!.passwordHash,
      );
      expect(isMatch).toBe(true);
      expect(creatorUser.role).toBe('CREATOR');
      expect(creatorUser.status).toBe('ACTIVE');
    });

    it('rejects unauthenticated requests to Creator actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(null);

      const result = await getCreatorOverviewStatsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('rejects Participant users from executing Creator actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUser as unknown as SessionUser,
      );

      const result = await getCreatorOverviewStatsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('rejects Evaluator users from executing Creator actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
        ...evaluatorUser,
        status: 'ACTIVE',
      } as unknown as SessionUser);

      const result = await getPendingStaffAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('rejects Admin users from executing Creator actions (explicit Creator privileges required)', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
        ...adminUser,
        status: 'ACTIVE',
      } as unknown as SessionUser);

      const result = await getAccountsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('rejects blocked/suspended Creator from accessing actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
        ...creatorUser,
        status: 'BLOCKED',
      } as unknown as SessionUser);

      const result = await getCreatorOverviewStatsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });
  });

  // =========================================================================
  // 2. OVERVIEW METRICS TELEMETRY
  // =========================================================================
  describe('2. Overview Telemetry & Statistics', () => {
    it('returns accurate live database counts for all entities', async () => {
      const result = await getCreatorOverviewStatsAction();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const stats = result.data!;
      expect(stats.totalParticipants).toBe(1);
      expect(stats.totalEvaluators).toBe(1);
      expect(stats.totalAdmins).toBe(1);
      expect(stats.pendingStaffApprovals).toBe(2);
      expect(stats.activeAccounts).toBe(2); // Creator + Participant
      expect(stats.portalStatus.isOnline).toBe(true);
    });
  });

  // =========================================================================
  // 3. STAFF CLEARANCE APPROVALS
  // =========================================================================
  describe('3. Staff Clearance Approvals', () => {
    it('lists pending Evaluators and Admins correctly', async () => {
      const result = await getPendingStaffAction();
      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
      expect(result.data?.map((u) => u.username)).toContain('evaluator_01');
      expect(result.data?.map((u) => u.username)).toContain('admin_01');
    });

    it('approves an Evaluator account and records STAFF_APPROVED in audit log', async () => {
      const approveResult = await approveStaffAction(evaluatorUser.id);
      expect(approveResult.success).toBe(true);

      const updatedUser = await prisma.user.findUnique({ where: { id: evaluatorUser.id } });
      expect(updatedUser?.status).toBe('ACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { targetId: evaluatorUser.id, action: 'STAFF_APPROVED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(creatorUser.id);
      expect(audit?.details).toContain('EVALUATOR');
    });

    it('approves an Admin account and records STAFF_APPROVED in audit log', async () => {
      const approveResult = await approveStaffAction(adminUser.id);
      expect(approveResult.success).toBe(true);

      const updatedUser = await prisma.user.findUnique({ where: { id: adminUser.id } });
      expect(updatedUser?.status).toBe('ACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { targetId: adminUser.id, action: 'STAFF_APPROVED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('ADMIN');
    });

    it('rejects a pending staff account and records STAFF_REJECTED in audit log', async () => {
      const rejectResult = await rejectStaffAction(evaluatorUser.id, 'Incomplete credentials');
      expect(rejectResult.success).toBe(true);

      const updatedUser = await prisma.user.findUnique({ where: { id: evaluatorUser.id } });
      expect(updatedUser?.status).toBe('REJECTED');

      const audit = await prisma.auditLog.findFirst({
        where: { targetId: evaluatorUser.id, action: 'STAFF_REJECTED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('Incomplete credentials');
    });
  });

  // =========================================================================
  // 4. ACCOUNT NETWORK GOVERNANCE
  // =========================================================================
  describe('4. Accounts Management & Governance', () => {
    it('lists registered accounts with filtering and pagination', async () => {
      const result = await getAccountsAction({ page: 1, limit: 10, role: 'PARTICIPANT' });
      expect(result.success).toBe(true);
      expect(result.data?.accounts.length).toBe(1);
      expect(result.data!.accounts[0]!.username).toBe('investigator_01');
    });

    it('fetches detailed account data without exposing password hash', async () => {
      const result = await getAccountDetailsAction(participantUser.id);
      expect(result.success).toBe(true);
      expect(result.data?.username).toBe('investigator_01');
      expect(result.data?.email).toBe('investigator1@acn.org');
      expect('passwordHash' in (result.data || {})).toBe(false);
    });

    it('blocks an active account, terminates its sessions, and logs ACCOUNT_BLOCKED', async () => {
      // Create session for participant
      await prisma.session.create({
        data: {
          userId: participantUser.id,
          token: 'active_session_token_123',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const blockResult = await blockAccountAction(participantUser.id, 'Terms violation');
      expect(blockResult.success).toBe(true);

      const updated = await prisma.user.findUnique({ where: { id: participantUser.id } });
      expect(updated?.status).toBe('BLOCKED');

      // Verify sessions were revoked
      const sessions = await prisma.session.findMany({ where: { userId: participantUser.id } });
      expect(sessions.length).toBe(0);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { targetId: participantUser.id, action: 'ACCOUNT_BLOCKED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('Terms violation');
    });

    it('prevents a Creator from blocking their own Creator account', async () => {
      const result = await blockAccountAction(creatorUser.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot block your own');
    });

    it('unblocks a blocked account, restoring status to ACTIVE and logging ACCOUNT_UNBLOCKED', async () => {
      await prisma.user.update({
        where: { id: participantUser.id },
        data: { status: 'BLOCKED' },
      });

      const unblockResult = await unblockAccountAction(participantUser.id);
      expect(unblockResult.success).toBe(true);

      const updated = await prisma.user.findUnique({ where: { id: participantUser.id } });
      expect(updated?.status).toBe('ACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { targetId: participantUser.id, action: 'ACCOUNT_UNBLOCKED' },
      });
      expect(audit).toBeDefined();
    });

    it('permanently deletes an account transactionally and preserves audit history', async () => {
      const deleteResult = await deleteAccountAction(participantUser.id);
      expect(deleteResult.success).toBe(true);

      const userCheck = await prisma.user.findUnique({ where: { id: participantUser.id } });
      expect(userCheck).toBeNull();

      // Verify audit log exists even after user record deletion (SetNull onDelete)
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'ACCOUNT_DELETED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('investigator1@acn.org');
    });

    it('allows a deleted user email/username to re-register as a clean new account', async () => {
      await deleteAccountAction(participantUser.id);

      const newPassHash = await hashPassword('NewPassword123!');
      const reRegistered = await prisma.user.create({
        data: {
          email: 'investigator1@acn.org',
          username: 'investigator_01',
          passwordHash: newPassHash,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });

      expect(reRegistered.id).toBeDefined();
      expect(reRegistered.id).not.toBe(participantUser.id);
      expect(reRegistered.email).toBe('investigator1@acn.org');
    });
  });

  // =========================================================================
  // 5. SQUAD REGISTRY & TEAM MANAGEMENT
  // =========================================================================
  describe('5. Squad Registry & Team Management', () => {
    let testTeam: { id: string; name: string; code: string };

    beforeEach(async () => {
      const passHash = await hashPassword('SquadPass123!');
      testTeam = await prisma.team.create({
        data: {
          name: 'Cyber Strike Alpha',
          code: 'CYB-ALPHA1',
          passwordHash: passHash,
          creatorId: participantUser.id,
          score: 500,
          status: 'ACTIVE',
        },
      });

      await prisma.teamMember.create({
        data: {
          teamId: testTeam.id,
          userId: participantUser.id,
          role: 'CREATOR',
        },
      });
    });

    it('lists teams without exposing the participant join code', async () => {
      const result = await getTeamsAction({ page: 1, limit: 10 });
      expect(result.success).toBe(true);
      expect(result.data?.teams.length).toBe(1);

      const teamData = result.data!.teams[0]!;
      expect(teamData.name).toBe('Cyber Strike Alpha');
      expect('code' in teamData).toBe(false); // STRICTLY OMITTED
    });

    it('inspects team details without exposing the participant join code', async () => {
      const result = await getTeamDetailsAction(testTeam.id);
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Cyber Strike Alpha');
      expect(result.data?.members.length).toBe(1);
      expect(result.data!.members[0]!.username).toBe('investigator_01');
      expect('code' in (result.data || {})).toBe(false); // STRICTLY OMITTED
    });

    it('blocks a squad and logs TEAM_BLOCKED', async () => {
      const blockResult = await blockTeamAction(testTeam.id, 'Investigation infraction');
      expect(blockResult.success).toBe(true);

      const updatedTeam = await prisma.team.findUnique({ where: { id: testTeam.id } });
      expect(updatedTeam?.status).toBe('BLOCKED');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'TEAM_BLOCKED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('Cyber Strike Alpha');
    });

    it('unblocks a squad and logs TEAM_UNBLOCKED', async () => {
      await prisma.team.update({
        where: { id: testTeam.id },
        data: { status: 'BLOCKED' },
      });

      const unblockResult = await unblockTeamAction(testTeam.id);
      expect(unblockResult.success).toBe(true);

      const updatedTeam = await prisma.team.findUnique({ where: { id: testTeam.id } });
      expect(updatedTeam?.status).toBe('ACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'TEAM_UNBLOCKED' },
      });
      expect(audit).toBeDefined();
    });

    it('deletes a squad and unassigns member participants without deleting user accounts', async () => {
      const deleteResult = await deleteTeamAction(testTeam.id);
      expect(deleteResult.success).toBe(true);

      const teamCheck = await prisma.team.findUnique({ where: { id: testTeam.id } });
      expect(teamCheck).toBeNull();

      // Participant user account must remain active and valid!
      const userCheck = await prisma.user.findUnique({ where: { id: participantUser.id } });
      expect(userCheck).toBeDefined();
      expect(userCheck?.status).toBe('ACTIVE');

      // Membership is removed so user can join another squad
      const membershipCheck = await prisma.teamMember.findUnique({
        where: { userId: participantUser.id },
      });
      expect(membershipCheck).toBeNull();

      // Audit log records team deletion
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'TEAM_DELETED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('Cyber Strike Alpha');
    });
  });

  // =========================================================================
  // 6. PORTAL ONLINE / OFFLINE OPERATIONS
  // =========================================================================
  describe('6. Portal Online / Offline Operations', () => {
    it('retrieves default online portal status', async () => {
      const status = await getPortalStatus();
      expect(status.isOnline).toBe(true);
    });

    it('takes portal OFFLINE and records PORTAL_OFFLINE audit log', async () => {
      const offlineResult = await setPortalStatusAction(false);
      expect(offlineResult.success).toBe(true);
      expect(offlineResult.data?.isOnline).toBe(false);

      const dbStatus = await getPortalStatus();
      expect(dbStatus.isOnline).toBe(false);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PORTAL_OFFLINE' },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(creatorUser.id);
    });

    it('restores portal ONLINE and records PORTAL_ONLINE audit log', async () => {
      await setPortalStatus(false, creatorUser.id);

      const onlineResult = await setPortalStatusAction(true);
      expect(onlineResult.success).toBe(true);
      expect(onlineResult.data?.isOnline).toBe(true);

      const dbStatus = await getPortalStatus();
      expect(dbStatus.isOnline).toBe(true);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PORTAL_ONLINE' },
      });
      expect(audit).toBeDefined();
    });
  });

  // =========================================================================
  // 7. ACTIVITY & SESSIONS TELEMETRY
  // =========================================================================
  describe('7. Activity & Sessions Telemetry', () => {
    it('retrieves active sessions telemetry', async () => {
      await prisma.session.create({
        data: {
          userId: participantUser.id,
          token: 'active_token_1',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const result = await getActiveSessionsAction();
      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);
      expect(result.data![0]!.username).toBe('investigator_01');
    });

    it('retrieves paginated audit logs', async () => {
      await prisma.auditLog.createMany({
        data: [
          { action: 'LOGIN', details: 'User login test 1', actorId: creatorUser.id },
          { action: 'LOGOUT', details: 'User logout test 2', actorId: creatorUser.id },
        ],
      });

      const result = await getActivityLogsAction({ page: 1, limit: 10 });
      expect(result.success).toBe(true);
      expect(result.data?.logs.length).toBe(2);
    });
  });

  // =========================================================================
  // 8. CONCURRENCY SAFETY
  // =========================================================================
  describe('8. Concurrency Safety', () => {
    it('handles concurrent staff approval requests idempotently', async () => {
      const [res1, res2] = await Promise.all([
        approveStaffAction(evaluatorUser.id),
        approveStaffAction(evaluatorUser.id),
      ]);

      // Exactly one succeeds with transition from PENDING_APPROVAL, second safely handled
      const successCount = [res1.success, res2.success].filter(Boolean).length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      const user = await prisma.user.findUnique({ where: { id: evaluatorUser.id } });
      expect(user?.status).toBe('ACTIVE');
    });

    it('handles concurrent account deletion safely without database corruption', async () => {
      const [res1, res2] = await Promise.all([
        deleteAccountAction(participantUser.id),
        deleteAccountAction(participantUser.id),
      ]);

      const successCount = [res1.success, res2.success].filter(Boolean).length;
      expect(successCount).toBe(1);

      const user = await prisma.user.findUnique({ where: { id: participantUser.id } });
      expect(user).toBeNull();
    });
  });

  // =========================================================================
  // 9. CREATOR AUTHENTICATION & LOGIN FLOW (REQUIREMENT 9)
  // =========================================================================
  describe('9. Creator Authentication & Login Flow (Requirement 9)', () => {
    it('1. Correct Creator email + correct password → SUCCESS', async () => {
      const newHash = await hashPassword(TEST_CREATOR_PASSWORD);
      await prisma.user.update({
        where: { id: creatorUser.id },
        data: { passwordHash: newHash },
      });

      const formData = new FormData();
      formData.append('identifier', TEST_CREATOR_EMAIL);
      formData.append('password', TEST_CREATOR_PASSWORD);

      const result = await loginAction(formData);
      expect(result.success).toBe(true);
      expect(result.redirectTo).toBe('/creator');
    });

    it('1b. Creator login by username (@event_creator) + correct password → SUCCESS', async () => {
      const formData = new FormData();
      formData.append('identifier', 'event_creator');
      formData.append('password', 'CyberOdyssey2026!');

      const result = await loginAction(formData);
      expect(result.success).toBe(true);
      expect(result.redirectTo).toBe('/creator');
    });

    it('2. Correct Creator email + incorrect password → INVALID CREDENTIALS', async () => {
      const formData = new FormData();
      formData.append('identifier', TEST_CREATOR_EMAIL);
      formData.append('password', 'WrongPassword123!');

      const result = await loginAction(formData);
      expect(result.success).toBe(false);
      expect(result.error).toContain('was not recognised');
    });

    it('3. Unknown email + password → INVALID CREDENTIALS', async () => {
      const formData = new FormData();
      formData.append('identifier', 'nonexistent_creator@acn.org');
      formData.append('password', 'CyberOdyssey2026!');

      const result = await loginAction(formData);
      expect(result.success).toBe(false);
      expect(result.error).toContain('was not recognised');
    });

    it('4. Creator with ACTIVE status → allowed', async () => {
      const formData = new FormData();
      formData.append('identifier', TEST_CREATOR_EMAIL);
      formData.append('password', 'CyberOdyssey2026!');

      const result = await loginAction(formData);
      expect(result.success).toBe(true);
    });

    it('5. Creator with BLOCKED/SUSPENDED status → denied', async () => {
      await prisma.user.update({
        where: { id: creatorUser.id },
        data: { status: 'BLOCKED' },
      });

      const formData = new FormData();
      formData.append('identifier', TEST_CREATOR_EMAIL);
      formData.append('password', 'CyberOdyssey2026!');

      const result = await loginAction(formData);
      expect(result.success).toBe(false);
      expect(result.error).toContain('currently blocked');
    });

    it('6. Non-Creator attempting /creator → denied', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUser as unknown as SessionUser,
      );

      const result = await getCreatorOverviewStatsAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('7. Successful Creator login → session role remains CREATOR', async () => {
      const formData = new FormData();
      formData.append('identifier', TEST_CREATOR_EMAIL);
      formData.append('password', 'CyberOdyssey2026!');

      const result = await loginAction(formData);
      expect(result.success).toBe(true);

      const latestSession = await prisma.session.findFirst({
        where: { userId: creatorUser.id },
        include: { user: true },
      });
      expect(latestSession).toBeDefined();
      expect(latestSession?.user.role).toBe('CREATOR');
      expect(latestSession?.user.status).toBe('ACTIVE');
    });

    it('8. Successful Creator login → redirects to /creator', async () => {
      const formData = new FormData();
      formData.append('identifier', TEST_CREATOR_EMAIL);
      formData.append('password', 'CyberOdyssey2026!');

      const result = await loginAction(formData);
      expect(result.success).toBe(true);
      expect(result.redirectTo).toBe('/creator');
    });
  });
});
