import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getAdminLevelsAction } from '@/lib/actions/admin-actions';
import { LevelsClient } from '@/components/admin/levels-client';

export const metadata: Metadata = {
  title: 'Level Operations & Timers | Admin Control',
  description:
    'Cyber Odyssey authoritative level lifecycle controls, live timers, and duration configurations.',
};

export default async function AdminLevelsPage() {
  await requireAdmin();

  const res = await getAdminLevelsAction();
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to query level states.');
  }

  return <LevelsClient initialLevels={res.data.levels} />;
}
