'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import {
  getPortalStatus,
  setPortalStatus,
  type PortalStatusData,
} from '@/lib/event/portal-settings';
import type { ActionResult } from './auth-actions';
import { findTeamHead } from '@/lib/team/roles';

export interface PendingStaffUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  createdAt: Date;
}

export interface AuditLogItem {
  id: string;
  action: string;
  details: string | null;
  createdAt: Date;
  actor: { id: string; username: string; email: string; role?: string } | null;
  target: { id: string; username: string; email: string; role?: string } | null;
}

export interface CreatorOverviewStats {
  totalParticipants: number;
  totalEvaluators: number;
  totalAdmins: number;
  totalTeams: number;
  pendingStaffApprovals: number;
  activeAccounts: number;
  blockedAccounts: number;
  activeTeams: number;
  blockedTeams: number;
  activeSessions: number;
  portalStatus: PortalStatusData;
}

export interface AccountListItem {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  lastLogoutAt: Date | null;
  lastActivityAt: Date | null;
  loginCount: number;
  failedLoginCount: number;
  team: { id: string; name: string; role: string } | null;
  isOnline: boolean;
}

export interface AccountDetailData extends AccountListItem {
  recentActivity: AuditLogItem[];
  recentSubmissions: Array<{
    id: string;
    level: number;
    status: string;
    submittedAt: Date;
  }>;
}

export interface TeamListItem {
  id: string;
  name: string;
  head: { id: string; username: string; email: string } | null;
  memberCount: number;
  status: string;
  score: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamDetailData extends TeamListItem {
  members: Array<{
    id: string;
    userId: string;
    username: string;
    email: string;
    role: string;
    status: string;
    joinedAt: Date;
    lastActivityAt: Date | null;
    isOnline: boolean;
  }>;
  submissions: Array<{
    id: string;
    level: number;
    status: string;
    submittedAt: Date;
    answers?: string | null;
  }>;
}

export interface ActiveSessionItem {
  id: string;
  userId: string;
  username: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date | null;
}

/**
 * Internal helper to safely revalidate Next.js cache paths without crashing in unit test environments.
 */
function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Ignore when outside Next.js request context
  }
}

/**
 * Internal helper to enforce server-side Creator authorization.
 */
async function assertCreator() {
  const user = await getSessionUser();
  if (!user || user.role !== 'CREATOR' || user.status !== 'ACTIVE') {
    throw new Error('UNAUTHORIZED_CREATOR');
  }
  return user;
}

// ==========================================
// 1. OVERVIEW TELEMETRY
// ==========================================

export async function getCreatorOverviewStatsAction(): Promise<ActionResult<CreatorOverviewStats>> {
  try {
    await assertCreator();

    const now = new Date();

    const [
      totalParticipants,
      totalEvaluators,
      totalAdmins,
      totalTeams,
      pendingStaffApprovals,
      activeAccounts,
      blockedAccounts,
      activeTeams,
      blockedTeams,
      activeSessions,
      portalStatus,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'PARTICIPANT' } }),
      prisma.user.count({ where: { role: 'EVALUATOR' } }),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.team.count(),
      prisma.user.count({
        where: {
          status: 'PENDING_APPROVAL',
          role: { in: ['EVALUATOR', 'ADMIN'] },
        },
      }),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({
        where: { status: { in: ['BLOCKED', 'SUSPENDED', 'REJECTED'] } },
      }),
      prisma.team.count({ where: { status: 'ACTIVE' } }),
      prisma.team.count({ where: { status: { in: ['BLOCKED', 'DISQUALIFIED'] } } }),
      prisma.session.count({ where: { expiresAt: { gt: now } } }),
      getPortalStatus(),
    ]);

    return {
      success: true,
      data: {
        totalParticipants,
        totalEvaluators,
        totalAdmins,
        totalTeams,
        pendingStaffApprovals,
        activeAccounts,
        blockedAccounts,
        activeTeams,
        blockedTeams,
        activeSessions,
        portalStatus,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching creator overview:', err);
    return { success: false, error: 'Failed to fetch overview telemetry.' };
  }
}

