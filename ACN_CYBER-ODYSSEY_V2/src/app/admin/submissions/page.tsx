import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getAdminSubmissionsAction } from '@/lib/actions/admin-actions';
import { SubmissionsClient } from '@/components/admin/submissions-client';

export const metadata: Metadata = {
  title: 'Submissions Intake | Admin Control',
  description: 'Cyber Odyssey investigation submissions monitoring terminal.',
};

export default async function AdminSubmissionsPage() {
  await requireAdmin();

  const res = await getAdminSubmissionsAction();
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to query submissions.');
  }

  return (
    <SubmissionsClient initialSubmissions={res.data.submissions} totalCount={res.data.total} />
  );
}
