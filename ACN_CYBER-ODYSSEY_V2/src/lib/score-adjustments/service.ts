import 'server-only';
import { prisma } from '@/lib/prisma';
import { recomputeTeamScore } from '@/lib/evaluation/approval';
import {
  SCORE_ADJUSTMENT_STATUS,
  type ScoreAdjustmentStatus,
  type ScoreAdjustmentDTO,
  type RequestScoreAdjustmentInput,
  requestScoreAdjustmentSchema,
} from './types';

/**
 * Service: Evaluator requests an additional points adjustment for a squad.
 * Requires evaluator role. Status starts PENDING. Requires admin approval.
 */
export async function createScoreAdjustmentRequest(
  input: RequestScoreAdjustmentInput,
  requestedByUser: { id: string; username: string },
): Promise<ScoreAdjustmentDTO> {
  // Validate input
  const validated = requestScoreAdjustmentSchema.parse(input);

  return await prisma.$transaction(async (tx) => {
    // Verify target team exists
    const team = await tx.team.findUnique({
      where: { id: validated.teamId },
      select: { id: true, name: true, status: true },
    });

    if (!team) {
      throw new Error('Squad not found.');
    }

    // Idempotency: avoid duplicate rapid clicks within 10 seconds with identical parameters
    const duplicate = await tx.scoreAdjustment.findFirst({
      where: {
        teamId: validated.teamId,
        level: validated.level,
        points: validated.points,
        requestedByUserId: requestedByUser.id,
        status: SCORE_ADJUSTMENT_STATUS.PENDING,
        createdAt: { gte: new Date(Date.now() - 10_000) },
      },
      include: {
        team: { select: { name: true } },
        requestedBy: { select: { username: true } },
        reviewedBy: { select: { username: true } },
      },
    });

    if (duplicate) {
      return formatScoreAdjustmentDTO(duplicate);
    }

    // Create the pending score adjustment
    const created = await tx.scoreAdjustment.create({
      data: {
        teamId: validated.teamId,
        level: validated.level,
        points: validated.points,
        reason: validated.reason.trim(),
        evidenceNote: validated.evidenceNote?.trim() || null,
        status: SCORE_ADJUSTMENT_STATUS.PENDING,
        requestedByUserId: requestedByUser.id,
      },
      include: {
        team: { select: { name: true } },
        requestedBy: { select: { username: true } },
        reviewedBy: { select: { username: true } },
      },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        actorId: requestedByUser.id,
        targetId: requestedByUser.id,
        action: 'SCORE_ADJUSTMENT_REQUESTED',
        details: `Evaluator @${requestedByUser.username} requested +${validated.points} PTS adjustment for Squad "${team.name}" (ID: ${team.id}) on Level ${validated.level}. Reason: ${validated.reason.trim()}`,
      },
    });

    // Notify administrators
    const admins = await tx.user.findMany({
      where: { role: { in: ['ADMIN', 'CREATOR'] }, status: 'ACTIVE' },
      select: { id: true },
    });

    if (admins.length > 0) {
      await tx.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          title: 'Score Adjustment Requested',
          message: `New Level ${validated.level} score adjustment request (+${validated.points} PTS) for "${team.name}" by @${requestedByUser.username}.`,
          read: false,
        })),
      });
    }

    return formatScoreAdjustmentDTO(created);
  });
}

/**
 * Service: Admin atomically approves a pending score adjustment.
 * Concurrency protected via conditional update.
 */