// ==========================================
// 2. STAFF APPROVALS
// ==========================================

export async function getPendingStaffAction(): Promise<ActionResult<PendingStaffUser[]>> {
  try {
    await assertCreator();

    const pendingStaff = await prisma.user.findMany({
      where: {
        status: 'PENDING_APPROVAL',
        role: { in: ['EVALUATOR', 'ADMIN'] },
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: pendingStaff };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching pending staff:', err);
    return { success: false, error: 'Failed to retrieve pending staff list.' };
  }
}

export async function approveStaffAction(targetUserId: string): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: targetUserId, status: 'PENDING_APPROVAL' },
        data: { status: 'ACTIVE' },
      });

      if (updated.count === 0) {
        const existing = await tx.user.findUnique({ where: { id: targetUserId } });
        if (!existing) {
          throw new Error('TARGET_NOT_FOUND');
        }
        if (existing.status === 'ACTIVE') {
          throw new Error('ALREADY_ACTIVE');
        }
        throw new Error('NOT_PENDING');
      }

      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, email: true, username: true, role: true },
      });

      if (!targetUser) throw new Error('TARGET_NOT_FOUND');

      const roleLabel =
        targetUser.role === 'EVALUATOR'
          ? 'Evaluator'
          : targetUser.role === 'ADMIN'
            ? 'Administrator'
            : 'Staff';
      const portalLabel =
        targetUser.role === 'EVALUATOR'
          ? 'Evaluator Portal'
          : targetUser.role === 'ADMIN'
            ? 'Admin Portal'
            : 'Portal';

      // Create authoritative approval notification (Part 7)
      await tx.notification.create({
        data: {
          userId: targetUserId,
          title: 'Account Approved',
          message: `Your ${roleLabel} account has been approved. You can now access the ${portalLabel}.`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          targetId: targetUserId,
          action: 'STAFF_APPROVED',
          details: `Approved ${targetUser.role} clearance for ${targetUser.email} (@${targetUser.username})`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/approvals');
    safeRevalidate('/creator/accounts');
    safeRevalidate('/creator/audit-log');
    safeRevalidate('/evaluator');
    safeRevalidate('/admin');
    safeRevalidate('/auth/pending-approval');
    safeRevalidate('/auth/pending');
    return { success: true };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'UNAUTHORIZED_CREATOR') {
        return { success: false, error: 'Unauthorized. Creator privileges required.' };
      }
      if (err.message === 'TARGET_NOT_FOUND') {
        return { success: false, error: 'Target account not found.' };
      }
      if (err.message === 'ALREADY_ACTIVE') {
        return { success: false, error: 'Account is already active and approved.' };
      }
      if (err.message === 'NOT_PENDING') {
        return { success: false, error: 'Account is not in a pending approval state.' };
      }
    }
    console.error('Error approving staff:', err);
    return { success: false, error: 'Failed to approve staff account.' };
  }
}

export async function rejectStaffAction(
  targetUserId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: targetUserId, status: 'PENDING_APPROVAL' },
        data: { status: 'REJECTED' },
      });

      if (updated.count === 0) {
        const existing = await tx.user.findUnique({ where: { id: targetUserId } });
        if (!existing) {
          throw new Error('TARGET_NOT_FOUND');
        }
        throw new Error('NOT_PENDING');
      }

      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, email: true, username: true, role: true },
      });

      if (!targetUser) throw new Error('TARGET_NOT_FOUND');

      // Revoke any active sessions for rejected user immediately
      await tx.session.deleteMany({
        where: { userId: targetUserId },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          targetId: targetUserId,
          action: 'STAFF_REJECTED',
          details: `Rejected ${targetUser.role} clearance for ${targetUser.email} (@${targetUser.username}). ${
            reason ? `Reason: ${reason}` : ''
          }`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/approvals');
    safeRevalidate('/creator/accounts');
    safeRevalidate('/creator/audit-log');
    safeRevalidate('/auth/pending-approval');
    safeRevalidate('/auth/pending');
    return { success: true };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'UNAUTHORIZED_CREATOR') {
        return { success: false, error: 'Unauthorized. Creator privileges required.' };
      }
      if (err.message === 'TARGET_NOT_FOUND') {
        return { success: false, error: 'Target account not found.' };
      }
      if (err.message === 'NOT_PENDING') {
        return { success: false, error: 'Account is not in a pending approval state.' };
      }
    }
    console.error('Error rejecting staff:', err);
    return { success: false, error: 'Failed to reject staff account.' };
  }
}

