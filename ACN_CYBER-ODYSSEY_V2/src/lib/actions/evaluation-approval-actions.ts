'use server';

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { safeRevalidate } from '@/lib/utils/revalidate';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import { assertPermission, canApproveEvaluation, AuthorizationError } from '@/lib/auth/permissions';
import {
  APPROVAL_STATUS,
  canTransition,
  transitionRefusalReason,
  recomputeTeamScore,
  approvalStatusLabel,
} from '@/lib/evaluation/approval';
import type { ActionResult } from './auth-actions';

/**
 * Admin evaluation approval workflow (Admin spec §9–§14).
 *
 *   Evaluator submits → PENDING_APPROVAL → Admin APPROVES → leaderboard
 *                                        → Admin REJECTS  → back for correction
 *
 * Approval is the ONLY route by which a score reaches the official leaderboard.
 * Both actions recompute `Team.score` inside the same transaction as the status
 * change, so the standings and the approval state can never disagree.
 *
 * Kept in its own module rather than added to admin-actions.ts because this is a
 * distinct authority — the approval gate — and separating it keeps the audit of
 * "who can publish a score" to one short file.
 */

export interface EvaluationApprovalResult {
  evaluationId: string;
  approvalStatus: string;
  teamScore: number;
}

export interface AdminEvaluationQueueItem {
  id: string;
  submissionId: string;
  teamId: string;
  teamName: string;
  level: number;
  evaluatorId: string;
  evaluatorUsername: string;
  score: number;
  maxScore: number;
  approvalStatus: string;
  approvalStatusLabel: string;
  evaluationStatus: string;
  feedback: string | null;
  notes: string | null;
  submittedAt: Date | null;
  approvedByUsername: string | null;
  approvedAt: Date | null;
  rejectedByUsername: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  files: Array<{
    id: string;
    fileName: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
  }>;
  /** False when the viewing Admin authored the evaluation (cannot self-approve). */
  canDecide: boolean;
}

/** Resolves the acting Admin, or throws an AuthorizationError with a safe message. */
async function requireApprovalAuthority() {
  const user = await getSessionUser();
  assertPermission(user, 'EVALUATION_VIEW_ALL');
  return user;
}

function toActionError(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof AuthorizationError) {
    return { success: false, error: err.message };
  }
  console.error(fallback, err);
  return { success: false, error: fallback };
}

/**
 * Lists evaluations for the Admin approval console, optionally filtered by
 * approval state. Shows the full Evaluator → Team → Level → Score → Status chain
 * the Admin specification requires (§13).
 */
