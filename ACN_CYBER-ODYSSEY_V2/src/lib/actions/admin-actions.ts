'use server';

import { safeRevalidate } from '@/lib/utils/revalidate';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { setPortalStatus, getPortalStatus } from '@/lib/event/portal-settings';
import {
  getLevelStates,
  startLevelState,
  pauseLevelState,
  resumeLevelState,
  stopLevelState,
  resetLevelState,
  configureLevelDuration,
  type AuthoritativeLevelState,
} from '@/lib/event/level-state';
import { recordThrottledAuditEvent } from '@/lib/audit/audit-log';
import type { ActionResult } from './auth-actions';
import { findTeamHead } from '@/lib/team/roles';

/**
 * Server-side guard helper for Admin actions.
 */
async function requireAdminUser() {
  const user = await getSessionUser();
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    throw new Error('Unauthorized admin access. Active Admin credentials required.');
  }
  return user;
}

export interface AdminOverviewStats {
  totalParticipants: number;
  totalTeams: number;
  totalEvaluators: number;
  totalAdmins: number;
  activeUsers: number;
  pendingStaff: number;
  submittedInvestigations: number;
  evaluatedInvestigations: number;
  portalStatus: {
    isOnline: boolean;
    updatedAt: string;
    updatedBy: string | null;
  };
  levels: AuthoritativeLevelState[];
}

export interface AdminParticipantItem {
  id: string;
  email: string;
  username: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  lastLogoutAt: string | null;
  lastActivityAt: string | null;
  teamId: string | null;
  teamName: string | null;
  teamRole: string | null;
  submissionCount: number;
}

export interface AdminTeamItem {
  id: string;
  name: string;
  score: number;
  status: string;
  createdAt: string;
  headUsername: string | null;
  memberCount: number;
  members: Array<{
    id: string;
    username: string;
    email: string;
    role: string;
  }>;
  submissionCount: number;
  level2Submitted: boolean;
}

export interface AdminSubmissionItem {
  id: string;
  level: number;
  teamId: string;
  teamName: string;
  userId: string;
  submitterUsername: string;
  status: string;
  submittedAt: string;
  fileCount: number;
  evaluationStatus: string | null;
  evaluatorUsername: string | null;
  score: number | null;
  maxScore: number | null;
}

export interface AdminEvaluationItem {
  id: string;
  submissionId: string;
  level: number;
  teamId: string;
  teamName: string;
  evaluatorId: string;
  evaluatorUsername: string;
  status: string;
  score: number;
  maxScore: number;
  startedAt: string | null;
  submittedAt: string | null;
  updatedAt: string;
  feedback: string | null;
}

export interface AdminAnnouncementItem {
  id: string;
  title: string;
  content: string;
  category: string;
  priority: string;
  targetAudience: string;
  levelNumber: number | null;
  createdBy: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  notificationCount: number;
}

export interface AdminActivityItem {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  targetId: string | null;
  targetUsername: string | null;
  action: string;
  details: string | null;
  createdAt: string;
}

// =========================================================================
// 1. OVERVIEW TELEMETRY
// =========================================================================

export async function getAdminOverviewStatsAction(): Promise<ActionResult<AdminOverviewStats>> {
  try {
    await requireAdminUser();

    const [
      totalParticipants,
      totalTeams,
      totalEvaluators,
      totalAdmins,
      activeUsers,
      pendingStaff,
      submittedInvestigations,
      evaluatedInvestigations,
      portalStatusData,
      levels,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'PARTICIPANT' } }),
      prisma.team.count(),
      prisma.user.count({ where: { role: 'EVALUATOR', status: 'ACTIVE' } }),
      prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.submission.count(),
      prisma.evaluation.count({ where: { status: 'EVALUATED' } }),
      getPortalStatus(),
      getLevelStates(),
    ]);

    return {
      success: true,
      data: {
        totalParticipants,
        totalTeams,
        totalEvaluators,
        totalAdmins,
        activeUsers,
        pendingStaff,
        submittedInvestigations,
        evaluatedInvestigations,
        portalStatus: {
          isOnline: portalStatusData.isOnline,
          updatedAt: portalStatusData.updatedAt.toISOString(),
          updatedBy: portalStatusData.updatedBy,
        },
        levels,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve admin overview telemetry.',
    };
  }
}

