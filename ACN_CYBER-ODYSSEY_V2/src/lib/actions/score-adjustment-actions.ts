'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth/session';
import {
  createScoreAdjustmentRequest,
  approveScoreAdjustment,
  rejectScoreAdjustment,
  getScoreAdjustments,
  getTeamScoreAdjustments,
} from '@/lib/score-adjustments/service';
import {
  type RequestScoreAdjustmentInput,
  type ScoreAdjustmentDTO,
  type ScoreAdjustmentStatus,
  requestScoreAdjustmentSchema,
} from '@/lib/score-adjustments/types';

export type ActionResult<T = unknown> =
  { success: true; data: T; error?: never } | { success: false; error: string; data?: never };

async function requireEvaluatorOrAdminSession() {
  const user = await getSessionUser();
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('Authentication required.');
  }
  if (user.role !== 'EVALUATOR' && user.role !== 'ADMIN' && user.role !== 'CREATOR') {
    throw new Error('Unauthorized: Evaluator or Admin privileges required.');
  }
  return user;
}

async function requireAdminSession() {
  const user = await getSessionUser();
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('Authentication required.');
  }
  if (user.role !== 'ADMIN' && user.role !== 'CREATOR') {
    throw new Error('Unauthorized: Admin privileges required.');
  }
  return user;
}

/**
 * Server Action: Evaluator requests an additional points adjustment for a team.
 */
export async function requestScoreAdjustmentAction(
  input: RequestScoreAdjustmentInput,
): Promise<ActionResult<ScoreAdjustmentDTO>> {
  try {
    const user = await requireEvaluatorOrAdminSession();

    const parsed = requestScoreAdjustmentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid request parameters.',
      };
    }

    const created = await createScoreAdjustmentRequest(parsed.data, {
      id: user.id,
      username: user.username,
    });

    revalidatePath('/evaluator');
    revalidatePath('/evaluator/score-adjustments');
    revalidatePath('/admin');
    revalidatePath('/admin/score-adjustments');

    return {
      success: true,
      data: created,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to request score adjustment.',
    };
  }
}

/**
 * Server Action: Admin approves a pending score adjustment.
 */
export async function approveScoreAdjustmentAction(
  adjustmentId: string,
): Promise<ActionResult<ScoreAdjustmentDTO>> {
  try {
    const admin = await requireAdminSession();

    if (!adjustmentId || typeof adjustmentId !== 'string') {
      return { success: false, error: 'Adjustment ID is required.' };
    }

    const approved = await approveScoreAdjustment(adjustmentId, {
      id: admin.id,
      username: admin.username,
    });

    revalidatePath('/leaderboard');
    revalidatePath('/admin');
    revalidatePath('/admin/score-adjustments');
    revalidatePath('/evaluator');
    revalidatePath('/evaluator/score-adjustments');
    revalidatePath(`/evaluator/teams/${approved.teamId}`);

    return {
      success: true,
      data: approved,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to approve score adjustment.',
    };
  }
}

/**
 * Server Action: Admin rejects a pending score adjustment.
 */
export async function rejectScoreAdjustmentAction(
  adjustmentId: string,
  rejectionReason: string,
): Promise<ActionResult<ScoreAdjustmentDTO>> {
  try {
    const admin = await requireAdminSession();

    if (!adjustmentId || typeof adjustmentId !== 'string') {
      return { success: false, error: 'Adjustment ID is required.' };
    }

    if (!rejectionReason || rejectionReason.trim().length < 5) {
      return {
        success: false,
        error: 'A rejection reason of at least 5 characters is mandatory.',
      };
    }

    const rejected = await rejectScoreAdjustment(adjustmentId, rejectionReason, {
      id: admin.id,
      username: admin.username,
    });

    revalidatePath('/admin');
    revalidatePath('/admin/score-adjustments');
    revalidatePath('/evaluator');
    revalidatePath('/evaluator/score-adjustments');
    revalidatePath(`/evaluator/teams/${rejected.teamId}`);

    return {
      success: true,
      data: rejected,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to reject score adjustment.',
    };
  }
}

/**
 * Server Action: Fetch score adjustments for Admin console.
 */
export async function getAdminScoreAdjustmentsAction(filters?: {
  status?: ScoreAdjustmentStatus | 'ALL';
  level?: number | 'ALL';
  teamId?: string;
  limit?: number;
  offset?: number;
}): Promise<ActionResult<{ adjustments: ScoreAdjustmentDTO[]; total: number }>> {
  try {
    await requireAdminSession();

    const data = await getScoreAdjustments(filters);
    return {
      success: true,
      data,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch score adjustments.',
    };
  }
}

/**
 * Server Action: Fetch score adjustments for a team (for Evaluator / Admin).
 */
export async function getTeamScoreAdjustmentsAction(
  teamId: string,
): Promise<ActionResult<ScoreAdjustmentDTO[]>> {
  try {
    await requireEvaluatorOrAdminSession();

    if (!teamId || typeof teamId !== 'string') {
      return { success: false, error: 'Team ID is required.' };
    }

    const data = await getTeamScoreAdjustments(teamId);
    return {
      success: true,
      data,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch team score adjustments.',
    };
  }
}
