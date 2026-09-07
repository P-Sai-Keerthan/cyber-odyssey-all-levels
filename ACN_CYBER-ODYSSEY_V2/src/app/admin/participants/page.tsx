import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getAdminParticipantsAction } from '@/lib/actions/admin-actions';
import { ParticipantsClient } from '@/components/admin/participants-client';

export const metadata: Metadata = {
  title: 'Participants | Admin Control',
  description: 'Cyber Odyssey participant roster and squad assignment telemetry.',
};

export default async function AdminParticipantsPage() {
  await requireAdmin();

  const res = await getAdminParticipantsAction();
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to query participants.');
  }

  return (
    <ParticipantsClient initialParticipants={res.data.participants} totalCount={res.data.total} />
  );
}
