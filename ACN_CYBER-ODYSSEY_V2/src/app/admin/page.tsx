import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import {
  getAdminOverviewStatsAction,
  getAdminAnnouncementsAction,
  getAdminActivityAction,
} from '@/lib/actions/admin-actions';
import { OverviewClient } from '@/components/admin/overview-client';

export const metadata: Metadata = {
  title: 'Operations Overview | Admin Control',
  description: 'Cyber Odyssey Event Operations and Marshal Command Overview.',
};

export default async function AdminOverviewPage() {
  await requireAdmin();

  const [statsRes, announcementsRes, activityRes] = await Promise.all([
    getAdminOverviewStatsAction(),
    getAdminAnnouncementsAction(),
    getAdminActivityAction(),
  ]);

  if (!statsRes.success || !statsRes.data) {
    throw new Error(statsRes.error || 'Failed to load operational overview telemetry.');
  }

  const recentAnnouncements =
    announcementsRes.success && announcementsRes.data
      ? announcementsRes.data.announcements.slice(0, 5)
      : [];

  const recentActivity =
    activityRes.success && activityRes.data ? activityRes.data.logs.slice(0, 8) : [];

  return (
    <OverviewClient
      initialStats={statsRes.data}
      recentAnnouncements={recentAnnouncements}
      recentActivity={recentActivity}
    />
  );
}
