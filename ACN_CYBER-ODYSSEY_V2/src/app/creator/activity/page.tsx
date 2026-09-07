import type { Metadata } from 'next';
import { getActiveSessionsAction, getActivityLogsAction } from '@/lib/actions/creator-actions';
import { ActivityClient } from '@/components/creator/activity-client';

export const metadata: Metadata = {
  title: 'Activity & Sessions Trace',
  description: 'Monitor active sessions, user logins, and authentication telemetry.',
};

export default async function CreatorActivityPage() {
  const [sessionsResult, logsResult] = await Promise.all([
    getActiveSessionsAction(),
    getActivityLogsAction({ page: 1, limit: 20 }),
  ]);

  const sessions = sessionsResult.data || [];
  const logsData = logsResult.data || {
    logs: [],
    total: 0,
    page: 1,
    totalPages: 1,
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-widest text-fuchsia-400 uppercase">
          <span className="size-2 rounded-full bg-fuchsia-400" />
          <span>ACTIVITY TRACE</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Account Activity & Sessions
        </h1>
        <p className="text-muted-foreground text-sm">
          Live authentication telemetry, session token tracking, and login event monitoring.
        </p>
      </div>

      <ActivityClient
        initialSessions={sessions}
        initialLogs={logsData.logs}
        initialTotal={logsData.total}
        initialPage={logsData.page}
        initialTotalPages={logsData.totalPages}
      />
    </div>
  );
}