// ==========================================
// 3. ACCOUNTS GOVERNANCE
// ==========================================

export async function getAccountsAction(params?: {
  page?: number;
  limit?: number;
  search?: string | undefined;
  role?: string | undefined;
  status?: string | undefined;
}): Promise<
  ActionResult<{
    accounts: AccountListItem[];
    total: number;
    page: number;
    totalPages: number;
  }>
> {
  try {
    await assertCreator();

    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(100, Math.max(1, params?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (params?.role && params.role !== 'ALL') {
      where['role'] = params.role;
    }

    if (params?.status && params.status !== 'ALL') {
      where['status'] = params.status;
    }

    if (params?.search && params.search.trim().length > 0) {
      const search = params.search.trim().toLowerCase();
      where['OR'] = [
        { email: { contains: search } },
        { username: { contains: search } },
        { membership: { team: { name: { contains: search } } } },
      ];
    }

    const [total, rawAccounts] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          lastLogoutAt: true,
          lastActivityAt: true,
          loginCount: true,
          failedLoginCount: true,
          membership: {
            select: {
              role: true,
              team: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          sessions: {
            where: { expiresAt: { gt: new Date() } },
            select: { id: true },
            take: 1,
          },
        },
      }),
    ]);

    const accounts: AccountListItem[] = rawAccounts.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      lastLogoutAt: u.lastLogoutAt,
      lastActivityAt: u.lastActivityAt,
      loginCount: u.loginCount,
      failedLoginCount: u.failedLoginCount,
      team: u.membership
        ? {
            id: u.membership.team.id,
            name: u.membership.team.name,
            role: u.membership.role,
          }
        : null,
      isOnline: u.sessions.length > 0 && u.status === 'ACTIVE',
    }));

    return {
      success: true,
      data: {
        accounts,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching accounts:', err);
    return { success: false, error: 'Failed to retrieve accounts list.' };
  }
}

