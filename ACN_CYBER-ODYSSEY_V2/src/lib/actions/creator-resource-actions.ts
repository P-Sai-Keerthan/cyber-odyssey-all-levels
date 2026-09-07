'use server';

import { safeRevalidate } from '@/lib/utils/revalidate';
import { getSessionUser } from '@/lib/auth/session';
import {
  getLevelResources,
  saveLevelResource,
  removeLevelResource,
  toggleLevelResourcePublish,
  type LevelResourceMeta,
} from '@/lib/event/level-resources';
import type { ActionResult } from './auth-actions';

/**
 * Server-side security guard ensuring only active CREATOR can perform resource operations.
 */
async function requireCreatorUser() {
  const user = await getSessionUser();
  if (!user || user.role !== 'CREATOR' || user.status !== 'ACTIVE') {
    throw new Error(
      'Your account does not have permission to manage competition resources. ' +
        'The Level 2 evidence package and sample report are owned by the event Creator; ' +
        'evaluators and admins can view and download them but cannot change them.',
    );
  }
  return user;
}

/**
 * Queries all resources for a specific level (for Creator view).
 */
export async function getCreatorLevelResourcesAction(
  levelNumber: number = 2,
): Promise<ActionResult<{ resources: LevelResourceMeta[] }>> {
  try {
    await requireCreatorUser();
    const resources = await getLevelResources(levelNumber);
    return {
      success: true,
      data: { resources },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to query level resources.',
    };
  }
}

/**
 * Uploads or replaces a Level resource.
 */
export async function uploadOrReplaceLevelResourceAction(
  formData: FormData,
): Promise<ActionResult<LevelResourceMeta>> {
  try {
    const creator = await requireCreatorUser();

    const rawLevel = formData.get('levelNumber');
    const levelNumber = rawLevel ? parseInt(rawLevel.toString(), 10) : 2;
    const resourceKey = formData.get('resourceKey')?.toString();
    const file = formData.get('file') as File | null;

    if (!resourceKey) {
      return { success: false, error: 'Resource key is required.' };
    }

    if (!file || typeof file.size !== 'number' || file.size === 0) {
      return { success: false, error: 'A valid file must be uploaded.' };
    }

    const updated = await saveLevelResource({
      levelNumber,
      resourceKey,
      file,
      actorId: creator.id,
      actorUsername: creator.username,
    });

    safeRevalidate(
      '/creator/resources',
      '/creator/resources/level-3',
      '/event/level-2',
      '/event/level-3',
      '/event',
    );

    return {
      success: true,
      data: updated,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to upload or replace level resource.',
    };
  }
}

/**
 * Removes a Level resource.
 */
export async function removeLevelResourceAction(
  levelNumber: number = 2,
  resourceKey: string,
): Promise<ActionResult<{ removed: boolean }>> {
  try {
    const creator = await requireCreatorUser();

    if (!resourceKey) {
      return { success: false, error: 'Resource key is required.' };
    }

    const removed = await removeLevelResource({
      levelNumber,
      resourceKey,
      actorId: creator.id,
      actorUsername: creator.username,
    });

    if (!removed) {
      return { success: false, error: 'Resource not found or already removed.' };
    }

    safeRevalidate(
      '/creator/resources',
      '/creator/resources/level-3',
      '/event/level-2',
      '/event/level-3',
      '/event',
    );

    return {
      success: true,
      data: { removed: true },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to remove level resource.',
    };
  }
}

/**
 * Toggles publish visibility of a Level resource.
 */
export async function toggleLevelResourcePublishAction(
  levelNumber: number = 2,
  resourceKey: string,
  isPublished: boolean,
): Promise<ActionResult<LevelResourceMeta>> {
  try {
    const creator = await requireCreatorUser();

    const updated = await toggleLevelResourcePublish({
      levelNumber,
      resourceKey,
      isPublished,
      actorId: creator.id,
      actorUsername: creator.username,
    });

    if (!updated) {
      return { success: false, error: 'Resource not found.' };
    }

    safeRevalidate(
      '/creator/resources',
      '/creator/resources/level-3',
      '/event/level-2',
      '/event/level-3',
      '/event',
    );

    return {
      success: true,
      data: updated,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to toggle resource visibility.',
    };
  }
}