// =========================================================================
// 2. PARTICIPANTS MONITORING (READ-ONLY)
// =========================================================================

export async function getAdminParticipantsAction(params?: {
  query?: string;
  status?: string;
  teamFilter?: string; // ALL, ASSIGNED, TEAMLESS
}): Promise<ActionResult<{ participants: AdminParticipantItem[]; total: number }>> {
  try {
    const admin = await requireAdminUser();

    const whereClause: Record<string, unknown> = {
      role: 'PARTICIPANT',
    };

    if (params?.status && params.status !== 'ALL') {
      whereClause['status'] = params.status;
    }

    if (params?.teamFilter === 'TEAMLESS') {
      whereClause['membership'] = null;
    } else if (params?.teamFilter === 'ASSIGNED') {
      whereClause['membership'] = { isNot: null };
    }

    if (params?.query?.trim()) {
      const q = params.query.trim().toLowerCase();
      whereClause['OR'] = [
        { email: { contains: q } },
        { username: { contains: q } },
        { membership: { team: { name: { contains: q } } } },
      ];
    }

    // PERF-17-06: _count instead of materialising every submission row just to
    // read its length, and an explicit team select instead of `team: true` --
    // which loaded Team.code (the private join code) and Team.passwordHash into
    // server memory on every query. Neither was ever sent to the client, but
    // there is no reason to read them at all.
    // PERF-17-01: the list and its count are issued together.
    const [participants, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          username: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          lastLogoutAt: true,
          lastActivityAt: true,
          membership: {
            select: {
              teamId: true,
              role: true,
              team: { select: { name: true } },
            },
          },
          _count: { select: { submissions: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    // PERF-17-04: recorded at most once per admin per 15 minutes. This previously
    // wrote a row on every list query, including every filter keystroke.
    void recordThrottledAuditEvent({
      actorId: admin.id,
      action: 'PARTICIPANT_VIEWED',
      details: `Admin @${admin.username} reviewed the participants console.`,
    });

    return {
      success: true,
      data: {
        participants: participants.map((p) => ({
          id: p.id,
          email: p.email,
          username: p.username,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
          lastLoginAt: p.lastLoginAt ? p.lastLoginAt.toISOString() : null,
          lastLogoutAt: p.lastLogoutAt ? p.lastLogoutAt.toISOString() : null,
          lastActivityAt: p.lastActivityAt ? p.lastActivityAt.toISOString() : null,
          teamId: p.membership?.teamId || null,
          teamName: p.membership?.team?.name || null,
          teamRole: p.membership?.role || null,
          submissionCount: p._count.submissions,
        })),
        total,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to query participants.',
    };
  }
}

// =========================================================================
// 3. TEAMS MONITORING (READ-ONLY)
// =========================================================================

export async function getAdminTeamsAction(params?: {
  query?: string;
}): Promise<ActionResult<{ teams: AdminTeamItem[]; total: number }>> {
  try {
    const admin = await requireAdminUser();

    const whereClause: Record<string, unknown> = {};

    if (params?.query?.trim()) {
      const q = params.query.trim().toLowerCase();
      whereClause['OR'] = [
        { name: { contains: q } },
        { members: { some: { user: { username: { contains: q } } } } },
      ];
    }

    // PERF-17-06 / PRIVACY: explicit selects only. Team.code and
    // Team.passwordHash are never read here.
    const [teams, total] = await Promise.all([
      prisma.team.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          score: true,
          status: true,
          createdAt: true,
          members: {
            select: {
              role: true,
              user: { select: { id: true, username: true, email: true } },
            },
            orderBy: { slot: 'asc' },
          },
          // `level` is still needed to derive level2Submitted, so these rows are
          // read deliberately rather than counted.
          submissions: { select: { level: true } },
        },
        orderBy: { score: 'desc' },
        take: 100,
      }),
      prisma.team.count({ where: whereClause }),
    ]);

    // PERF-17-04: throttled; see getAdminParticipantsAction.
    void recordThrottledAuditEvent({
      actorId: admin.id,
      action: 'TEAM_VIEWED',
      details: `Admin @${admin.username} reviewed the squad monitor.`,
    });

    return {
      success: true,
      data: {
        teams: teams.map((t) => {
          const headMember = findTeamHead(t.members);
          const hasL2 = t.submissions.some((s) => s.level === 2);
          return {
            id: t.id,
            name: t.name,
            score: t.score,
            status: t.status,
            createdAt: t.createdAt.toISOString(),
            headUsername: headMember?.user.username || null,
            memberCount: t.members.length,
            members: t.members.map((m) => ({
              id: m.user.id,
              username: m.user.username,
              email: m.user.email,
              role: m.role,
            })),
            submissionCount: t.submissions.length,
            level2Submitted: hasL2,
          };
        }),
        total,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to query teams.',
    };
  }
}

// =========================================================================
// 4. LEVEL MANAGEMENT & AUTHORITATIVE TIMERS
// =========================================================================

export async function getAdminLevelsAction(): Promise<
  ActionResult<{
    levels: Array<
      AuthoritativeLevelState & {
        participatingTeams: number;
        submissionCount: number;
        evaluationCount: number;
      }
    >;
  }>
> {
  try {
    await requireAdminUser();

    const levels = await getLevelStates();

    const [submissionsByLevel, evaluationsByLevel, totalTeams] = await Promise.all([
      prisma.submission.groupBy({
        by: ['level'],
        _count: { id: true },
      }),
      prisma.evaluation.groupBy({
        by: ['level'],
        _count: { id: true },
      }),
      prisma.team.count(),
    ]);

    const subMap = new Map(submissionsByLevel.map((s) => [s.level, s._count.id]));
    const evalMap = new Map(evaluationsByLevel.map((e) => [e.level, e._count.id]));

    const enriched = levels.map((lvl) => ({
      ...lvl,
      participatingTeams: totalTeams,
      submissionCount: subMap.get(lvl.levelNumber) || 0,
      evaluationCount: evalMap.get(lvl.levelNumber) || 0,
    }));

    return {
      success: true,
      data: { levels: enriched },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load level states.',
    };
  }
}

export async function startLevelAction(
  levelNumber: number,
): Promise<ActionResult<AuthoritativeLevelState>> {
  try {
    const admin = await requireAdminUser();
    const updated = await startLevelState(levelNumber, admin.id);

    safeRevalidate(
      '/admin',
      '/admin/levels',
      '/dashboard',
      '/event',
      `/event/level-${levelNumber}`,
    );

    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : `Failed to start Level ${levelNumber}.`,
    };
  }
}

export async function pauseLevelAction(
  levelNumber: number,
): Promise<ActionResult<AuthoritativeLevelState>> {
  try {
    const admin = await requireAdminUser();
    const updated = await pauseLevelState(levelNumber, admin.id);

    safeRevalidate(
      '/admin',
      '/admin/levels',
      '/dashboard',
      '/event',
      `/event/level-${levelNumber}`,
    );

    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : `Failed to pause Level ${levelNumber}.`,
    };
  }
}

