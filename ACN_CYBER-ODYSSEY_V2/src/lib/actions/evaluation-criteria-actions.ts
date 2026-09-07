'use server';

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { safeRevalidate } from '@/lib/utils/revalidate';
import type { ActionResult } from './auth-actions';

export interface EvaluationCriterionDTO {
  id: string;
  levelNumber: number;
  title: string;
  description: string | null;
  maxPoints: number;
  sortOrder: number;
  isActive: boolean;
  guidance: string | null;
  required: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LevelEvaluationConfigDTO {
  levelNumber: number;
  maxPossibleScore: number;
  criteria: EvaluationCriterionDTO[];
}

async function requireCriteriaAuthority() {
  const user = await getSessionUser();
  if (!user || user.status !== 'ACTIVE' || (user.role !== 'ADMIN' && user.role !== 'CREATOR')) {
    throw new Error(
      'Unauthorized. Admin or Creator privilege required to configure evaluation criteria.',
    );
  }
  return user;
}

/**
 * Retrieves all active criteria for a level.
 * Used by the Evaluator workspace and submission details.
 */
export async function getEvaluationCriteriaAction(
  levelNumber: number,
): Promise<ActionResult<LevelEvaluationConfigDTO>> {
  try {
    const user = await getSessionUser();
    if (!user || user.status !== 'ACTIVE') {
      return { success: false, error: 'Authentication required.' };
    }

    const criteria = await prisma.evaluationCriterion.findMany({
      where: {
        levelNumber,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });

    const maxPossibleScore = criteria.reduce((sum, c) => sum + c.maxPoints, 0);

    return {
      success: true,
      data: {
        levelNumber,
        maxPossibleScore,
        criteria,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query evaluation criteria.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Retrieves all criteria for Admin/Creator management (active and inactive).
 */
export async function getAllEvaluationCriteriaAction(): Promise<
  ActionResult<Record<number, LevelEvaluationConfigDTO>>
> {
  try {
    await requireCriteriaAuthority();

    const allCriteria = await prisma.evaluationCriterion.findMany({
      orderBy: [{ levelNumber: 'asc' }, { sortOrder: 'asc' }],
    });

    const grouped: Record<number, LevelEvaluationConfigDTO> = {};

    for (const crit of allCriteria) {
      if (!grouped[crit.levelNumber]) {
        grouped[crit.levelNumber] = {
          levelNumber: crit.levelNumber,
          maxPossibleScore: 0,
          criteria: [],
        };
      }
      const group = grouped[crit.levelNumber];
      if (group) {
        group.criteria.push(crit);
        if (crit.isActive) {
          group.maxPossibleScore += crit.maxPoints;
        }
      }
    }

    return { success: true, data: grouped };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to retrieve criteria catalogue.';
    return { success: false, error: errorMsg };
  }
}

export interface CreateCriterionInput {
  levelNumber: number;
  title: string;
  description?: string | undefined;
  maxPoints: number;
  sortOrder?: number | undefined;
  guidance?: string | undefined;
  required?: boolean | undefined;
}

/**
 * Creates a new evaluation criterion. (Admin/Creator only)
 */
export async function createEvaluationCriterionAction(
  input: CreateCriterionInput,
): Promise<ActionResult<EvaluationCriterionDTO>> {
  try {
    const user = await requireCriteriaAuthority();

    if (!input.title || input.title.trim().length === 0) {
      return { success: false, error: 'Criterion title is required.' };
    }

    if (typeof input.maxPoints !== 'number' || input.maxPoints <= 0) {
      return { success: false, error: 'Maximum points must be a positive integer.' };
    }

    const highestSort = await prisma.evaluationCriterion.aggregate({
      where: { levelNumber: input.levelNumber },
      _max: { sortOrder: true },
    });
    const nextSortOrder = input.sortOrder ?? (highestSort._max.sortOrder ?? 0) + 1;

    const created = await prisma.evaluationCriterion.create({
      data: {
        levelNumber: input.levelNumber,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        maxPoints: Math.round(input.maxPoints),
        sortOrder: nextSortOrder,
        guidance: input.guidance?.trim() || null,
        required: input.required ?? true,
        isActive: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CRITERION_CREATED',
        details: `Admin @${user.username} created Level ${input.levelNumber} criterion "${created.title}" (${created.maxPoints} pts).`,
      },
    });

    safeRevalidate('/admin/evaluations', '/evaluator/submissions', '/evaluator/evaluations');

    return { success: true, data: created };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to create criterion.';
    return { success: false, error: errorMsg };
  }
}

export interface UpdateCriterionInput {
  title?: string | undefined;
  description?: string | undefined;
  maxPoints?: number | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
  guidance?: string | undefined;
  required?: boolean | undefined;
}

/**
 * Updates an evaluation criterion. (Admin/Creator only)
 */
export async function updateEvaluationCriterionAction(
  id: string,
  input: UpdateCriterionInput,
): Promise<ActionResult<EvaluationCriterionDTO>> {
  try {
    const user = await requireCriteriaAuthority();

    const existing = await prisma.evaluationCriterion.findUnique({
      where: { id },
    });

    if (!existing) {
      return { success: false, error: 'Evaluation criterion not found.' };
    }

    if (input.maxPoints !== undefined && (input.maxPoints <= 0 || isNaN(input.maxPoints))) {
      return { success: false, error: 'Maximum points must be a positive integer.' };
    }

    const updated = await prisma.evaluationCriterion.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.maxPoints !== undefined ? { maxPoints: Math.round(input.maxPoints) } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.guidance !== undefined ? { guidance: input.guidance.trim() } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CRITERION_UPDATED',
        details: `Admin @${user.username} updated Level ${existing.levelNumber} criterion "${updated.title}" (${updated.maxPoints} pts, active: ${updated.isActive}).`,
      },
    });

    safeRevalidate('/admin/evaluations', '/evaluator/submissions', '/evaluator/evaluations');

    return { success: true, data: updated };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to update criterion.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Deletes or soft-deactivates an evaluation criterion.
 */
export async function deleteEvaluationCriterionAction(
  id: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  try {
    const user = await requireCriteriaAuthority();

    const existing = await prisma.evaluationCriterion.findUnique({
      where: { id },
      include: { _count: { select: { scores: true } } },
    });

    if (!existing) {
      return { success: false, error: 'Criterion not found.' };
    }

    if (existing._count.scores > 0) {
      // Deactivate rather than delete so historical evaluations retain integrity
      await prisma.evaluationCriterion.update({
        where: { id },
        data: { isActive: false },
      });

      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CRITERION_DEACTIVATED',
          details: `Admin @${user.username} deactivated criterion "${existing.title}" because it has ${existing._count.scores} recorded scores.`,
        },
      });

      return { success: true, data: { deleted: false } };
    }

    await prisma.evaluationCriterion.delete({
      where: { id },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CRITERION_DELETED',
        details: `Admin @${user.username} deleted criterion "${existing.title}".`,
      },
    });

    safeRevalidate('/admin/evaluations', '/evaluator/submissions', '/evaluator/evaluations');

    return { success: true, data: { deleted: true } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to remove criterion.';
    return { success: false, error: errorMsg };
  }
}
