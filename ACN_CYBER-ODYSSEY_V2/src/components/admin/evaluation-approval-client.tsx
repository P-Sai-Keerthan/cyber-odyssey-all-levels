'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { GradientButton } from '@/components/ui/gradient-button';
import { formatDateTime } from '@/lib/utils/date-formatter';
import {
  approveEvaluationAction,
  rejectEvaluationAction,
  type AdminEvaluationQueueItem,
} from '@/lib/actions/evaluation-approval-actions';

export interface EvaluationApprovalClientProps {
  initialEvaluations: AdminEvaluationQueueItem[];
  totalCount: number;
}

const APPROVAL_TABS = [
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
] as const;

/** Visual treatment per approval state, matching the portal's status vocabulary. */
function statusStyles(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300';
    case 'PENDING_APPROVAL':
      return 'border-amber-500/40 bg-amber-950/40 text-amber-300';
    case 'REJECTED':
      return 'border-rose-500/40 bg-rose-950/40 text-rose-300';
    default:
      return 'border-border/60 bg-background/40 text-muted-foreground';
  }
}

/**
 * Admin evaluation approval console.
 *
 * The approval decision is what publishes a score to the official leaderboard, so
 * the UI makes three things unmissable: which evaluator produced the score, what
 * the score is, and whether it is currently counting. Rejection requires a typed
 * reason before the button becomes usable — the evaluator has to know what to fix.
 */
