import { prisma } from '@/lib/prisma';

/**
 * Audience isolation for announcements (Phase 17 / SEC-17-04).
 *
 * Announcements carry a targetAudience of ALL, PARTICIPANTS, EVALUATORS, ADMINS,
 * or LEVEL_1/2/3. Before this module the filter was written inline at each call
 * site and they had drifted apart: /announcements filtered correctly, but the
 * unread badge counts on /leaderboard, /event and /team counted EVERY published
 * announcement — including EVALUATORS- and ADMINS-only broadcasts. Participants
 * could not read those messages, but the count told them staff-only traffic
 * existed and how much of it there was.
 *
 * Every audience decision now goes through this module so the feed and the badge
 * can never disagree again.
 */

/** Audiences a participant is permitted to see. */
export const PARTICIPANT_AUDIENCES = [
  'ALL',
  'PARTICIPANTS',
  'LEVEL_1',
  'LEVEL_2',
  'LEVEL_3',
] as const;

/** Audiences an evaluator is permitted to see. */
export const EVALUATOR_AUDIENCES = ['ALL', 'EVALUATORS'] as const;

/** Audiences an admin is permitted to see. */
export const ADMIN_AUDIENCES = ['ALL', 'ADMINS'] as const;

export type PortalRole = 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN' | 'CREATOR';

/**
 * Returns the audiences visible to a role. CREATOR sees everything, so callers
 * receive `null` meaning "apply no audience restriction".
 */
export function audiencesForRole(role: PortalRole): readonly string[] | null {
  switch (role) {
    case 'PARTICIPANT':
      return PARTICIPANT_AUDIENCES;
    case 'EVALUATOR':
      return EVALUATOR_AUDIENCES;
    case 'ADMIN':
      return ADMIN_AUDIENCES;
    case 'CREATOR':
      return null;
  }
}

/** Prisma `where` clause selecting the published announcements a role may see. */
export function announcementVisibilityWhere(role: PortalRole) {
  const audiences = audiencesForRole(role);
  return audiences === null
    ? { published: true }
    : { published: true, targetAudience: { in: [...audiences] } };
}

/**
 * Counts the published announcements visible to a role.
 *
 * Backed by the `[published, targetAudience, createdAt]` index, so this stays a
 * cheap index-only count even with every participant loading a page at once.
 */
export async function countVisibleAnnouncements(role: PortalRole): Promise<number> {
  return prisma.announcement.count({ where: announcementVisibilityWhere(role) });
}

export interface VisibleAnnouncement {
  id: string;
  title: string;
  content: string;
  category: string;
  priority: string;
  createdAt: Date;
}

/**
 * Lists the published announcements visible to a role, highest priority first.
 * `take` is always bounded so a long-running event cannot turn the feed into an
 * unbounded query.
 */
export async function listVisibleAnnouncements(
  role: PortalRole,
  take = 50,
): Promise<VisibleAnnouncement[]> {
  return prisma.announcement.findMany({
    where: announcementVisibilityWhere(role),
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      priority: true,
      createdAt: true,
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take,
  });
}

/** The most recent announcement visible to a role, or null. */
export async function latestVisibleAnnouncement(
  role: PortalRole,
): Promise<VisibleAnnouncement | null> {
  return prisma.announcement.findFirst({
    where: announcementVisibilityWhere(role),
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      priority: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
