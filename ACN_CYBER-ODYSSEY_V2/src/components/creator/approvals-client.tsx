'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { GradientButton } from '@/components/ui/gradient-button';
import {
  approveStaffAction,
  rejectStaffAction,
  type PendingStaffUser,
  type AuditLogItem,
} from '@/lib/actions/creator-actions';
import { formatDateTime } from '@/lib/utils/date-formatter';

interface ApprovalsClientProps {
  initialPending: PendingStaffUser[];
  initialLogs: AuditLogItem[];
}

export function ApprovalsClient({ initialPending, initialLogs }: ApprovalsClientProps) {
  const router = useRouter();
  const [pendingList, setPendingList] = React.useState<PendingStaffUser[]>(initialPending);
  const [auditLogs] = React.useState<AuditLogItem[]>(initialLogs);
  const [processingId, setProcessingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ text: string; isError?: boolean } | null>(null);

  async function handleApprove(userId: string, username: string, role: string) {
    if (processingId) return;
    setProcessingId(userId);
    setFeedback(null);

    try {
      const result = await approveStaffAction(userId);
      if (result.success) {
        setPendingList((prev) => prev.filter((item) => item.id !== userId));
        setFeedback({ text: `Approved ${role} clearance for @${username}.` });
        router.refresh();
      } else {
        setFeedback({ text: result.error || 'Failed to approve account.', isError: true });
      }
    } catch {
      setFeedback({ text: 'Network communication error.', isError: true });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(userId: string, username: string, role: string) {
    if (processingId) return;
    setProcessingId(userId);
    setFeedback(null);

    try {
      const result = await rejectStaffAction(userId);
      if (result.success) {
        setPendingList((prev) => prev.filter((item) => item.id !== userId));
        setFeedback({ text: `Rejected ${role} application for @${username}.` });
        router.refresh();
      } else {
        setFeedback({ text: result.error || 'Failed to reject account.', isError: true });
      }
    } catch {
      setFeedback({ text: 'Network communication error.', isError: true });
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Action Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`rounded-xl border p-3.5 font-mono text-xs ${
            feedback.isError
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Pending Approvals Table / Card List */}
      <section className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-md">
        <div className="border-border/50 flex items-center justify-between border-b pb-3">
          <div className="space-y-0.5">
            <h2 className="text-foreground text-base font-bold">
              Pending Staff Clearance Requests
            </h2>
            <p className="text-muted-foreground text-xs">
              Review and grant role permissions for Evaluators and Administrators.
            </p>
          </div>
          <span className="rounded-md border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 font-mono text-xs font-semibold text-amber-400">
            {pendingList.length} Pending
          </span>
        </div>

        {pendingList.length === 0 ? (
          <div className="border-border/60 text-muted-foreground rounded-xl border border-dashed p-8 text-center font-mono text-xs">
            No pending staff approval requests at this time.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingList.map((item) => {
              const isBusy = processingId === item.id;
              const isEvaluator = item.role === 'EVALUATOR';

              return (
                <div
                  key={item.id}
                  className="border-border/70 bg-background/50 flex flex-col gap-4 rounded-xl border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground font-semibold">@{item.username}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                          isEvaluator
                            ? 'border-fuchsia-500/40 bg-fuchsia-950/40 text-fuchsia-300'
                            : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                        }`}
                      >
                        {item.role}
                      </span>
                      <span className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-950/30 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-400">
                        <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
                        PENDING
                      </span>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span>{item.email}</span>
                      <span>•</span>
                      <span className="text-muted-foreground/80 text-[11px]">
                        Registered {formatDateTime(item.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <GradientButton
                      variant="magenta"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => handleApprove(item.id, item.username, item.role)}
                      className="text-xs font-semibold uppercase"
                    >
                      {isBusy ? 'Processing...' : 'Approve'}
                    </GradientButton>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleReject(item.id, item.username, item.role)}
                      className="rounded-lg border border-rose-500/40 bg-rose-950/20 px-3 py-1.5 font-mono text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-900/40 focus-visible:ring-1 focus-visible:ring-rose-400 focus-visible:outline-none disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Audit Log Trail */}
      <section className="border-border/70 bg-card/40 space-y-4 rounded-2xl border p-6 backdrop-blur-md">
        <div className="border-border/50 border-b pb-3">
          <h3 className="text-foreground text-sm font-bold">Creator Audit Record</h3>
          <p className="text-muted-foreground font-mono text-xs">
            Immutable log of staff clearance and access decisions.
          </p>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-muted-foreground/60 py-4 text-center font-mono text-xs">
            No audit log entries recorded yet.
          </div>
        ) : (
          <div className="space-y-2 font-mono text-xs">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="border-border/40 bg-background/30 flex items-center justify-between rounded-lg border p-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      log.action.includes('APPROVED')
                        ? 'border border-emerald-500/30 bg-emerald-950/50 text-emerald-400'
                        : 'border border-rose-500/30 bg-rose-950/50 text-rose-400'
                    }`}
                  >
                    {log.action}
                  </span>
                  <span className="text-muted-foreground">{log.details}</span>
                </div>
                <span className="text-muted-foreground/60 text-[10px]">
                  {formatDateTime(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
