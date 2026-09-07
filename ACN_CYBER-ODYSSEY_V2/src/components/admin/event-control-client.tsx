'use client';

import * as React from 'react';
import { toggleEventPortalStatusAction } from '@/lib/actions/admin-actions';
import { ConfirmationModal } from '@/components/creator/confirmation-modal';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface EventControlClientProps {
  initialIsOnline: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export function EventControlClient({
  initialIsOnline,
  updatedAt: initialUpdatedAt,
  updatedBy: initialUpdatedBy,
}: EventControlClientProps) {
  const [isOnline, setIsOnline] = React.useState(initialIsOnline);
  const [updatedAt, setUpdatedAt] = React.useState(initialUpdatedAt);
  const [updatedBy, setUpdatedBy] = React.useState(initialUpdatedBy);

  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function handleConfirmToggle() {
    try {
      setIsPending(true);
      setErrorMsg(null);
      const nextState = !isOnline;
      const result = await toggleEventPortalStatusAction(nextState);

      if (!result.success) {
        setErrorMsg(result.error || 'Failed to update portal status.');
        return;
      }

      setIsOnline(result.data!.isOnline);
      setUpdatedAt(new Date().toISOString());
      setUpdatedBy('You');
      setIsModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-8 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span>INFRASTRUCTURE CONTROL // PORTAL LIFECYCLE</span>
          </div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Event Operations & Portal Status
          </h1>
          <p className="text-muted-foreground font-sans text-sm">
            Manage global competition accessibility. Taking the portal offline will redirect
            participants to the standby screen.
          </p>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Main Status Toggle Card */}
      <div className="border-border/80 bg-card/60 max-w-2xl space-y-6 rounded-2xl border p-8 shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-muted-foreground text-[10px] uppercase">
              CURRENT PORTAL STATE
            </span>
            <div className="flex items-center gap-3">
              <span
                className={`size-3 rounded-full ${
                  isOnline ? 'animate-pulse bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span className="font-sans text-2xl font-black text-white">
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className={`rounded-xl border px-6 py-3 text-xs font-bold shadow-xl transition-all ${
              isOnline
                ? 'border-rose-500/50 bg-rose-950/60 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.3)] hover:bg-rose-900/80 hover:text-white'
                : 'border-emerald-500/50 bg-emerald-950/60 text-emerald-200 shadow-[0_0_15px_rgba(52,211,153,0.3)] hover:bg-emerald-900/80 hover:text-white'
            }`}
          >
            {isOnline ? 'TAKE EVENT OFFLINE' : 'BRING EVENT ONLINE'}
          </button>
        </div>

        <div className="text-muted-foreground border-border/40 space-y-2 border-t pt-4 font-sans text-xs leading-relaxed">
          <p>
            {isOnline
              ? 'The portal is currently LIVE. Participants can access active investigation levels and submit evidence.'
              : 'The portal is currently OFFLINE. Participants visiting the portal will be redirected to the offline standby screen.'}
          </p>
          <div className="text-muted-foreground/80 pt-2 font-mono text-[11px]">
            Last modified by {updatedBy || 'Operations'} on {formatDateTime(updatedAt)}.
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={isModalOpen}
        title={isOnline ? 'Take Event Portal Offline?' : 'Bring Event Portal Online?'}
        description={
          isOnline
            ? 'Taking the portal offline will prevent participants from accessing any competition levels and submitting deliverables. Staff accounts will retain access.'
            : 'Bringing the portal online will restore participant access to competition dashboards and active investigation levels.'
        }
        confirmLabel={isOnline ? 'Take Offline' : 'Bring Online'}
        variant={isOnline ? 'danger' : 'primary'}
        isPending={isPending}
        onConfirm={handleConfirmToggle}
        onCancel={() => !isPending && setIsModalOpen(false)}
      />
    </div>
  );
}
