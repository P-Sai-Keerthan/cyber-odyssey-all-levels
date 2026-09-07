import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { requireAdmin, requireParticipant } from '@/lib/auth/guards';
import {
  getAdminOverviewStatsAction,
  getAdminParticipantsAction,
  getAdminTeamsAction,
  startLevelAction,
  pauseLevelAction,
  resumeLevelAction,
  stopLevelAction,
  resetLevelAction,
  configureLevelDurationAction,
  getAdminSubmissionsAction,
  getAdminEvaluationsAction,
  createAnnouncementAction,
  deleteAnnouncementAction,
  markNotificationAsReadAction,
  markAllNotificationsAsReadAction,
  getAdminActivityAction,
  toggleEventPortalStatusAction,
} from '@/lib/actions/admin-actions';
import {
  startLevelState,
  pauseLevelState,
  resumeLevelState,
  stopLevelState,
  resetLevelState,
  configureLevelDuration,
  getLevelStates,
  getActiveLevel,
  resetLevelStateVerificationCache,
} from '@/lib/event/level-state';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
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

describe('ACN Cyber Odyssey — Phase 12 Admin Portal Test Suite', () => {
  let adminUser: TestUser;
  let evaluatorUser: TestUser;
  let participantUser: TestUser;
  let testTeam: { id: string; name: string; code: string; score: number };
  let testSubmission: { id: string; teamId: string; userId: string; level: number; status: string };

  beforeEach(async () => {
    // Reset database tables
    await prisma.notification.deleteMany({});
    await prisma.announcement.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.levelState.deleteMany({});
    // Level-state existence is latched per process (PERF-17-05); truncating the
    // table invalidates that latch.
    resetLevelStateVerificationCache();
    await prisma.portalSetting.deleteMany({});

    const passwordHash = await hashPassword('CyberAdmin2026!');

    // 1. Seed Admin User
    adminUser = await prisma.user.create({
      data: {
        email: 'admin1@acn.org',
        username: 'admin1',
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    // 2. Seed Creator User
    await prisma.user.create({
      data: {
        email: 'creator@acn.org',
        username: 'creator1',
        passwordHash,
        role: 'CREATOR',
        status: 'ACTIVE',
      },
    });

    // 3. Seed Evaluator User
    evaluatorUser = await prisma.user.create({
      data: {
        email: 'evaluator1@acn.org',
        username: 'evaluator1',
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });

    // 4. Seed Participants
    participantUser = await prisma.user.create({
      data: {
        email: 'participant1@gmail.com',
        username: 'participant1',
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    await prisma.user.create({
      data: {
        email: 'participant2@gmail.com',
        username: 'participant2',
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    // 5. Seed Team
    testTeam = await prisma.team.create({
      data: {
        name: 'Alpha Strike Squad',
        code: 'ALPHA-9988',
        passwordHash,
        creatorId: participantUser.id,
        score: 750,
        status: 'ACTIVE',
      },
    });

    await prisma.teamMember.create({
      data: {
        userId: participantUser.id,
        teamId: testTeam.id,
        role: 'HEAD',
      },
    });

    // 6. Seed Submission & Evaluation
    testSubmission = await prisma.submission.create({
      data: {
        teamId: testTeam.id,
        userId: participantUser.id,
        level: 2,
        status: 'SUBMITTED',
      },
    });

    await prisma.submissionFile.create({
      data: {
        submissionId: testSubmission.id,
        fileName: 'report_level2.pdf',
        originalName: 'report_level2.pdf',
        storagePath: '/uploads/report_level2.pdf',
        fileSize: 2048576,
        mimeType: 'application/pdf',
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: testSubmission.id,
        evaluatorId: evaluatorUser.id,
        teamId: testTeam.id,
        level: 2,
        status: 'EVALUATED',
        score: 85,
        maxScore: 100,
        feedback: 'Solid memory forensics analysis and accurate timestamp reconstruction.',
      },
    });

    // 7. Seed Level States
    await prisma.levelState.createMany({
      data: [
        {
          levelNumber: 1,
          name: 'The Initial Trace',
          codename: 'PHASE 1: PERIMETER FORENSICS',
          status: 'COMPLETED',
          durationMinutes: 60,
          durationSeconds: 3600,
          remainingSeconds: 0,
        },
        {
          levelNumber: 2,
          name: "The Boar's Mark",
          codename: 'PHASE 2: MEMORY ARTIFACTS & LATERAL MOVEMENT',
          status: 'LIVE',
          durationMinutes: 120,
          durationSeconds: 7200,
          remainingSeconds: 3600,
          startedAt: new Date(Date.now() - 3600 * 1000),
          endsAt: new Date(Date.now() + 3600 * 1000),
        },
        {
          levelNumber: 3,
          name: 'The Twelve Axes',
          codename: 'PHASE 3: MALWARE REVERSING & PERSISTENCE',
          status: 'LOCKED',
          durationMinutes: 90,
          durationSeconds: 5400,
          remainingSeconds: 5400,
        },
      ],
    });

    // Mock session as Admin
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(adminUser as SessionUser);
  });

  // ==========================================
  // 1. Role Guards & Authorization
  // ==========================================
  describe('1. Role Authorization & Strict Separation', () => {
    it('allows ACTIVE Admin to access Admin area via requireAdmin()', async () => {
      const result = await requireAdmin();
      expect(result.id).toBe(adminUser.id);
      expect(result.role).toBe('ADMIN');
      expect(result.status).toBe('ACTIVE');
    });

    it('blocks non-admin users (CREATOR, EVALUATOR, PARTICIPANT) from requireAdmin()', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(evaluatorUser as SessionUser);
      await expect(requireAdmin()).rejects.toThrow();

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(participantUser as SessionUser);
      await expect(requireAdmin()).rejects.toThrow();
    });

    it('blocks suspended or inactive Admin from requireAdmin()', async () => {
      const suspendedAdmin = await prisma.user.create({
        data: {
          email: 'suspended_admin@acn.org',
          username: 'suspended_admin',
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'SUSPENDED',
        },
      });

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
        ...suspendedAdmin,
        membership: null,
      } as unknown as SessionUser);
      await expect(requireAdmin()).rejects.toThrow();
    });

    it('routes Admin to /admin when calling requireParticipant()', async () => {
      await expect(requireParticipant()).rejects.toThrow();
    });
  });

  // ==========================================
  // 2. Overview Telemetry
  // ==========================================
  describe('2. Overview Operations Telemetry', () => {
    it('returns complete, real database telemetry counts', async () => {
      const res = await getAdminOverviewStatsAction();
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      const stats = res.data!;
      expect(stats.totalParticipants).toBe(2);
      expect(stats.totalTeams).toBe(1);
      expect(stats.totalEvaluators).toBe(1);
      expect(stats.totalAdmins).toBe(1);
      expect(stats.submittedInvestigations).toBe(1);
      expect(stats.evaluatedInvestigations).toBe(1);
      expect(stats.levels.length).toBe(3);
      expect(stats.portalStatus.isOnline).toBe(true);
    });
  });

  // ==========================================
  // 3. Participant Directory & Privacy
  // ==========================================
  describe('3. Participant Directory & Privacy Enforcement', () => {
    it('returns searchable, filterable participant list', async () => {
      const res = await getAdminParticipantsAction();
      expect(res.success).toBe(true);
      expect(res.data!.participants.length).toBe(2);

      const p1 = res.data!.participants.find((p) => p.id === participantUser.id);
      expect(p1).toBeDefined();
      expect(p1!.username).toBe('participant1');
      expect(p1!.teamName).toBe('Alpha Strike Squad');
      expect(p1!.teamRole).toBe('HEAD');
    });

    it('strictly masks/never returns password hashes or session tokens to Admins', async () => {
      const res = await getAdminParticipantsAction();
      expect(res.success).toBe(true);
      for (const p of res.data!.participants) {
        expect((p as unknown as Record<string, unknown>)['passwordHash']).toBeUndefined();
        expect((p as unknown as Record<string, unknown>)['token']).toBeUndefined();
      }
    });
  });

  // ==========================================
  // 4. Squads Monitoring & Join Code Masking
  // ==========================================
  describe('4. Squads Monitoring & Privacy', () => {
    it('returns squads with scores, member lists, and submission progress', async () => {
      const res = await getAdminTeamsAction();
      expect(res.success).toBe(true);
      expect(res.data!.teams.length).toBe(1);

      const t = res.data!.teams[0];
      expect(t).toBeDefined();
      expect(t!.name).toBe('Alpha Strike Squad');
      expect(t!.score).toBe(750);
      expect(t!.headUsername).toBe('participant1');
      expect(t!.level2Submitted).toBe(true);
      expect(t!.members.length).toBe(1);
    });

    it('strictly hides team join codes and passwords from Admin view', async () => {
      const res = await getAdminTeamsAction();
      expect(res.success).toBe(true);
      const t = res.data!.teams[0];
      expect((t as unknown as Record<string, unknown>)['code']).toBeUndefined();
      expect((t as unknown as Record<string, unknown>)['password']).toBeUndefined();
    });
  });

  // ==========================================
  // 5. Authoritative Level Management & Timers
  // ==========================================
  describe('5. Authoritative Level Lifecycle & Live Timers', () => {
    it('queries all authoritative level states', async () => {
      const states = await getLevelStates();
      expect(states.length).toBe(3);
      expect(states[0]!.status).toBe('COMPLETED');
      expect(states[1]!.status).toBe('LIVE');
      expect(states[2]!.status).toBe('LOCKED');
    });

    it('identifies the active live level', async () => {
      const active = await getActiveLevel();
      expect(active).toBeDefined();
      expect(active!.levelNumber).toBe(2);
      expect(active!.status).toBe('LIVE');
    });

    it('starts a level and calculates authoritative endsAt timestamp', async () => {
      const updated = await startLevelState(3, adminUser.id);
      expect(updated.status).toBe('LIVE');
      expect(updated.startedAt).toBeDefined();
      expect(updated.endsAt).toBeDefined();
      expect(updated.remainingSeconds).toBeGreaterThan(0);

      // Verify audit log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'LEVEL_STARTED' },
      });
      expect(log).toBeDefined();
      expect(log!.details).toContain('Level 3');
    });

    it('pauses a level, freezes countdown, and preserves remainingSeconds', async () => {
      const paused = await pauseLevelState(2, adminUser.id);
      expect(paused.status).toBe('PAUSED');
      expect(paused.pausedAt).toBeDefined();
      expect(paused.remainingSeconds).toBeGreaterThanOrEqual(3590);
      expect(paused.remainingSeconds).toBeLessThanOrEqual(3600);

      // Check level access returns isPaused
      const access = await checkAuthoritativeLevelAccess(2, true);
      expect(access.allowed).toBe(false);
      expect(access.isPaused).toBe(true);
      expect(access.reason).toContain('LEVEL PAUSED');
    });

    it('resumes a paused level and calculates a new authoritative endsAt', async () => {
      await pauseLevelState(2, adminUser.id);
      const resumed = await resumeLevelState(2, adminUser.id);
      expect(resumed.status).toBe('LIVE');
      expect(resumed.pausedAt).toBeNull();
      expect(resumed.endsAt).toBeDefined();

      const access = await checkAuthoritativeLevelAccess(2, true);
      expect(access.allowed).toBe(true);
    });

    it('stops/completes a level and closes participant submissions', async () => {
      const stopped = await stopLevelState(2, adminUser.id);
      expect(stopped.status).toBe('COMPLETED');
      expect(stopped.completedAt).toBeDefined();
      expect(stopped.remainingSeconds).toBe(0);

      const access = await checkAuthoritativeLevelAccess(2, true);
      expect(access.allowed).toBe(false);
      expect(access.isCompleted).toBe(true);
    });

    it('resets a level to LOCKED', async () => {
      const reset = await resetLevelState(2, adminUser.id);
      expect(reset.status).toBe('LOCKED');
      expect(reset.startedAt).toBeNull();
      expect(reset.endsAt).toBeNull();
    });

    it('configures level duration in database', async () => {
      const configured = await configureLevelDuration(2, 180, adminUser.id);
      expect(configured.durationMinutes).toBe(180);
      expect(configured.durationSeconds).toBe(180 * 60);
    });

    it('invokes level control actions from server actions', async () => {
      const resStart = await startLevelAction(3);
      expect(resStart.success).toBe(true);

      const resPause = await pauseLevelAction(3);
      expect(resPause.success).toBe(true);
      expect(resPause.data!.status).toBe('PAUSED');

      const resResume = await resumeLevelAction(3);
      expect(resResume.success).toBe(true);
      expect(resResume.data!.status).toBe('LIVE');

      const resStop = await stopLevelAction(3);
      expect(resStop.success).toBe(true);
      expect(resStop.data!.status).toBe('COMPLETED');

      const resReset = await resetLevelAction(3);
      expect(resReset.success).toBe(true);
      expect(resReset.data!.status).toBe('LOCKED');

      const resDuration = await configureLevelDurationAction(3, 45);
      expect(resDuration.success).toBe(true);
      expect(resDuration.data!.durationMinutes).toBe(45);
    });
  });

  // ==========================================
  // 6. Submissions & Evaluations Read-Only Monitoring
  // ==========================================
  describe('6. Submissions & Evaluations Monitoring', () => {
    it('returns read-only submissions with filters', async () => {
      const res = await getAdminSubmissionsAction({ level: 2 });
      expect(res.success).toBe(true);
      expect(res.data!.submissions.length).toBe(1);
      expect(res.data!.submissions[0]!.teamName).toBe('Alpha Strike Squad');
      expect(res.data!.submissions[0]!.fileCount).toBe(1);
      expect(res.data!.submissions[0]!.evaluationStatus).toBe('EVALUATED');
      expect(res.data!.submissions[0]!.score).toBe(85);
    });

    it('returns read-only evaluations with rubric scores and evaluator usernames', async () => {
      const res = await getAdminEvaluationsAction();
      expect(res.success).toBe(true);
      expect(res.data!.evaluations.length).toBe(1);
      expect(res.data!.evaluations[0]!.evaluatorUsername).toBe('evaluator1');
      expect(res.data!.evaluations[0]!.score).toBe(85);
      expect(res.data!.evaluations[0]!.feedback).toContain('memory forensics');
    });
  });

  // ==========================================
  // 7. Announcements & Notifications Engine
  // ==========================================
  describe('7. Announcements & Notification Engine', () => {
    it('creates and publishes broadcast to ALL users, creating individual user notifications', async () => {
      const res = await createAnnouncementAction({
        title: 'EMERGENCY: SERVER MAINTENANCE COMPLETED',
        content: 'All teams may resume operations on Level 2.',
        category: 'URGENT',
        priority: 'URGENT',
        targetAudience: 'ALL',
        publishImmediately: true,
      });

      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      // Notifications should have been generated for all active users
      const notifications = await prisma.notification.findMany({
        where: { announcementId: res.data!.id },
      });
      expect(notifications.length).toBeGreaterThanOrEqual(4); // admin, creator, evaluator, participants
    });

    it('creates targeted broadcast to PARTICIPANTS only', async () => {
      const res = await createAnnouncementAction({
        title: 'PARTICIPANT BRIEFING',
        content: 'Check your telemetry logs.',
        category: 'MISSION',
        priority: 'NORMAL',
        targetAudience: 'PARTICIPANTS',
        publishImmediately: true,
      });

      expect(res.success).toBe(true);

      const notifications = await prisma.notification.findMany({
        where: { announcementId: res.data!.id },
        include: { user: true },
      });

      expect(notifications.length).toBe(2);
      for (const n of notifications) {
        expect(n.user.role).toBe('PARTICIPANT');
      }
    });

    it('deletes an announcement and cascades notifications', async () => {
      const createRes = await createAnnouncementAction({
        title: 'TEMPORARY NOTICE',
        content: 'To be removed.',
        targetAudience: 'ALL',
        publishImmediately: true,
      });

      const annId = createRes.data!.id;
      const delRes = await deleteAnnouncementAction(annId);
      expect(delRes.success).toBe(true);

      const count = await prisma.announcement.count({ where: { id: annId } });
      expect(count).toBe(0);
    });

    it('allows marking notifications as read', async () => {
      const createRes = await createAnnouncementAction({
        title: 'READ TEST',
        content: 'Mark me as read.',
        targetAudience: 'ALL',
        publishImmediately: true,
      });

      const notif = await prisma.notification.findFirst({
        where: { announcementId: createRes.data!.id, userId: adminUser.id },
      });
      expect(notif).toBeDefined();
      expect(notif!.read).toBe(false);

      const markRes = await markNotificationAsReadAction(notif!.id);
      expect(markRes.success).toBe(true);

      const updated = await prisma.notification.findUnique({ where: { id: notif!.id } });
      expect(updated!.read).toBe(true);
    });

    it('allows marking all notifications as read for current user', async () => {
      await createAnnouncementAction({
        title: 'NOTICE 1',
        content: 'Content 1',
        targetAudience: 'ALL',
        publishImmediately: true,
      });
      await createAnnouncementAction({
        title: 'NOTICE 2',
        content: 'Content 2',
        targetAudience: 'ALL',
        publishImmediately: true,
      });

      const res = await markAllNotificationsAsReadAction();
      expect(res.success).toBe(true);

      const unreadCount = await prisma.notification.count({
        where: { userId: adminUser.id, read: false },
      });
      expect(unreadCount).toBe(0);
    });
  });

  // ==========================================
  // 8. Activity Stream & Audit Logging
  // ==========================================
  describe('8. Activity Stream & Audit Logging', () => {
    it('returns chronological audit logs', async () => {
      await prisma.auditLog.create({
        data: {
          actorId: adminUser.id,
          action: 'LEVEL_STARTED',
          details: 'Admin started Level 2.',
        },
      });

      const res = await getAdminActivityAction();
      expect(res.success).toBe(true);
      expect(res.data!.logs.length).toBeGreaterThan(0);
      expect(res.data!.logs[0]!.action).toBe('LEVEL_STARTED');
      expect(res.data!.logs[0]!.actorUsername).toBe('admin1');
    });
  });

  // ==========================================
  // 9. Event Operations & Portal Status Toggle
  // ==========================================
  describe('9. Portal Status Control', () => {
    it('toggles portal online/offline and records audit log', async () => {
      const resOffline = await toggleEventPortalStatusAction(false);
      expect(resOffline.success).toBe(true);
      expect(resOffline.data!.isOnline).toBe(false);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'PORTAL_OFFLINE' },
      });
      expect(log).toBeDefined();

      const resOnline = await toggleEventPortalStatusAction(true);
      expect(resOnline.success).toBe(true);
      expect(resOnline.data!.isOnline).toBe(true);
    });
  });
});