export async function getAccountDetailsAction(
  targetUserId: string,
): Promise<ActionResult<AccountDetailData>> {
  try {
    await assertCreator();

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        lastLogoutAt: true,
        lastActivityAt: true,
        loginCount: true,
        failedLoginCount: true,
        membership: {
          select: {
            role: true,
            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        sessions: {
          where: { expiresAt: { gt: new Date() } },
          select: { id: true },
          take: 1,
        },
        submissions: {
          select: {
            id: true,
            level: true,
            status: true,
            submittedAt: true,
          },
          orderBy: { submittedAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!user) {
      return { success: false, error: 'User account not found.' };
    }

    const recentActivity = await prisma.auditLog.findMany({
      where: {
        OR: [{ targetId: targetUserId }, { actorId: targetUserId }],
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, username: true, email: true, role: true } },
        target: { select: { id: true, username: true, email: true, role: true } },
      },
    });

    return {
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        lastLogoutAt: user.lastLogoutAt,
        lastActivityAt: user.lastActivityAt,
        loginCount: user.loginCount,
        failedLoginCount: user.failedLoginCount,
        team: user.membership
          ? {
              id: user.membership.team.id,
              name: user.membership.team.name,
              role: user.membership.role,
            }
          : null,
        isOnline: user.sessions.length > 0 && user.status === 'ACTIVE',
        recentActivity: recentActivity.map((log) => ({
          id: log.id,
          action: log.action,
          details: log.details,
          createdAt: log.createdAt,
          actor: log.actor
            ? {
                id: log.actor.id,
                username: log.actor.username,
                email: log.actor.email,
                role: log.actor.role,
              }
            : null,
          target: log.target
            ? {
                id: log.target.id,
                username: log.target.username,
                email: log.target.email,
                role: log.target.role,
              }
            : null,
        })),
        recentSubmissions: user.submissions,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching account details:', err);
    return { success: false, error: 'Failed to retrieve account details.' };
  }
}

export async function blockAccountAction(
  targetUserId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    if (creator.id === targetUserId) {
      return { success: false, error: 'Cannot block your own Creator account.' };
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return { success: false, error: 'Account not found.' };
    }

    await prisma.$transaction(async (tx) => {
      // 1. Update user status to BLOCKED
      await tx.user.update({
        where: { id: targetUserId },
        data: { status: 'BLOCKED' },
      });

      // 2. Invalidate all active sessions immediately
      await tx.session.deleteMany({
        where: { userId: targetUserId },
      });

      // 3. Record audit log
      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          targetId: targetUserId,
          action: 'ACCOUNT_BLOCKED',
          details: `Blocked account ${targetUser.email} (@${targetUser.username}). Role: ${
            targetUser.role
          }.${reason ? ` Reason: ${reason}` : ''}`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/accounts');
    safeRevalidate('/creator/activity');
    safeRevalidate('/creator/audit-log');
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error blocking account:', err);
    return { success: false, error: 'Failed to block account.' };
  }
}

export async function unblockAccountAction(targetUserId: string): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return { success: false, error: 'Account not found.' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { status: 'ACTIVE' },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          targetId: targetUserId,
          action: 'ACCOUNT_UNBLOCKED',
          details: `Unblocked account ${targetUser.email} (@${targetUser.username}). Status restored to ACTIVE.`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/accounts');
    safeRevalidate('/creator/activity');
    safeRevalidate('/creator/audit-log');
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error unblocking account:', err);
    return { success: false, error: 'Failed to unblock account.' };
  }
}

export async function deleteAccountAction(targetUserId: string): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    if (creator.id === targetUserId) {
      return { success: false, error: 'Cannot delete your own Creator account.' };
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        membership: true,
      },
    });

    if (!targetUser) {
      return { success: false, error: 'Account not found.' };
    }

    await prisma.$transaction(async (tx) => {
      // 1. If user is in a team as head, handle membership deletion
      if (targetUser.membership) {
        await tx.teamMember.delete({
          where: { userId: targetUserId },
        });
      }

      // 2. Delete sessions
      await tx.session.deleteMany({
        where: { userId: targetUserId },
      });

      // 3. Delete user
      await tx.user.delete({
        where: { id: targetUserId },
      });

      // 4. Create Audit Log with target metadata snapshot
      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          action: 'ACCOUNT_DELETED',
          details: `Permanently deleted account ${targetUser.email} (@${targetUser.username}, role: ${targetUser.role}). User may re-register if needed.`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/accounts');
    safeRevalidate('/creator/teams');
    safeRevalidate('/creator/activity');
    safeRevalidate('/creator/audit-log');
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error deleting account:', err);
    return { success: false, error: 'Failed to delete account.' };
  }
}

// ==========================================
// 4. TEAM REGISTRY & MANAGEMENT
// ==========================================

export async function getTeamsAction(params?: {
  page?: number;
  limit?: number;
  search?: string | undefined;
  status?: string | undefined;
}): Promise<
  ActionResult<{
    teams: TeamListItem[];
    total: number;
    page: number;
    totalPages: number;
  }>
