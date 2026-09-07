'use server';

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { assertPermission, AuthorizationError } from '@/lib/auth/permissions';
import { safeRevalidate } from '@/lib/utils/revalidate';
import { ADMIN_WRITE_TX } from '@/lib/db/transaction';
import { isReportIssueType } from '@/lib/reports/constants';
import type { ActionResult } from './auth-actions';

/**
 * Admin → Creator issue reporting (Admin spec §5).
 *
 * The Admin observes participants and squads but does not act on them directly —
 * discipline and squad administration are Creator authority. This gives the Admin
 * a way to escalate an observation without granting Admin the Creator's powers,
 * and without letting the Admin impersonate the Creator.
 */

const MIN_DESCRIPTION_LENGTH = 15;
const MAX_DESCRIPTION_LENGTH = 2000;

export interface CreatorReportItem {
  id: string;
  issueType: string;
  description: string;
  status: string;
  createdAt: Date;
  authorUsername: string;
  teamId: string | null;
  teamName: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  resolvedByUsername: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}

function toActionError(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof AuthorizationError) {
    return { success: false, error: err.message };
  }
  console.error(fallback, err);
  return { success: false, error: fallback };
}

/**
 * Admin raises an issue about a squad or a participant for the Creator to action.
 */
export async function createCreatorReportAction(input: {
  teamId?: string | undefined;
  targetUserId?: string | undefined;
  issueType: string;
  description: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await getSessionUser();
    assertPermission(admin, 'REPORT_TO_CREATOR_SEND');

    if (!input.teamId && !input.targetUserId) {
      return {
        success: false,
        error: 'Select the squad or participant this report is about before sending it.',
      };
    }

    if (!isReportIssueType(input.issueType)) {
      return {
        success: false,
        error: 'Choose an issue type from the list so the Creator can triage the report.',
      };
    }

    const description = (input.description ?? '').trim();
    if (description.length < MIN_DESCRIPTION_LENGTH) {
      return {
        success: false,
        error:
          'Describe the issue in a little more detail so the Creator can act on it ' +
          `(at least ${MIN_DESCRIPTION_LENGTH} characters).`,
      };
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return {
        success: false,
        error: `Please keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`,
      };
    }

    // Verify the subject exists, so a manipulated id cannot create a dangling
    // report that points at nothing.
    if (input.teamId) {
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { id: true },
      });
      if (!team) {
        return { success: false, error: 'That squad no longer exists.' };
      }
    }
    if (input.targetUserId) {
      const user = await prisma.user.findUnique({
        where: { id: input.targetUserId },
        select: { id: true },
      });
      if (!user) {
        return { success: false, error: 'That participant account no longer exists.' };
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const report = await tx.creatorReport.create({
        data: {
          authorId: admin.id,
          teamId: input.teamId ?? null,
          targetUserId: input.targetUserId ?? null,
          issueType: input.issueType,
          description,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          targetId: input.targetUserId ?? null,
          action: 'CREATOR_REPORT_CREATED',
          details: `Admin @${admin.username} reported a ${input.issueType} issue to the Creator.`,
        },
      });

      return report;
    }, ADMIN_WRITE_TX);

    safeRevalidate('/admin/reports', '/creator/reports', '/creator');

    return { success: true, data: { id: created.id } };
  } catch (err) {
    return toActionError(err, 'Could not send the report. Nothing was saved — please try again.');
  }
}

/**
 * Lists reports. Creators see the inbox they must action; Admins see what they
 * and their colleagues have raised. Both are permission-gated.
 */
export async function listCreatorReportsAction(params?: {
  status?: string | undefined;
}): Promise<ActionResult<{ reports: CreatorReportItem[]; openCount: number }>> {
  try {
    const actor = await getSessionUser();

    // Either authority may read the list; only the Creator may resolve.
    const canView =
      actor && actor.status === 'ACTIVE' && (actor.role === 'CREATOR' || actor.role === 'ADMIN');

    if (!canView) {
      assertPermission(actor, 'REPORT_TO_CREATOR_VIEW');
    }

    const where: Record<string, unknown> = {};
    if (params?.status && params.status !== 'ALL') {
      where['status'] = params.status;
    }

    const [rows, openCount] = await Promise.all([
      prisma.creatorReport.findMany({
        where,
        select: {
          id: true,
          issueType: true,
          description: true,
          status: true,
          createdAt: true,
          teamId: true,
          targetUserId: true,
          resolvedAt: true,
          resolutionNote: true,
          resolvedById: true,
          author: { select: { username: true } },
          team: { select: { name: true } },
          targetUser: { select: { username: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      prisma.creatorReport.count({ where: { status: 'OPEN' } }),
    ]);

    const resolverIds = [...new Set(rows.map((r) => r.resolvedById).filter(Boolean))] as string[];
    const resolvers = resolverIds.length
      ? await prisma.user.findMany({
          where: { id: { in: resolverIds } },
          select: { id: true, username: true },
        })
      : [];
    const resolverName = new Map(resolvers.map((r) => [r.id, r.username]));

    return {
      success: true,
      data: {
        openCount,
        reports: rows.map((r) => ({
          id: r.id,
          issueType: r.issueType,
          description: r.description,
          status: r.status,
          createdAt: r.createdAt,
          authorUsername: r.author.username,
          teamId: r.teamId,
          teamName: r.team?.name ?? null,
          targetUserId: r.targetUserId,
          targetUsername: r.targetUser?.username ?? null,
          resolvedByUsername: r.resolvedById ? (resolverName.get(r.resolvedById) ?? null) : null,
          resolvedAt: r.resolvedAt,
          resolutionNote: r.resolutionNote,
        })),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load reports.');
  }
}

/**
 * Creator marks a report as acknowledged or resolved.
 * Reports are never deleted — the trail of what was raised and how it was handled
 * is part of the event record.
 */
export async function resolveCreatorReportAction(
  reportId: string,
  status: 'ACKNOWLEDGED' | 'RESOLVED',
  resolutionNote?: string,
): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    const creator = await getSessionUser();
    assertPermission(creator, 'REPORT_TO_CREATOR_VIEW');

    const report = await prisma.creatorReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });

    if (!report) {
      return { success: false, error: 'That report no longer exists.' };
    }

    if (report.status === 'RESOLVED') {
      return {
        success: false,
        error: 'This report has already been resolved.',
      };
    }

    const note = (resolutionNote ?? '').trim();

    await prisma.$transaction(async (tx) => {
      await tx.creatorReport.update({
        where: { id: reportId },
        data: {
          status,
          resolvedById: status === 'RESOLVED' ? creator.id : null,
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
          resolutionNote: note || null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          action: status === 'RESOLVED' ? 'CREATOR_REPORT_RESOLVED' : 'CREATOR_REPORT_ACKNOWLEDGED',
          details: `Creator @${creator.username} marked report ${reportId} as ${status}.`,
        },
      });
    }, ADMIN_WRITE_TX);

    safeRevalidate('/creator/reports', '/admin/reports', '/creator');

    return { success: true, data: { id: reportId, status } };
  } catch (err) {
    return toActionError(err, 'Could not update the report.');
  }
}
