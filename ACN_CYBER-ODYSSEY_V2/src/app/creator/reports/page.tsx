import type { Metadata } from 'next';
import { requireCreator } from '@/lib/auth/guards';
import { listCreatorReportsAction } from '@/lib/actions/creator-report-actions';
import { CreatorReportsClient } from '@/components/shared/creator-reports-client';

export const metadata: Metadata = {
  title: 'Reports from Admins',
  description: 'Issues escalated by event administrators about squads and participants.',
};

/** Creator inbox for Admin escalations (Admin spec §5). */
export default async function CreatorReportsPage() {
  await requireCreator();

  const res = await listCreatorReportsAction();

  if (!res.success || !res.data) {
    return (
      <div className="border-border/80 bg-card/60 flex flex-col items-center justify-center rounded-2xl border p-12 text-center backdrop-blur-xl">
        <span className="font-mono text-sm font-bold text-rose-400">REPORTS UNAVAILABLE</span>
        <p className="text-muted-foreground mt-2 max-w-md font-sans text-xs">
          {res.error ?? 'Reports could not be loaded. Please refresh the page.'}
        </p>
      </div>
    );
  }

  return (
    <CreatorReportsClient
      reports={res.data.reports}
      openCount={res.data.openCount}
      mode="CREATOR"
    />
  );
}