export async function approveScoreAdjustment(
  adjustmentId: string,
  reviewer: { id: string; username: string },
): Promise<ScoreAdjustmentDTO> {
  return await prisma.$transaction(async (tx) => {
    const adjustment = await tx.scoreAdjustment.findUnique({
      where: { id: adjustmentId },
      include: {
        team: { select: { name: true } },
        requestedBy: { select: { username: true } },
      },
    });

    if (!adjustment) {
      throw new Error('Score adjustment request not found.');
    }

    if (adjustment.status === SCORE_ADJUSTMENT_STATUS.APPROVED) {
      throw new Error('This adjustment has already been approved.');
    }

    if (adjustment.status === SCORE_ADJUSTMENT_STATUS.REJECTED) {
      throw new Error('This adjustment was already rejected.');
    }

    // Atomic conditional update ensuring only one concurrent approval can succeed
    const updateResult = await tx.scoreAdjustment.updateMany({
      where: {
        id: adjustmentId,
        status: SCORE_ADJUSTMENT_STATUS.PENDING,
      },
      data: {
        status: SCORE_ADJUSTMENT_STATUS.APPROVED,
        reviewedByUserId: reviewer.id,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
    });

    if (updateResult.count === 0) {
      throw new Error('This score adjustment was already processed by another administrator.');
    }

    // An approved adjustment is part of the squad's official total, so the
    // stored aggregate has to move with it — in this transaction, not on the
    // next unrelated recompute. Without this the leaderboard credited the
    // adjustment (it reads from source) while the participant dashboard, which
    // reads Team.score, did not.
    await recomputeTeamScore(tx, adjustment.teamId);

    // Audit log
    await tx.auditLog.create({
      data: {
        actorId: reviewer.id,
        targetId: adjustment.requestedByUserId,
        action: 'SCORE_ADJUSTMENT_APPROVED',
        details: `Admin @${reviewer.username} approved +${adjustment.points} PTS for Squad "${adjustment.team.name}" (Level ${adjustment.level}). Reason: ${adjustment.reason}`,
      },
    });

    // Notify the requesting evaluator
    await tx.notification.create({
      data: {
        userId: adjustment.requestedByUserId,
        title: 'Score Adjustment Approved',
        message: `Your request for +${adjustment.points} PTS for Squad "${adjustment.team.name}" (Level ${adjustment.level}) was approved by @${reviewer.username}.`,
        read: false,
      },
    });

    const updated = await tx.scoreAdjustment.findUniqueOrThrow({
      where: { id: adjustmentId },
      include: {
        team: { select: { name: true } },
        requestedBy: { select: { username: true } },
        reviewedBy: { select: { username: true } },
      },
    });

    return formatScoreAdjustmentDTO(updated);
  });
}

/**
 * Service: Admin rejects a pending score adjustment with mandatory reason.
 * Concurrency protected via conditional update.
 */
export async function rejectScoreAdjustment(
  adjustmentId: string,
  rejectionReason: string,
  reviewer: { id: string; username: string },
): Promise<ScoreAdjustmentDTO> {
  const trimmedReason = rejectionReason?.trim();
  if (!trimmedReason || trimmedReason.length < 5) {
    throw new Error('A valid rejection reason of at least 5 characters is required.');
  }

  return await prisma.$transaction(async (tx) => {
    const adjustment = await tx.scoreAdjustment.findUnique({
      where: { id: adjustmentId },
      include: {
        team: { select: { name: true } },
        requestedBy: { select: { username: true } },
      },
    });

    if (!adjustment) {
      throw new Error('Score adjustment request not found.');
    }

    if (adjustment.status === SCORE_ADJUSTMENT_STATUS.APPROVED) {
      throw new Error('This adjustment has already been approved and cannot be rejected.');
    }

    if (adjustment.status === SCORE_ADJUSTMENT_STATUS.REJECTED) {
      throw new Error('This adjustment was already rejected.');
    }

    // Atomic conditional update ensuring only one concurrent rejection can succeed
    const updateResult = await tx.scoreAdjustment.updateMany({
      where: {
        id: adjustmentId,
        status: SCORE_ADJUSTMENT_STATUS.PENDING,
      },
      data: {
        status: SCORE_ADJUSTMENT_STATUS.REJECTED,
        reviewedByUserId: reviewer.id,
        reviewedAt: new Date(),
        rejectionReason: trimmedReason,
      },
    });

    if (updateResult.count === 0) {
      throw new Error('This score adjustment was already processed by another administrator.');
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        actorId: reviewer.id,
        targetId: adjustment.requestedByUserId,
        action: 'SCORE_ADJUSTMENT_REJECTED',
        details: `Admin @${reviewer.username} rejected score adjustment (+${adjustment.points} PTS) for Squad "${adjustment.team.name}" (Level ${adjustment.level}). Rejection Reason: ${trimmedReason}`,
      },
    });

    // Notify the requesting evaluator
    await tx.notification.create({
      data: {
        userId: adjustment.requestedByUserId,
        title: 'Score Adjustment Rejected',
        message: `Your request for +${adjustment.points} PTS for Squad "${adjustment.team.name}" (Level ${adjustment.level}) was rejected by @${reviewer.username}. Reason: ${trimmedReason}`,
        read: false,
      },
    });

    const updated = await tx.scoreAdjustment.findUniqueOrThrow({
      where: { id: adjustmentId },
      include: {
        team: { select: { name: true } },
        requestedBy: { select: { username: true } },
        reviewedBy: { select: { username: true } },
      },
    });

    return formatScoreAdjustmentDTO(updated);
  });
}

/**
 * Fetches score adjustments with filters (for Admin).
 */
export async function getScoreAdjustments(filters?: {
  status?: ScoreAdjustmentStatus | 'ALL';
  level?: number | 'ALL';
  teamId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ adjustments: ScoreAdjustmentDTO[]; total: number }> {
  const where: Record<string, unknown> = {};

  if (filters?.status && filters.status !== 'ALL') {
    where['status'] = filters.status;
  }
  if (filters?.level && filters.level !== 'ALL' && typeof filters.level === 'number') {
    where['level'] = filters.level;
  }
  if (filters?.teamId) {
    where['teamId'] = filters.teamId;
  }

  const [rows, total] = await Promise.all([
    prisma.scoreAdjustment.findMany({
      where,
      include: {
        team: { select: { name: true } },
        requestedBy: { select: { username: true } },
        reviewedBy: { select: { username: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: filters?.limit ?? 100,
      skip: filters?.offset ?? 0,
    }),
    prisma.scoreAdjustment.count({ where }),
  ]);

  return {
    adjustments: rows.map(formatScoreAdjustmentDTO),
    total,
  };
}

/**
 * Fetches score adjustments for a specific squad (for Evaluator).
 */
export async function getTeamScoreAdjustments(teamId: string): Promise<ScoreAdjustmentDTO[]> {
  const rows = await prisma.scoreAdjustment.findMany({
    where: { teamId },
    include: {
      team: { select: { name: true } },
      requestedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return rows.map(formatScoreAdjustmentDTO);
}

function formatScoreAdjustmentDTO(row: {
  id: string;
  teamId: string;
  level: number;
  points: number;
  reason: string;
  evidenceNote: string | null;
  status: string;
  requestedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  team: { name: string };
  requestedBy: { username: string };
  reviewedBy?: { username: string } | null;
}): ScoreAdjustmentDTO {
  return {
    id: row.id,
    teamId: row.teamId,
    teamName: row.team.name,
    level: row.level,
    points: row.points,
    reason: row.reason,
    evidenceNote: row.evidenceNote,
    status: row.status as ScoreAdjustmentStatus,
    requestedByUserId: row.requestedByUserId,
    requestedByUsername: row.requestedBy.username,
    reviewedByUserId: row.reviewedByUserId,
    reviewedByUsername: row.reviewedBy?.username ?? null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
