import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getAdminTeamsAction } from '@/lib/actions/admin-actions';
import { TeamsClient } from '@/components/admin/teams-client';

export const metadata: Metadata = {
  title: 'Teams | Admin Control',
  description: 'Cyber Odyssey squad monitoring and score telemetry.',
};

export default async function AdminTeamsPage() {
  await requireAdmin();

  const res = await getAdminTeamsAction();
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to query squads.');
  }

  return <TeamsClient initialTeams={res.data.teams} totalCount={res.data.total} />;
}
