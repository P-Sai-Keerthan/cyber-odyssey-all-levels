import type { Metadata } from 'next';
import { getPendingStaffAction, getRecentAuditLogsAction } from '@/lib/actions/creator-actions';
import { ApprovalsClient } from '@/components/creator/approvals-client';

export const metadata: Metadata = {
  title: 'Staff Clearance Approvals',
  description: 'Manage security clearance and role requests for Evaluators and Administrators.',
};

export default async function CreatorApprovalsPage() {
  const [pendingResult, logsResult] = await Promise.all([
    getPendingStaffAction(),
    getRecentAuditLogsAction(),
  ]);

  const pendingStaff = pendingResult.data || [];
  const auditLogs = logsResult.data || [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-widest text-fuchsia-400 uppercase">
          <span className="size-2 rounded-full bg-fuchsia-400" />
          <span>SECURITY CLEARANCE CONTROL</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Staff Role Approvals
        </h1>
        <p className="text-muted-foreground text-sm">
          Review, approve, or reject access requests for Evaluators and Event Administrators.
        </p>
      </div>

      <ApprovalsClient initialPending={pendingStaff} initialLogs={auditLogs} />
    </div>
  );
}
