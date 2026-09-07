'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/utils/date-formatter';
import {
  approveScoreAdjustmentAction,
  rejectScoreAdjustmentAction,
} from '@/lib/actions/score-adjustment-actions';
import type { ScoreAdjustmentDTO, ScoreAdjustmentStatus } from '@/lib/score-adjustments/types';

export interface ScoreAdjustmentsClientProps {
  initialAdjustments: ScoreAdjustmentDTO[];
  totalCount: number;
}

const TABS = [
  { key: 'PENDING', label: 'Pending Approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All Requests' },
] as const;

function statusBadge(status: ScoreAdjustmentStatus) {
  switch (status) {
    case 'APPROVED':
      return (
        <span className="rounded-full border border-emerald-500/50 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.25)]">
          APPROVED
        </span>
      );
    case 'PENDING':
      return (
        <span className="rounded-full border border-amber-500/50 bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-bold text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]">
          PENDING APPROVAL
        </span>
      );
    case 'REJECTED':
      return (
        <span className="rounded-full border border-rose-500/50 bg-rose-950/60 px-2.5 py-0.5 text-[11px] font-bold text-rose-300">
          REJECTED
        </span>
      );
    default:
      return null;
  }
}

export function ScoreAdjustmentsClient({ initialAdjustments }: ScoreAdjustmentsClientProps) {
  const router = useRouter();

  const [adjustments, setAdjustments] = React.useState<ScoreAdjustmentDTO[]>(initialAdjustments);
  const [tab, setTab] = React.useState<string>('PENDING');
  const [levelFilter, setLevelFilter] = React.useState<string>('ALL');
  const [search, setSearch] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'err'; message: string } | null>(
    null,
  );

  // Rejection composer state
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');

  React.useEffect(() => {
    setAdjustments(initialAdjustments);
  }, [initialAdjustments]);

  // Derived statistics
  const pendingItems = adjustments.filter((a) => a.status === 'PENDING');
  const approvedItems = adjustments.filter((a) => a.status === 'APPROVED');
  const rejectedItems = adjustments.filter((a) => a.status === 'REJECTED');

  const pendingPoints = pendingItems.reduce((acc, a) => acc + a.points, 0);
  const approvedPoints = approvedItems.reduce((acc, a) => acc + a.points, 0);

  // Filtered visible items
  const visible = adjustments.filter((item) => {
    if (tab !== 'ALL' && item.status !== tab) return false;
    if (levelFilter !== 'ALL' && item.level !== parseInt(levelFilter, 10)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchSquad = item.teamName.toLowerCase().includes(q);
      const matchRequester = item.requestedByUsername.toLowerCase().includes(q);
      const matchReason = item.reason.toLowerCase().includes(q);
      const matchEvidence = item.evidenceNote?.toLowerCase().includes(q);
      if (!matchSquad && !matchRequester && !matchReason && !matchEvidence) {
        return false;
      }
    }
    return true;
  });

  async function handleApprove(item: ScoreAdjustmentDTO) {
    setBusyId(item.id);
    setFeedback(null);

    const res = await approveScoreAdjustmentAction(item.id);
    setBusyId(null);

    if (res.success && res.data) {
      setFeedback({
        kind: 'ok',
        message: `Successfully approved +${item.points} PTS (Level ${item.level}) for ${item.teamName}. The score is now officially applied to the squad's leaderboard standing.`,
      });
      // Update local state immediately
      setAdjustments((prev) =>
        prev.map((a) => (a.id === item.id ? (res.data as ScoreAdjustmentDTO) : a)),
      );
      router.refresh();
    } else {
      setFeedback({
        kind: 'err',
        message: res.error ?? 'Could not approve this score adjustment.',
      });
    }
  }

  async function handleReject(item: ScoreAdjustmentDTO) {
    if (!rejectReason || rejectReason.trim().length < 5) {
      setFeedback({
        kind: 'err',
        message: 'Rejection reason must be at least 5 characters.',
      });
      return;
    }

    setBusyId(item.id);
    setFeedback(null);

    const res = await rejectScoreAdjustmentAction(item.id, rejectReason.trim());
    setBusyId(null);

    if (res.success && res.data) {
      setFeedback({
        kind: 'ok',
        message: `Rejected point adjustment request for ${item.teamName}. The evaluator has been notified.`,
      });
      setRejectingId(null);
      setRejectReason('');
      // Update local state immediately
      setAdjustments((prev) =>
        prev.map((a) => (a.id === item.id ? (res.data as ScoreAdjustmentDTO) : a)),
      );
      router.refresh();
    } else {
      setFeedback({
        kind: 'err',
        message: res.error ?? 'Could not reject this score adjustment.',
      });
    }
  }

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="border-border/80 flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
            <span className="text-[11px] font-bold tracking-widest text-amber-400 uppercase">
              ADMIN SUPERVISION // DISCRETIONARY SCORING
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">
            SCORE ADJUSTMENT CONSOLE
          </h1>
          <p className="text-muted-foreground mt-1 text-xs">
            Review evaluator-requested bonus and adjustment points. Approved points immediately
            reflect on the official leaderboard.
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.refresh()}
          className="border-border hover:bg-card/60 rounded-xl border px-3 py-2 text-xs font-bold text-white hover:border-amber-500/50"
        >
          REFRESH FEED
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border-border/80 bg-card/60 rounded-2xl border p-4 backdrop-blur-xl">
          <div className="text-muted-foreground text-[10px] uppercase">PENDING DECISION</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-300">{pendingItems.length}</span>
            <span className="text-xs font-bold text-amber-400/80">({pendingPoints} PTS)</span>
          </div>
          <div className="text-muted-foreground mt-1 text-[11px]">Requires admin verification</div>
        </div>

        <div className="border-border/80 bg-card/60 rounded-2xl border p-4 backdrop-blur-xl">
          <div className="text-muted-foreground text-[10px] uppercase">APPROVED & PUBLISHED</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-300">{approvedItems.length}</span>
            <span className="text-xs font-bold text-emerald-400/80">+{approvedPoints} PTS</span>
          </div>
          <div className="text-muted-foreground mt-1 text-[11px]">Factored into standings</div>
        </div>

        <div className="border-border/80 bg-card/60 rounded-2xl border p-4 backdrop-blur-xl">
          <div className="text-muted-foreground text-[10px] uppercase">REJECTED REQUESTS</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-black text-rose-300">{rejectedItems.length}</span>
          </div>
          <div className="text-muted-foreground mt-1 text-[11px]">Returned with feedback</div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-xl border p-4 text-xs font-bold ${
            feedback.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="font-mono text-[10px] uppercase hover:underline"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Tabs and Filters */}
      <div className="border-border/80 flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                tab === t.key
                  ? 'border border-amber-500/50 bg-amber-950/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                  : 'border-border/60 bg-card/40 text-muted-foreground border hover:text-white'
              }`}
            >
              <span>{t.label}</span>
              {t.key === 'PENDING' && pendingItems.length > 0 && (
                <span className="py-0.2 rounded-full border border-amber-400/50 bg-amber-500/20 px-1.5 text-[10px] font-black text-amber-300">
                  {pendingItems.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Level and Search Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-[11px] uppercase">Level:</span>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="border-border/80 bg-background/80 text-foreground rounded-lg border px-2.5 py-1.5 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="ALL">ALL LEVELS</option>
              <option value="1">LEVEL 1</option>
              <option value="2">LEVEL 2</option>
              <option value="3">LEVEL 3</option>
            </select>
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder="Search squad, evaluator, reason..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-border/80 bg-background/80 placeholder:text-muted-foreground/60 w-64 rounded-lg border px-3 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-muted-foreground absolute top-1.5 right-2.5 text-xs hover:text-white"
              >
                &times;
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Adjustments Feed / List */}
      {visible.length === 0 ? (
        <div className="border-border/80 bg-card/60 flex flex-col items-center justify-center rounded-2xl border p-12 text-center backdrop-blur-xl">
          <span className="text-muted-foreground text-sm font-bold">
            NO SCORE ADJUSTMENTS MATCHING CRITERIA
          </span>
          <p className="text-muted-foreground mt-1 text-xs">
            {tab === 'PENDING'
              ? 'All pending score adjustments have been processed.'
              : 'Try clearing filters or selecting a different tab.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((item) => {
            const isBusy = busyId === item.id;
            const isRejecting = rejectingId === item.id;

            return (
              <div
                key={item.id}
                className="border-border/80 bg-card/70 hover:border-border space-y-4 rounded-2xl border p-5 backdrop-blur-xl transition-all"
              >
                {/* Top Row: Squad & Status */}
                <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 text-xs font-black text-cyan-300">
                      LEVEL {item.level}
                    </span>
                    <h3 className="text-lg font-black tracking-wide text-white">{item.teamName}</h3>
                    <span className="text-muted-foreground text-xs">(ID: {item.teamId})</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-xl font-black text-amber-300 shadow-sm">
                        +{item.points} PTS
                      </span>
                    </div>
                    {statusBadge(item.status)}
                  </div>
                </div>

                {/* Middle Content: Justification & Evidence */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="space-y-2 lg:col-span-8">
                    <div>
                      <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                        EVALUATOR JUSTIFICATION & RATIONALE
                      </div>
                      <p className="text-foreground/90 border-border/40 bg-background/50 mt-1 rounded-xl border p-3 text-sm whitespace-pre-wrap">
                        {item.reason}
                      </p>
                    </div>

                    {item.evidenceNote && (
                      <div>
                        <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                          EVIDENCE REFERENCE / OBSERVATIONS
                        </div>
                        <p className="text-muted-foreground border-border/40 bg-background/30 mt-1 rounded-xl border p-2.5 text-xs whitespace-pre-wrap">
                          {item.evidenceNote}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Audit Metadata Sidebar */}
                  <div className="border-border/60 bg-background/40 space-y-2 rounded-xl border p-3 text-xs lg:col-span-4">
                    <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                      AUDIT TRAIL
                    </div>
                    <div>
                      <span className="text-muted-foreground">Requested by: </span>
                      <span className="font-bold text-cyan-300">@{item.requestedByUsername}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Date: </span>
                      <span className="text-white">{formatDateTime(item.createdAt)}</span>
                    </div>
                    {item.reviewedByUsername && (
                      <div>
                        <span className="text-muted-foreground">Reviewed by: </span>
                        <span className="font-bold text-emerald-300">
                          @{item.reviewedByUsername}
                        </span>
                      </div>
                    )}
                    {item.reviewedAt && (
                      <div>
                        <span className="text-muted-foreground">Decision Date: </span>
                        <span className="text-white">{formatDateTime(item.reviewedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* If Rejected: Display Rejection Reason Banner */}
                {item.status === 'REJECTED' && item.rejectionReason && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
                    <span className="font-bold tracking-wider text-rose-300 uppercase">
                      ADMIN REJECTION REASON:{' '}
                    </span>
                    <span>&ldquo;{item.rejectionReason}&rdquo;</span>
                  </div>
                )}

                {/* Inline Rejection Reason Composer */}
                {isRejecting && (
                  <div className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-950/20 p-4">
                    <label
                      htmlFor={`reject-reason-${item.id}`}
                      className="block text-xs font-bold tracking-wider text-rose-300 uppercase"
                    >
                      MANDATORY REJECTION REASON (Sent to Evaluator)
                    </label>
                    <textarea
                      id={`reject-reason-${item.id}`}
                      rows={2}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Explain why this point adjustment is rejected (e.g. Discretionary points exceed standard threshold; Station 3 report did not include reproducibility step)..."
                      className="bg-background/90 placeholder:text-muted-foreground/60 w-full rounded-xl border border-rose-500/50 p-2.5 text-xs text-white focus:border-rose-400 focus:outline-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectReason('');
                        }}
                        disabled={isBusy}
                        className="border-border text-muted-foreground rounded-lg border px-3 py-1.5 text-xs hover:text-white"
                      >
                        CANCEL
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(item)}
                        disabled={isBusy || rejectReason.trim().length < 5}
                        className="rounded-lg border border-rose-500 bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        {isBusy ? 'REJECTING...' : 'CONFIRM REJECTION'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions Footer (For Pending items) */}
                {item.status === 'PENDING' && !isRejecting && (
                  <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                    <span className="text-muted-foreground text-[11px]">
                      Decision will update squad standing and audit log immediately.
                    </span>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(item.id);
                          setRejectReason('');
                        }}
                        disabled={isBusy}
                        className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-900/60 disabled:opacity-50"
                      >
                        REJECT REQUEST
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApprove(item)}
                        disabled={isBusy}
                        className="flex items-center gap-2 rounded-xl border border-emerald-400 bg-emerald-500 px-5 py-2 text-xs font-black text-black shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-400 disabled:opacity-50"
                      >
                        <span>APPROVE POINT ALLOCATION</span>
                        <span>(+{item.points} PTS)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