export function EvaluationApprovalClient({
  initialEvaluations,
  totalCount,
}: EvaluationApprovalClientProps) {
  const router = useRouter();

  const [evaluations, setEvaluations] =
    React.useState<AdminEvaluationQueueItem[]>(initialEvaluations);
  const [tab, setTab] = React.useState<string>('PENDING_APPROVAL');
  const [search, setSearch] = React.useState('');
  const [levelFilter, setLevelFilter] = React.useState('ALL');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'err'; message: string } | null>(
    null,
  );

  // Rejection composer state, scoped to whichever row is open.
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');

  React.useEffect(() => {
    setEvaluations(initialEvaluations);
  }, [initialEvaluations]);

  const visible = evaluations.filter((e) => {
    if (tab !== 'ALL' && e.approvalStatus !== tab) return false;
    if (levelFilter !== 'ALL' && e.level !== parseInt(levelFilter, 10)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!e.teamName.toLowerCase().includes(q) && !e.evaluatorUsername.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const pendingCount = evaluations.filter((e) => e.approvalStatus === 'PENDING_APPROVAL').length;

  async function handleApprove(item: AdminEvaluationQueueItem) {
    setBusyId(item.id);
    setFeedback(null);
    const res = await approveEvaluationAction(item.id);
    setBusyId(null);

    if (res.success) {
      setFeedback({
        kind: 'ok',
        message:
          `Approved ${item.score}/${item.maxScore} for ${item.teamName}. ` +
          `The squad total is now ${res.data?.teamScore ?? 0} and is live on the leaderboard.`,
      });
      router.refresh();
    } else {
      setFeedback({ kind: 'err', message: res.error ?? 'Could not approve this evaluation.' });
    }
  }

  async function handleReject(item: AdminEvaluationQueueItem) {
    setBusyId(item.id);
    setFeedback(null);
    const res = await rejectEvaluationAction(item.id, rejectReason);
    setBusyId(null);

    if (res.success) {
      setFeedback({
        kind: 'ok',
        message: `Returned ${item.teamName}'s evaluation to @${item.evaluatorUsername} for correction. It is not on the leaderboard.`,
      });
      setRejectingId(null);
      setRejectReason('');
      router.refresh();
    } else {
      setFeedback({ kind: 'err', message: res.error ?? 'Could not reject this evaluation.' });
    }
  }

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-indigo-400 uppercase">
              <span className="size-2 rounded-full bg-indigo-400" />
              <span>MARSHAL SUPERVISION // EVALUATION APPROVAL</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Evaluation Approval
            </h1>
            <p className="text-muted-foreground max-w-2xl font-sans text-sm">
              Evaluator scores reach the official leaderboard only after approval here. A pending or
              rejected evaluation contributes nothing to squad standings.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 text-xs sm:items-end">
            <span className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3.5 py-1.5 font-bold text-amber-300">
              {pendingCount} AWAITING DECISION
            </span>
            <span className="text-muted-foreground">{totalCount} evaluations total</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 pt-6">
          {APPROVAL_TABS.map((t) => {
            const count =
              t.key === 'ALL'
                ? evaluations.length
                : evaluations.filter((e) => e.approvalStatus === t.key).length;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase transition-colors ${
                  tab === t.key
                    ? 'border-indigo-500/60 bg-indigo-950/50 text-indigo-200'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:text-white'
                }`}
                aria-pressed={tab === t.key}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2">
          <label className="sr-only" htmlFor="eval-search">
            Search by squad or evaluator
          </label>
          <input
            id="eval-search"
            type="text"
            placeholder="Search squad or evaluator username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-border/60 bg-background/60 w-full rounded-xl border px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
          />
          <label className="sr-only" htmlFor="eval-level">
            Filter by level
          </label>
          <select
            id="eval-level"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="border-border/60 bg-background/60 w-full rounded-xl border px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
          >
            <option value="ALL">All levels</option>
            <option value="2">Level 2</option>
            <option value="3">Level 3</option>
          </select>
        </div>
      </div>

      {/* Result banner */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-2xl border p-4 text-xs ${
            feedback.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Queue */}
      {visible.length === 0 ? (
        <div className="border-border/60 bg-card/40 space-y-2 rounded-2xl border p-12 text-center">
          <h2 className="text-sm font-bold text-white uppercase">Nothing to review here</h2>
          <p className="text-muted-foreground mx-auto max-w-md font-sans text-xs">
            {tab === 'PENDING_APPROVAL'
              ? 'No evaluations are waiting for a decision. Scores appear here as soon as evaluators finalise them.'
              : 'No evaluations match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((item) => {
            const isPending = item.approvalStatus === 'PENDING_APPROVAL';
            const isBusy = busyId === item.id;
            const isRejecting = rejectingId === item.id;

            return (
              <article
                key={item.id}
                className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-5 backdrop-blur-md"
              >
                {/* Evaluator → Team → Level → Score → Status chain */}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className={`rounded-md border px-2 py-0.5 font-bold uppercase ${statusStyles(item.approvalStatus)}`}
                      >
                        {item.approvalStatusLabel}
                      </span>
                      <span className="rounded-md border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 font-bold text-cyan-300">
                        LEVEL {item.level}
                      </span>
                    </div>

                    <h3 className="font-sans text-base font-bold text-white">{item.teamName}</h3>

                    <dl className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
                      <div className="flex gap-1.5">
                        <dt>Evaluator:</dt>
                        <dd className="font-bold text-white">@{item.evaluatorUsername}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Submitted:</dt>
                        <dd>{item.submittedAt ? formatDateTime(item.submittedAt) : '—'} UTC</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-muted-foreground text-[10px] uppercase">Score</div>
                      <div className="text-2xl font-black text-amber-300">
                        {item.score}
                        <span className="text-muted-foreground text-sm"> / {item.maxScore}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Attached Deliverables */}
                {item.files && item.files.length > 0 && (
                  <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-3 text-xs">
                    <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                      ATTACHED DELIVERABLES ({item.files.length})
                    </span>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {item.files.map((file) => (
                        <div
                          key={file.id}
                          className="border-border/80 bg-background/90 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs"
                        >
                          <span className="text-cyan-400">📄</span>
                          <span
                            className="max-w-[220px] truncate font-bold text-white"
                            title={file.originalName}
                          >
                            {file.originalName}
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            ({(file.fileSize / 1024).toFixed(1)} KB)
                          </span>
                          <a
                            href={`/api/evaluator/files/${file.id}`}
                            download
                            className="ml-1 rounded border border-cyan-500/50 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-900/60"
                          >
                            DOWNLOAD
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Evaluator's remarks to the squad */}
                {item.feedback && (
                  <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3 text-xs">
                    <span className="text-muted-foreground text-[10px] uppercase">
                      Evaluator feedback to squad
                    </span>
                    <p className="text-muted-foreground font-sans whitespace-pre-line">
                      {item.feedback}
                    </p>
                  </div>
                )}

                {/* Prior decision */}
                {item.approvalStatus === 'APPROVED' && item.approvedByUsername && (
                  <p className="text-xs text-emerald-300">
                    Approved by @{item.approvedByUsername}
                    {item.approvedAt ? ` on ${formatDateTime(item.approvedAt)} UTC` : ''}. This
                    score is live on the leaderboard.
                  </p>
                )}
                {item.approvalStatus === 'REJECTED' && (
                  <div className="space-y-1 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs">
                    <span className="text-[10px] text-rose-300 uppercase">
                      Rejected
                      {item.rejectedByUsername ? ` by @${item.rejectedByUsername}` : ''}
                      {item.rejectedAt ? ` on ${formatDateTime(item.rejectedAt)} UTC` : ''}
                    </span>
                    <p className="text-muted-foreground font-sans">{item.rejectionReason}</p>
                  </div>
                )}

                {/* Decision controls */}
                {isPending && (
                  <div className="border-border/40 space-y-3 border-t pt-4">
                    {!item.canDecide ? (
                      <p className="text-xs text-amber-300">
                        You authored this evaluation, so another administrator must decide on it.
                      </p>
                    ) : isRejecting ? (
                      <div className="space-y-3">
                        <label
                          htmlFor={`reject-${item.id}`}
                          className="text-muted-foreground block text-[10px] uppercase"
                        >
                          Reason for rejection — the evaluator will see this
                        </label>
                        <textarea
                          id={`reject-${item.id}`}
                          rows={3}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Explain what needs correcting before this score can be approved..."
                          className="border-border/60 bg-background/60 w-full rounded-xl border px-3.5 py-2 font-sans text-xs text-white outline-none focus:border-rose-500/60 focus:ring-2 focus:ring-rose-500/30"
                        />
                        <div className="flex flex-wrap gap-3">
                          <GradientButton
                            variant="magenta"
                            size="sm"
                            isLoading={isBusy}
                            disabled={rejectReason.trim().length < 10}
                            onClick={() => handleReject(item)}
                            className="text-xs font-semibold uppercase"
                          >
                            Confirm rejection
                          </GradientButton>
                          <GradientButton
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRejectingId(null);
                              setRejectReason('');
                            }}
                            className="text-xs font-semibold uppercase"
                          >
                            Cancel
                          </GradientButton>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <GradientButton
                          variant="cyan"
                          size="sm"
                          isLoading={isBusy}
                          onClick={() => handleApprove(item)}
                          className="text-xs font-semibold uppercase"
                        >
                          Approve — publish {item.score} pts
                        </GradientButton>
                        <GradientButton
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRejectingId(item.id);
                            setRejectReason('');
                          }}
                          className="text-xs font-semibold uppercase"
                        >
                          Reject
                        </GradientButton>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
