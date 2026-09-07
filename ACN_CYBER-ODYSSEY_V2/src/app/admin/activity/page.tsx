import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getAdminActivityAction } from '@/lib/actions/admin-actions';
import { ActivityClient } from '@/components/admin/activity-client';

export const metadata: Metadata = {
  title: 'Activity Feed & Audit Trail | Admin Control',
  description: 'Cyber Odyssey chronological operational audit trail and security event telemetry.',
};

export default async function AdminActivityPage() {
  await requireAdmin();

  const res = await getAdminActivityAction();
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to query activity logs.');
  }

  return <ActivityClient initialLogs={res.data.logs} totalCount={res.data.total} />;
}
