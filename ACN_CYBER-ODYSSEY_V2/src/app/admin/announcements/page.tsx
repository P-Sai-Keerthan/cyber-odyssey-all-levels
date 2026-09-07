import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getAdminAnnouncementsAction } from '@/lib/actions/admin-actions';
import { AnnouncementsClient } from '@/components/admin/announcements-client';

export const metadata: Metadata = {
  title: 'Announcements & Broadcasts | Admin Control',
  description: 'Cyber Odyssey operational dispatch desk and audience announcement broadcasting.',
};

export default async function AdminAnnouncementsPage() {
  await requireAdmin();

  const res = await getAdminAnnouncementsAction();
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to load announcements.');
  }

  return <AnnouncementsClient initialAnnouncements={res.data.announcements} />;
}