export async function resumeLevelAction(
  levelNumber: number,
): Promise<ActionResult<AuthoritativeLevelState>> {
  try {
    const admin = await requireAdminUser();
    const updated = await resumeLevelState(levelNumber, admin.id);

    safeRevalidate(
      '/admin',
      '/admin/levels',
      '/dashboard',
      '/event',
      `/event/level-${levelNumber}`,
    );

    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : `Failed to resume Level ${levelNumber}.`,
    };
  }
}

export async function stopLevelAction(
  levelNumber: number,
): Promise<ActionResult<AuthoritativeLevelState>> {
  try {
    const admin = await requireAdminUser();
    const updated = await stopLevelState(levelNumber, admin.id);

    safeRevalidate(
      '/admin',
      '/admin/levels',
      '/dashboard',
      '/event',
      `/event/level-${levelNumber}`,
    );

    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : `Failed to stop Level ${levelNumber}.`,
    };
  }
}

export async function resetLevelAction(
  levelNumber: number,
): Promise<ActionResult<AuthoritativeLevelState>> {
  try {
    const admin = await requireAdminUser();
    const updated = await resetLevelState(levelNumber, admin.id);

    safeRevalidate(
      '/admin',
      '/admin/levels',
      '/dashboard',
      '/event',
      `/event/level-${levelNumber}`,
    );

    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : `Failed to reset Level ${levelNumber}.`,
    };
  }
}