export async function getEvaluationQueueAction(params?: {
  approvalStatus?: string | undefined;
  level?: number | undefined;
  search?: string | undefined;
}): Promise<ActionResult<{ evaluations: AdminEvaluationQueueItem[]; total: number }>> {
  try {
    const admin = await requireApprovalAuthority();

    const where: Record<string, unknown> = {};
    if (params?.approvalStatus && params.approvalStatus !== 'ALL') {
      where['approvalStatus'] = params.approvalStatus;
    }
    if (params?.level && params.level > 0) {
      where['level'] = params.level;
    }
    if (params?.search?.trim()) {
      const q = params.search.trim();
      where['OR'] = [
        { team: { name: { contains: q } } },
        { evaluator: { username: { contains: q } } },
      ];
    }

    // PRIVACY: explicit selects only — no password hashes, no squad join codes.
    const [rows, total] = await Promise.all([
      prisma.evaluation.findMany({
        where,
        select: {
          id: true,
          submissionId: true,
          teamId: true,
          level: true,
          evaluatorId: true,
          score: true,
          maxScore: true,
          status: true,
          approvalStatus: true,
          feedback: true,
          notes: true,
          submittedAt: true,
          approvedAt: true,
          rejectedAt: true,
          rejectionReason: true,
          team: { select: { name: true } },
          evaluator: { select: { username: true } },
          submission: {
            select: {
              files: {
                select: {
                  id: true,
                  fileName: true,
                  originalName: true,
                  fileSize: true,
                  mimeType: true,
                },
              },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
        take: 200,
      }),
      prisma.evaluation.count({ where }),
    ]);

    // Resolve approver/rejecter usernames in ONE query rather than per row.
    const decisionIds = new Set<string>();
    const raw = await prisma.evaluation.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, approvedById: true, rejectedById: true },
    });
    for (const r of raw) {
      if (r.approvedById) decisionIds.add(r.approvedById);
      if (r.rejectedById) decisionIds.add(r.rejectedById);
    }
    const deciders = decisionIds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...decisionIds] } },
          select: { id: true, username: true },
        })
      : [];
    const deciderName = new Map(deciders.map((d) => [d.id, d.username]));
    const decisionById = new Map(raw.map((r) => [r.id, r]));

    return {
      success: true,
      data: {
        total,
        evaluations: rows.map((e) => {
          const decision = decisionById.get(e.id);
          return {
            id: e.id,
            submissionId: e.submissionId,
            teamId: e.teamId,
            teamName: e.team.name,
            level: e.level,
            evaluatorId: e.evaluatorId,
            evaluatorUsername: e.evaluator.username,
            score: e.score,
            maxScore: e.maxScore,
            approvalStatus: e.approvalStatus,
            approvalStatusLabel: approvalStatusLabel(e.approvalStatus),
            evaluationStatus: e.status,
            feedback: e.feedback,
            notes: e.notes,
            submittedAt: e.submittedAt,
            approvedByUsername: decision?.approvedById
              ? (deciderName.get(decision.approvedById) ?? null)
              : null,
            approvedAt: e.approvedAt,
            rejectedByUsername: decision?.rejectedById
              ? (deciderName.get(decision.rejectedById) ?? null)
              : null,
            rejectedAt: e.rejectedAt,
            rejectionReason: e.rejectionReason,
            files: e.submission?.files ?? [],
            // Separation of duties, surfaced to the UI so the button can be
            // disabled — but the server check below is the real boundary.
            canDecide: e.evaluatorId !== admin.id,
          };
        }),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load the evaluation queue.');
  }
}

/**
 * Approves an evaluation, publishing its score to the official leaderboard.
 */
export async function approveEvaluationAction(
  evaluationId: string,
): Promise<ActionResult<EvaluationApprovalResult>> {
  try {
    const admin = await requireApprovalAuthority();

    const evaluation = await prisma.evaluation.findUnique({
      where: { id: evaluationId },
      select: {
        id: true,
        teamId: true,
        level: true,
        score: true,
        evaluatorId: true,
        approvalStatus: true,
        team: { select: { name: true } },
        evaluator: { select: { username: true } },
      },
    });

    if (!evaluation) {
      return {
        success: false,
        error: 'That evaluation no longer exists. Refresh the queue and try again.',
      };
    }

    // ROLE + ACTION + SCOPE, plus separation of duties: an evaluator who also
    // holds Admin rights still may not approve their own scoring.
    const decision = canApproveEvaluation(admin, {
      evaluatorId: evaluation.evaluatorId,
      level: evaluation.level,
    });
    if (!decision.allowed) {
      return { success: false, error: decision.reason ?? 'Not authorized.' };
    }

    if (!canTransition(evaluation.approvalStatus, APPROVAL_STATUS.APPROVED)) {
      return {
        success: false,
        error: transitionRefusalReason(evaluation.approvalStatus, APPROVAL_STATUS.APPROVED),
      };
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Conditional update: the current approval state is part of the WHERE
      // clause, so two Admins deciding the same evaluation simultaneously cannot
      // both succeed — the loser matches zero rows.
      const updated = await tx.evaluation.updateMany({
        where: { id: evaluationId, approvalStatus: evaluation.approvalStatus },
        data: {
          approvalStatus: APPROVAL_STATUS.APPROVED,
          approvedById: admin.id,
          approvedAt: now,
          rejectedById: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      });

      if (updated.count === 0) {
        throw new Error('APPROVAL_CONFLICT');
      }

      // Publish: recompute from APPROVED evaluations, in the same transaction.
      const teamScore = await recomputeTeamScore(tx, evaluation.teamId);

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'EVALUATION_APPROVED',
          details:
            `Admin @${admin.username} approved Level ${evaluation.level} evaluation by ` +
            `@${evaluation.evaluator.username} for squad "${evaluation.team.name}": ` +
            `${evaluation.score} points. Squad total is now ${teamScore}.`,
        },
      });

      return teamScore;
    }, CRITICAL_WRITE_TX);

    safeRevalidate(
      '/admin',
      '/admin/evaluations',
      '/evaluator',
      '/evaluator/evaluations',
      '/leaderboard',
      '/dashboard',
    );

    return {
      success: true,
      data: {
        evaluationId,
        approvalStatus: APPROVAL_STATUS.APPROVED,
        teamScore: result,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'APPROVAL_CONFLICT') {
      return {
        success: false,
        error:
          'Another administrator decided this evaluation moments before you did. ' +
          'Refresh the queue to see the current decision.',
      };
    }
    return toActionError(err, 'Failed to approve the evaluation.');
  }
}

