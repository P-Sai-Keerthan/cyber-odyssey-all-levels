'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { setPortalStatusAction, type AuditLogItem } from '@/lib/actions/creator-actions';
import type { PortalStatusData } from '@/lib/event/portal-settings';
import { ConfirmationModal } from './confirmation-modal';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface PortalControlClientProps {
  initialStatus: PortalStatusData;
  recentLogs: AuditLogItem[];
}

export function PortalControlClient({ initialStatus, recentLogs }: PortalControlClientProps) {
  const router = useRouter();
  const [isOnline, setIsOnline] = React.useState(initialStatus.isOnline);
  const [updatedAt, setUpdatedAt] = React.useState(initialStatus.updatedAt);
  const [isPending, setIsPending] = React.useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ text: string; isError?: boolean } | null>(null);

  async function handleToggleStatus(targetOnlineState: boolean) {
    setIsPending(true);
    setFeedback(null);

    try {
      const result = await setPortalStatusAction(targetOnlineState);
      if (result.success && result.data) {
        setIsOnline(result.data.isOnline);
        setUpdatedAt(result.data.updatedAt);
        setFeedback({
          text: targetOnlineState
            ? 'Event portal successfully restored ONLINE. All participant actions and submissions unlocked.'
            : 'Event portal taken OFFLINE. Participant operations locked with investigation standby screen.',
        });
        setConfirmModalOpen(false);
        router.refresh();
      } else {
        setFeedback({
          text: result.error || 'Failed to update event portal status.',
          isError: true,
        });
      }
    } catch {
      setFeedback({ text: 'Network communication error.', isError: true });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-8 font-mono text-xs">
      {/* Feedback Alert */}
      {feedback && (
        <div
          role="status"
          className={`rounded-xl border p-4 ${
            feedback.isError
              ? 'border-rose-500/40 bg-rose-950/20 text-rose-300'
              : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Main Operations Control Console */}
      <section className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="border-border/50 space-y-1 border-b pb-4">
          <div className="flex items-center gap-2 text-[11px] font-bold text-fuchsia-400 uppercase">
            <span className="size-2 animate-pulse rounded-full bg-fuchsia-400" />
            <span>EVENT PORTAL LIFECYCLE MANAGEMENT</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            Competition Portal State
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Control live access for participants across competition dashboards, evidence uploads,
            squad coordination, and submission APIs.
          </p>
        </div>

        {/* Live Status Hero Card */}
        <div
          className={`rounded-2xl border p-6 transition-all ${
            isOnline
              ? 'border-emerald-500/50 bg-emerald-950/20 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
              : 'border-rose-500/50 bg-rose-950/20 shadow-[0_0_20px_rgba(244,63,94,0.15)]'
          }`}
        >
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span
                  className={`size-3 rounded-full ${
                    isOnline
                      ? 'animate-pulse bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]'
                      : 'bg-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.9)]'
                  }`}
                />
                <span className="text-sm font-extrabold tracking-wider text-white uppercase">
                  PORTAL STATUS: {isOnline ? '● ONLINE' : '● OFFLINE'}
                </span>
              </div>

              <p className="text-muted-foreground text-xs">
                {isOnline
                  ? 'All participant systems active. Investigators can submit evidence, view challenges, and join squads.'
                  : 'Participant access paused. Non-creator requests routed to the Cyber Odyssey standby maintenance terminal.'}
              </p>

              <div className="text-[11px] text-slate-400">
                Last updated: <span className="text-slate-200">{formatDateTime(updatedAt)}</span>
              </div>
            </div>

            {/* Toggle Action Buttons */}
            <div>
              {isOnline ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setConfirmModalOpen(true)}
                  className="rounded-xl border border-rose-500/50 bg-rose-950/80 px-5 py-3 font-bold tracking-wider text-rose-200 uppercase shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all hover:bg-rose-900 hover:text-white focus-visible:ring-1 focus-visible:ring-rose-400 focus-visible:outline-none disabled:opacity-50"
                >
                  Take Portal Offline
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleToggleStatus(true)}
                  className="rounded-xl border border-emerald-500/50 bg-emerald-950/80 px-5 py-3 font-bold tracking-wider text-emerald-200 uppercase shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-900 hover:text-white focus-visible:ring-1 focus-visible:ring-emerald-400 focus-visible:outline-none disabled:opacity-50"
                >
                  Bring Portal Online
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Operational Guardrails Explanation */}
        <div className="border-border/60 bg-background/50 space-y-3 rounded-xl border p-5 text-[11px] text-slate-300">
          <div className="flex items-center gap-2 font-bold text-fuchsia-400 uppercase">
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>SECURITY & OPERATIONAL NOTICE</span>
          </div>

          <ul className="space-y-1.5 text-slate-400">
            <li>
              • Taking the portal offline does not shut down the server or drop database
              connections.
            </li>
            <li>• Creator administrative workflows remain fully operational at all times.</li>
            <li>
              • Active participant sessions remain authenticated and will resume seamlessly once
              brought online.
            </li>
            <li>
              • An immutable record is stored in the Creator Audit Trail whenever status is toggled.
            </li>
          </ul>
        </div>
      </section>

      {/* Recent Portal State Logs */}
      <section className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-md">
        <div className="border-border/50 border-b pb-3">
          <h3 className="text-foreground text-sm font-bold">Portal State Audit History</h3>
          <p className="text-muted-foreground text-xs">
            Recent transitions and operational status changes.
          </p>
        </div>

        {recentLogs.length === 0 ? (
          <div className="p-6 text-center text-slate-400">No state changes recorded yet.</div>
        ) : (
          <div className="space-y-2">
            {recentLogs
              .filter((l) => l.action === 'PORTAL_ONLINE' || l.action === 'PORTAL_OFFLINE')
              .slice(0, 5)
              .map((log) => (
                <div
                  key={log.id}
                  className="border-border/40 bg-background/40 flex items-center justify-between rounded-xl border p-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        log.action === 'PORTAL_ONLINE'
                          ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                          : 'border border-rose-500/40 bg-rose-950/40 text-rose-300'
                      }`}
                    >
                      {log.action}
                    </span>
                    <span className="text-slate-300">{log.details}</span>
                  </div>

                  <span className="text-muted-foreground text-[11px] whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModalOpen}
        title="Take Cyber Odyssey Portal Offline?"
        description="This will lock participant competition actions, submissions, and squad coordination immediately. Participants will see the Cyber Odyssey maintenance standby screen until brought back online."
        confirmLabel="Take Portal Offline"
        variant="danger"
        isPending={isPending}
        onConfirm={() => handleToggleStatus(false)}
        onCancel={() => setConfirmModalOpen(false)}
      />
    </div>
  );
}