export async function configureLevelDurationAction(
  levelNumber: number,
  durationMinutes: number,
): Promise<ActionResult<AuthoritativeLevelState>> {
  try {
    const admin = await requireAdminUser();
    const updated = await configureLevelDuration(levelNumber, durationMinutes, admin.id);

    safeRevalidate(
      '/admin',
      '/admin/levels',
      '/dashboard',
      '/event',
      `/event/level-${levelNumber}`,
    );

    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : `Failed to set duration for Level ${levelNumber}.`,
    };
  }
}

// =========================================================================
// 5. SUBMISSIONS MONITORING (READ-ONLY)
// =========================================================================

export async function getAdminSubmissionsAction(params?: {
  level?: number;
  status?: string;
  query?: string;
}): Promise<ActionResult<{ submissions: AdminSubmissionItem[]; total: number }>> {
  try {
    const admin = await requireAdminUser();

    const whereClause: Record<string, unknown> = {};

    if (params?.level && params.level > 0) {
      whereClause['level'] = params.level;
    }

    if (params?.status && params.status !== 'ALL') {
      whereClause['status'] = params.status;
    }

    if (params?.query?.trim()) {
      const q = params.query.trim().toLowerCase();
      whereClause['OR'] = [
        { team: { name: { contains: q } } },
        { user: { username: { contains: q } } },
      ];
    }

    // PERF-17-06 / PRIVACY: `team: true` loaded Team.code and Team.passwordHash;
    // `user: true` loaded User.passwordHash. Replaced with explicit selects so
    // credentials never enter application memory on a monitoring query.
    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where: whereClause,
        select: {
          id: true,
          level: true,
          teamId: true,
          userId: true,
          status: true,
          submittedAt: true,
          team: { select: { name: true } },
          user: { select: { username: true } },
          _count: { select: { files: true } },
          evaluation: {
            select: {
              status: true,
              score: true,
              maxScore: true,
              evaluator: { select: { username: true } },
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
        take: 100,
      }),
      prisma.submission.count({ where: whereClause }),
    ]);

    // PERF-17-04: throttled; see getAdminParticipantsAction.
    void recordThrottledAuditEvent({
      actorId: admin.id,
      action: 'SUBMISSION_VIEWED',
      details: `Admin @${admin.username} reviewed the submissions console.`,
    });

    return {
      success: true,
      data: {
        submissions: submissions.map((s) => ({
          id: s.id,
          level: s.level,
          teamId: s.teamId,
          teamName: s.team.name,
          userId: s.userId,
          submitterUsername: s.user.username,
          status: s.status,
          submittedAt: s.submittedAt.toISOString(),
          fileCount: s._count.files,
          evaluationStatus: s.evaluation?.status || null,
          evaluatorUsername: s.evaluation?.evaluator?.username || null,
          score: s.evaluation?.score ?? null,
          maxScore: s.evaluation?.maxScore ?? null,
        })),
        total,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to query submissions.',
    };
  }
}

// =========================================================================
// 6. EVALUATIONS MONITORING (READ-ONLY)
// =========================================================================