> {
  try {
    await assertCreator();

    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(100, Math.max(1, params?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (params?.status && params.status !== 'ALL') {
      where['status'] = params.status;
    }

    if (params?.search && params.search.trim().length > 0) {
      const search = params.search.trim();
      where['name'] = { contains: search };
    }

    const [total, rawTeams] = await Promise.all([
      prisma.team.count({ where }),
      prisma.team.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          score: true,
          createdAt: true,
          updatedAt: true,
          members: {
            select: {
              role: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ]);

    // Note: Team join code is STRICTLY omitted
    const teams: TeamListItem[] = rawTeams.map((t) => {
      const headMember = findTeamHead(t.members);
      const head = headMember ? headMember.user : t.members[0]?.user || null;

      return {
        id: t.id,
        name: t.name,
        head,
        memberCount: t.members.length,
        status: t.status,
        score: t.score,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    });

    return {
      success: true,
      data: {
        teams,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching teams:', err);
    return { success: false, error: 'Failed to retrieve teams list.' };
  }
}

export async function getTeamDetailsAction(teamId: string): Promise<ActionResult<TeamDetailData>> {
  try {
    await assertCreator();

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        status: true,
        score: true,
        createdAt: true,
        updatedAt: true,
        members: {
          select: {
            id: true,
            userId: true,
            role: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                status: true,
                lastActivityAt: true,
                sessions: {
                  where: { expiresAt: { gt: new Date() } },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
        submissions: {
          select: {
            id: true,
            level: true,
            status: true,
            submittedAt: true,
            answers: true,
          },
          orderBy: { submittedAt: 'desc' },
        },
      },
    });

    if (!team) {
      return { success: false, error: 'Team not found.' };
    }

    const headMember = findTeamHead(team.members);
    const head = headMember ? headMember.user : team.members[0]?.user || null;

    const members = team.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      username: m.user.username,
      email: m.user.email,
      role: m.role,
      status: m.user.status,
      joinedAt: m.joinedAt,
      lastActivityAt: m.user.lastActivityAt,
      isOnline: m.user.sessions.length > 0 && m.user.status === 'ACTIVE',
    }));

    // Note: team join code is STRICTLY omitted
    return {
      success: true,
      data: {
        id: team.id,
        name: team.name,
        head,
        memberCount: team.members.length,
        status: team.status,
        score: team.score,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        members,
        submissions: team.submissions,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching team details:', err);
    return { success: false, error: 'Failed to retrieve team details.' };
  }
}

export async function blockTeamAction(teamId: string, reason?: string): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    const team = await prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      return { success: false, error: 'Team not found.' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: teamId },
        data: { status: 'BLOCKED' },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          action: 'TEAM_BLOCKED',
          details: `Blocked squad "${team.name}" (ID: ${team.id}). Squad operations locked.${
            reason ? ` Reason: ${reason}` : ''
          }`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/teams');
    safeRevalidate('/creator/audit-log');
    safeRevalidate('/dashboard');
    safeRevalidate('/team');
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error blocking team:', err);
    return { success: false, error: 'Failed to block team.' };
  }
}

export async function unblockTeamAction(teamId: string): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    const team = await prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      return { success: false, error: 'Team not found.' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: teamId },
        data: { status: 'ACTIVE' },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          action: 'TEAM_UNBLOCKED',
          details: `Unblocked squad "${team.name}" (ID: ${team.id}). Status restored to ACTIVE.`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/teams');
    safeRevalidate('/creator/audit-log');
    safeRevalidate('/dashboard');
    safeRevalidate('/team');
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error unblocking team:', err);
    return { success: false, error: 'Failed to unblock team.' };
  }
}

export async function deleteTeamAction(teamId: string): Promise<ActionResult> {
  try {
    const creator = await assertCreator();

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: { select: { username: true, email: true } },
          },
        },
      },
    });

    if (!team) {
      return { success: false, error: 'Team not found.' };
    }

    await prisma.$transaction(async (tx) => {
      // 1. Delete all team memberships (participants are unassigned, not deleted!)
      await tx.teamMember.deleteMany({
        where: { teamId },
      });

      // 2. Delete team
      await tx.team.delete({
        where: { id: teamId },
      });

      // 3. Create audit record with team snapshot
      const memberUsernames = team.members.map((m) => `@${m.user.username}`).join(', ');
      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          action: 'TEAM_DELETED',
          details: `Deleted squad "${team.name}". Member participants (${
            memberUsernames || 'none'
          }) were unassigned and can join or form new teams.`,
        },
      });
    });

    safeRevalidate('/creator');
    safeRevalidate('/creator/teams');
    safeRevalidate('/creator/accounts');
    safeRevalidate('/creator/audit-log');
    safeRevalidate('/dashboard');
    safeRevalidate('/team');
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error deleting team:', err);
    return { success: false, error: 'Failed to delete team.' };
  }
}

// ==========================================
// 5. ACTIVITY, SESSIONS & AUDIT LOGS
// ==========================================

