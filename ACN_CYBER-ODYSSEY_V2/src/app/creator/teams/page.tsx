import type { Metadata } from 'next';
import { getTeamsAction } from '@/lib/actions/creator-actions';
import { TeamsClient } from '@/components/creator/teams-client';

export const metadata: Metadata = {
  title: 'Squad Registry & Teams',
  description: 'Manage investigation squads and participant team assignments.',
};

export default async function CreatorTeamsPage() {
  const result = await getTeamsAction({ page: 1, limit: 15 });

  const data = result.data || {
    teams: [],
    total: 0,
    page: 1,
    totalPages: 1,
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-widest text-fuchsia-400 uppercase">
          <span className="size-2 rounded-full bg-fuchsia-400" />
          <span>SQUAD REGISTRY</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Team Management
        </h1>
        <p className="text-muted-foreground text-sm">
          Inspect squad rosters, performance metrics, and manage squad participation statuses.
        </p>
      </div>

      <TeamsClient
        initialTeams={data.teams}
        initialTotal={data.total}
        initialPage={data.page}
        initialTotalPages={data.totalPages}
      />
    </div>
  );
}