export async function getAdminEvaluationsAction(params?: {
  level?: number;
  status?: string;
  query?: string;
}): Promise<ActionResult<{ evaluations: AdminEvaluationItem[]; total: number }>> {
  try {
    await requireAdminUser();

    const whereClause: Record<string, unknown> = {};

    if (params?.level && params.level > 0) {
      whereClause['level'] = params.level;
    }

    if (params?.status && params.status !== 'ALL') {
      whereClause['status'] = params.status;
    }

    if (params?.query?.trim()) {
      const q = params.query.trim().toLowerCase();
      whereClause['OR'] = [
        { team: { name: { contains: q } } },
        { evaluator: { username: { contains: q } } },
      ];
    }

    // PERF-17-06 / PRIVACY: explicit selects instead of whole-record includes.
    const [evaluations, total] = await Promise.all([
      prisma.evaluation.findMany({
        where: whereClause,
        select: {
          id: true,
          submissionId: true,
          level: true,
          teamId: true,
          evaluatorId: true,
          status: true,
          score: true,
          maxScore: true,
          startedAt: true,
          submittedAt: true,
          updatedAt: true,
          feedback: true,
          team: { select: { name: true } },
          evaluator: { select: { username: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      prisma.evaluation.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: {
        evaluations: evaluations.map((e) => ({
          id: e.id,
          submissionId: e.submissionId,
          level: e.level,
          teamId: e.teamId,
          teamName: e.team.name,
          evaluatorId: e.evaluatorId,
          evaluatorUsername: e.evaluator.username,
          status: e.status,
          score: e.score,
          maxScore: e.maxScore,
          startedAt: e.startedAt ? e.startedAt.toISOString() : null,
          submittedAt: e.submittedAt ? e.submittedAt.toISOString() : null,
          updatedAt: e.updatedAt.toISOString(),
          feedback: e.feedback,
        })),
        total,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to query evaluations.',
    };
  }
}

// =========================================================================
// 7. ANNOUNCEMENTS & NOTIFICATIONS ENGINE
// =========================================================================

export async function getAdminAnnouncementsAction(): Promise<
  ActionResult<{ announcements: AdminAnnouncementItem[] }>
> {
  try {
    await requireAdminUser();

    // PERF-17-06: _count instead of loading every Notification row (one per
    // recipient, so ~210 rows per announcement) purely to read its length.
    const announcements = await prisma.announcement.findMany({
      include: {
        _count: { select: { notifications: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      success: true,
      data: {
        announcements: announcements.map((a) => ({
          id: a.id,
          title: a.title,
          content: a.content,
          category: a.category,
          priority: a.priority,
          targetAudience: a.targetAudience,
          levelNumber: a.levelNumber,
          createdBy: a.createdBy,
          published: a.published,
          publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
          createdAt: a.createdAt.toISOString(),
          notificationCount: a._count.notifications,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load announcements.',
    };
  }
}

export async function createAnnouncementAction(params: {
  title: string;
  content: string;
  category?: string;
  priority?: string;
  targetAudience?: string; // ALL, PARTICIPANTS, EVALUATORS, ADMINS, LEVEL_1, LEVEL_2, LEVEL_3
  levelNumber?: number | null;
  publishImmediately?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await requireAdminUser();

    if (!params.title?.trim()) {
      return { success: false, error: 'Announcement title is required.' };
    }

    if (!params.content?.trim()) {
      return { success: false, error: 'Announcement content is required.' };
    }

    const category = params.category || 'GENERAL';
    const priority = params.priority || 'NORMAL';
    const targetAudience = params.targetAudience || 'ALL';
    const publishImmediately = params.publishImmediately ?? true;
    const now = new Date();

    const announcement = await prisma.announcement.create({
      data: {
        title: params.title.trim(),
        content: params.content.trim(),
        category,
        priority,
        targetAudience,
        levelNumber: params.levelNumber ?? null,
        createdBy: `@${admin.username}`,
        published: publishImmediately,
        publishedAt: publishImmediately ? now : null,
      },
    });

    await prisma.auditLog
      .create({
        data: {
          actorId: admin.id,
          action: 'ANNOUNCEMENT_CREATED',
          details: `Admin @${admin.username} created announcement: "${announcement.title}" (Audience: ${targetAudience}).`,
        },
      })
      .catch(() => {});

    // If published immediately, generate notifications for eligible users
    if (publishImmediately) {
      await deliverAnnouncementNotifications(
        announcement.id,
        announcement.title,
        announcement.content,
        targetAudience,
      );

      await prisma.auditLog
        .create({
          data: {
            actorId: admin.id,
            action: 'ANNOUNCEMENT_PUBLISHED',
            details: `Admin @${admin.username} published announcement "${announcement.title}" to ${targetAudience}.`,
          },
        })
        .catch(() => {});
    }

    safeRevalidate('/admin/announcements', '/announcements', '/dashboard', '/evaluator');

    return {
      success: true,
      data: { id: announcement.id },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create announcement.',
    };
  }
}

/**
 * Dispatches Notification records to users matching the target audience.
 */
async function deliverAnnouncementNotifications(
  announcementId: string,
  title: string,
  message: string,
  targetAudience: string,
) {
  const userWhere: Record<string, unknown> = {
    status: 'ACTIVE',
  };

  if (targetAudience === 'PARTICIPANTS') {
    userWhere['role'] = 'PARTICIPANT';
  } else if (targetAudience === 'EVALUATORS') {
    userWhere['role'] = 'EVALUATOR';
  } else if (targetAudience === 'ADMINS') {
    userWhere['role'] = 'ADMIN';
  } else if (targetAudience.startsWith('LEVEL_')) {
    userWhere['role'] = 'PARTICIPANT';
    userWhere['membership'] = { isNot: null };
  }

  const eligibleUsers = await prisma.user.findMany({
    where: userWhere,
    select: { id: true },
  });

  if (eligibleUsers.length > 0) {
    await prisma.notification.createMany({
      data: eligibleUsers.map((u) => ({
        userId: u.id,
        announcementId,
        title,
        message,
        read: false,
      })),
    });
  }
}

export async function deleteAnnouncementAction(
  announcementId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await requireAdminUser();

    await prisma.announcement.delete({
      where: { id: announcementId },
    });

    await prisma.auditLog
      .create({
        data: {
          actorId: admin.id,
          action: 'ANNOUNCEMENT_DELETED',
          details: `Admin @${admin.username} deleted announcement ${announcementId}.`,
        },
      })
      .catch(() => {});

    safeRevalidate('/admin/announcements', '/announcements', '/dashboard');

    return { success: true, data: { id: announcementId } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete announcement.',
    };
  }
}

// =========================================================================
// 8. NOTIFICATION MANAGEMENT FOR USERS
// =========================================================================

export async function markNotificationAsReadAction(
  notificationId: string,
): Promise<ActionResult<{ success: boolean }>> {
  try {
    const user = await getSessionUser();
    if (!user) throw new Error('Authentication required.');

    await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: user.id,
      },
      data: { read: true },
    });

    return { success: true, data: { success: true } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to mark notification as read.',
    };
  }
}

export async function markAllNotificationsAsReadAction(): Promise<
  ActionResult<{ success: boolean }>
> {
  try {
    const user = await getSessionUser();
    if (!user) throw new Error('Authentication required.');

    await prisma.notification.updateMany({
      where: {
        userId: user.id,
        read: false,
      },
      data: { read: true },
    });

    return { success: true, data: { success: true } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to mark notifications as read.',
    };
  }
}

// =========================================================================
// 9. OPERATIONAL ACTIVITY AUDIT TRAIL
// =========================================================================

export async function getAdminActivityAction(params?: {
  query?: string;
  action?: string;
  role?: string;
}): Promise<ActionResult<{ logs: AdminActivityItem[]; total: number }>> {
  try {
    await requireAdminUser();

    const whereClause: Record<string, unknown> = {};

    if (params?.action && params.action !== 'ALL') {
      whereClause['action'] = params.action;
    }

    if (params?.role && params.role !== 'ALL') {
      whereClause['actor'] = { role: params.role };
    }

    if (params?.query?.trim()) {
      const q = params.query.trim().toLowerCase();
      whereClause['OR'] = [
        { action: { contains: q } },
        { details: { contains: q } },
        { actor: { username: { contains: q } } },
        { target: { username: { contains: q } } },
      ];
    }

    const logs = await prisma.auditLog.findMany({
      where: whereClause,
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
          },
        },
        target: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const total = await prisma.auditLog.count({ where: whereClause });

    return {
      success: true,
      data: {
        logs: logs.map((l) => ({
          id: l.id,
          actorId: l.actorId,
          actorUsername: l.actor?.username || null,
          actorEmail: l.actor?.email || null,
          actorRole: l.actor?.role || null,
          targetId: l.targetId,
          targetUsername: l.target?.username || null,
          action: l.action,
          details: l.details,
          createdAt: l.createdAt.toISOString(),
        })),
        total,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to query activity logs.',
    };
  }
}

// =========================================================================
// 10. EVENT PORTAL ONLINE / OFFLINE CONTROL
// =========================================================================

export async function toggleEventPortalStatusAction(
  isOnline: boolean,
): Promise<ActionResult<{ isOnline: boolean }>> {
  try {
    const admin = await requireAdminUser();

    const updated = await setPortalStatus(isOnline, admin.id);

    safeRevalidate('/admin', '/admin/event', '/dashboard', '/event', '/offline');

    return {
      success: true,
      data: { isOnline: updated.isOnline },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to toggle portal status.',
    };
  }
}
