import type { Metadata } from 'next';
import { getPortalStatusAction, getRecentAuditLogsAction } from '@/lib/actions/creator-actions';
import { PortalControlClient } from '@/components/creator/portal-control-client';

export const metadata: Metadata = {
  title: 'Portal Status Control',
  description: 'Manage competition lifecycle and online/offline event access.',
};

export default async function CreatorPortalControlPage() {
  const [statusResult, logsResult] = await Promise.all([
    getPortalStatusAction(),
    getRecentAuditLogsAction(),
  ]);

  const status = statusResult.data || {
    isOnline: true,
    updatedAt: new Date(),
    updatedBy: null,
  };

  const logs = logsResult.data || [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-widest text-fuchsia-400 uppercase">
          <span className="size-2 rounded-full bg-fuchsia-400" />
          <span>PORTAL LIFECYCLE</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Portal Status Operations
        </h1>
        <p className="text-muted-foreground text-sm">
          Toggle live competition status between ONLINE and OFFLINE with atomic transactional
          guardrails.
        </p>
      </div>

      <PortalControlClient initialStatus={status} recentLogs={logs} />
    </div>
  );
}
