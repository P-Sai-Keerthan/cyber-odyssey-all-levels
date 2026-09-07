import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';

export interface PortalStatusData {
  isOnline: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Retrieves the current event portal online status from the database.
 * If the setting record does not yet exist, it defaults to online: true.
 */
export async function getPortalStatus(): Promise<PortalStatusData> {
  try {
    let setting = await prisma.portalSetting.findUnique({
      where: { id: 'default' },
    });

    if (!setting) {
      setting = await prisma.portalSetting.create({
        data: {
          id: 'default',
          isOnline: true,
        },
      });
    }

    return {
      isOnline: setting.isOnline,
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
    };
  } catch (error) {
    console.error('Error fetching portal status:', error);
    // Safe default to true if database read fails temporarily
    return {
      isOnline: true,
      updatedAt: new Date(),
      updatedBy: null,
    };
  }
}

/**
 * Updates the event portal status with an atomic database transaction and audit log.
 */
export async function setPortalStatus(
  isOnline: boolean,
  creatorUserId: string,
): Promise<PortalStatusData> {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.portalSetting.upsert({
      where: { id: 'default' },
      update: {
        isOnline,
        updatedBy: creatorUserId,
      },
      create: {
        id: 'default',
        isOnline,
        updatedBy: creatorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: creatorUserId,
        action: isOnline ? 'PORTAL_ONLINE' : 'PORTAL_OFFLINE',
        details: isOnline
          ? 'Event portal brought ONLINE by Creator. Participant actions unlocked.'
          : 'Event portal taken OFFLINE by Creator. Participant actions locked.',
      },
    });

    return updated;
  });

  // Revalidate key participant and operational routes safely
  try {
    revalidatePath('/dashboard');
    revalidatePath('/event');
    revalidatePath('/team');
    revalidatePath('/leaderboard');
    revalidatePath('/announcements');
    revalidatePath('/creator');
    revalidatePath('/creator/portal-control');
  } catch {
    // Ignore outside Next.js request context (e.g. unit tests)
  }

  return {
    isOnline: result.isOnline,
    updatedAt: result.updatedAt,
    updatedBy: result.updatedBy,
  };
}