export async function getActivityLogsAction(params?: {
  page?: number;
  limit?: number;
  search?: string | undefined;
  action?: string | undefined;
  userId?: string | undefined;
}): Promise<
  ActionResult<{
    logs: AuditLogItem[];
    total: number;
    page: number;
    totalPages: number;
  }>
> {
  try {
    await assertCreator();

    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(100, Math.max(1, params?.limit || 25));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (params?.action && params.action !== 'ALL') {
      where['action'] = params.action;
    }

    // BUG-17-06: the account filter and the text search both wrote to `where.OR`,
    // so supplying a search term silently DISCARDED the account filter and the
    // Creator was shown matches from every account while the UI still displayed
    // the account filter as active. Combining them under `AND` makes the two
    // filters intersect, which is what the console presents them as doing.
    const conditions: Record<string, unknown>[] = [];

    if (params?.userId) {
      conditions.push({
        OR: [{ actorId: params.userId }, { targetId: params.userId }],
      });
    }

    if (params?.search && params.search.trim().length > 0) {
      const search = params.search.trim();
      conditions.push({
        OR: [
          { details: { contains: search } },
          { action: { contains: search } },
          { actor: { username: { contains: search } } },
          { actor: { email: { contains: search } } },
          { target: { username: { contains: search } } },
          { target: { email: { contains: search } } },
        ],
      });
    }

    if (conditions.length > 0) {
      where['AND'] = conditions;
    }

    const [total, rawLogs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, username: true, email: true, role: true } },
          target: { select: { id: true, username: true, email: true, role: true } },
        },
      }),
    ]);

    const logs: AuditLogItem[] = rawLogs.map((l) => ({
      id: l.id,
      action: l.action,
      details: l.details,
      createdAt: l.createdAt,
      actor: l.actor,
      target: l.target,
    }));

    return {
      success: true,
      data: {
        logs,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching activity logs:', err);
    return { success: false, error: 'Failed to retrieve activity logs.' };
  }
}

export async function getActiveSessionsAction(): Promise<ActionResult<ActiveSessionItem[]>> {
  try {
    await assertCreator();

    const now = new Date();
    const sessions = await prisma.session.findMany({
      where: {
        expiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        user: {
          select: {
            username: true,
            email: true,
            role: true,
            status: true,
            lastActivityAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const activeSessions: ActiveSessionItem[] = sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      username: s.user.username,
      email: s.user.email,
      role: s.user.role,
      status: s.user.status,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      lastActivityAt: s.user.lastActivityAt,
    }));

    return { success: true, data: activeSessions };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching active sessions:', err);
    return { success: false, error: 'Failed to retrieve active sessions.' };
  }
}

export async function getRecentAuditLogsAction(): Promise<ActionResult<AuditLogItem[]>> {
  try {
    await assertCreator();

    const logs = await prisma.auditLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, username: true, email: true, role: true } },
        target: { select: { id: true, username: true, email: true, role: true } },
      },
    });

    return {
      success: true,
      data: logs.map((l) => ({
        id: l.id,
        action: l.action,
        details: l.details,
        createdAt: l.createdAt,
        actor: l.actor,
        target: l.target,
      })),
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching audit logs:', err);
    return { success: false, error: 'Failed to fetch audit logs.' };
  }
}

// ==========================================
// 6. PORTAL STATUS CONTROL
// ==========================================

export async function getPortalStatusAction(): Promise<ActionResult<PortalStatusData>> {
  try {
    await assertCreator();
    const status = await getPortalStatus();
    return { success: true, data: status };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error fetching portal status:', err);
    return { success: false, error: 'Failed to fetch portal status.' };
  }
}

export async function setPortalStatusAction(
  isOnline: boolean,
): Promise<ActionResult<PortalStatusData>> {
  try {
    const creator = await assertCreator();
    const status = await setPortalStatus(isOnline, creator.id);
    return { success: true, data: status };
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED_CREATOR') {
      return { success: false, error: 'Unauthorized. Creator privileges required.' };
    }
    console.error('Error setting portal status:', err);
    return { success: false, error: 'Failed to update portal status.' };
  }
}