/** Minimum characters required for a rejection reason to be useful to the evaluator. */
const MIN_REJECTION_REASON_LENGTH = 10;

/**
 * Rejects an evaluation and returns it to the evaluator for correction.
 * The record is never deleted — history is preserved (Admin spec §12).
 */
export async function rejectEvaluationAction(
  evaluationId: string,
  reason: string,
): Promise<ActionResult<EvaluationApprovalResult>> {
  try {
    const admin = await requireApprovalAuthority();

    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < MIN_REJECTION_REASON_LENGTH) {
      return {
        success: false,
        error:
          'A rejection reason is required, and it needs to be specific enough for the evaluator to act on ' +
          `(at least ${MIN_REJECTION_REASON_LENGTH} characters). Explain what needs correcting.`,
      };
    }

    const evaluation = await prisma.evaluation.findUnique({
      where: { id: evaluationId },
      select: {
        id: true,
        teamId: true,
        level: true,
        score: true,
        evaluatorId: true,
        approvalStatus: true,
        team: { select: { name: true } },
        evaluator: { select: { username: true } },
      },
    });

    if (!evaluation) {
      return {
        success: false,
        error: 'That evaluation no longer exists. Refresh the queue and try again.',
      };
    }

    const decision = canApproveEvaluation(admin, {
      evaluatorId: evaluation.evaluatorId,
      level: evaluation.level,
    });
    if (!decision.allowed) {
      return { success: false, error: decision.reason ?? 'Not authorized.' };
    }

    if (!canTransition(evaluation.approvalStatus, APPROVAL_STATUS.REJECTED)) {
      return {
        success: false,
        error: transitionRefusalReason(evaluation.approvalStatus, APPROVAL_STATUS.REJECTED),
      };
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.evaluation.updateMany({
        where: { id: evaluationId, approvalStatus: evaluation.approvalStatus },
        data: {
          approvalStatus: APPROVAL_STATUS.REJECTED,
          rejectedById: admin.id,
          rejectedAt: now,
          rejectionReason: trimmedReason,
          approvedById: null,
          approvedAt: null,
        },
      });

      if (updated.count === 0) {
        throw new Error('APPROVAL_CONFLICT');
      }

      // Withdraw the score if this evaluation had previously been counted.
      const teamScore = await recomputeTeamScore(tx, evaluation.teamId);

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'EVALUATION_REJECTED',
          details:
            `Admin @${admin.username} rejected Level ${evaluation.level} evaluation by ` +
            `@${evaluation.evaluator.username} for squad "${evaluation.team.name}". ` +
            `Returned for correction. Squad total is now ${teamScore}.`,
        },
      });

      return teamScore;
    }, CRITICAL_WRITE_TX);

    safeRevalidate(
      '/admin',
      '/admin/evaluations',
      '/evaluator',
      '/evaluator/evaluations',
      '/leaderboard',
      '/dashboard',
    );

    return {
      success: true,
      data: {
        evaluationId,
        approvalStatus: APPROVAL_STATUS.REJECTED,
        teamScore: result,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'APPROVAL_CONFLICT') {
      return {
        success: false,
        error:
          'Another administrator decided this evaluation moments before you did. ' +
          'Refresh the queue to see the current decision.',
      };
    }
    return toActionError(err, 'Failed to reject the evaluation.');
  }
}
