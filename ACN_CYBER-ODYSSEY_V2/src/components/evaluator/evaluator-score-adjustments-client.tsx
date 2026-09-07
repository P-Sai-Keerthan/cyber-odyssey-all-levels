'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/utils/date-formatter';
import { requestScoreAdjustmentAction } from '@/lib/actions/score-adjustment-actions';
import type { ScoreAdjustmentDTO, ScoreAdjustmentStatus } from '@/lib/score-adjustments/types';

export interface SafeTeamItem {
  id: string;
  name: string;
  code?: string | undefined;
}

export interface EvaluatorScoreAdjustmentsClientProps {
  teams: SafeTeamItem[];
  initialAdjustments: ScoreAdjustmentDTO[];
}

const TABS = [
  { key: 'ALL', label: 'All Requests' },
  { key: 'PENDING', label: 'Pending Approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
] as const;

function statusBadge(status: ScoreAdjustmentStatus, points: number) {
  switch (status) {
    case 'APPROVED':
      return (
        <span className="rounded-full border border-emerald-500/50 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.25)]">
          APPROVED (+{points} PTS)
        </span>
      );
    case 'PENDING':
      return (
        <span className="rounded-full border border-amber-500/50 bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-bold text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]">
          PENDING ADMIN APPROVAL
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

export function EvaluatorScoreAdjustmentsClient({
  teams,
  initialAdjustments,
}: EvaluatorScoreAdjustmentsClientProps) {
  const router = useRouter();

  // Form State
  const [selectedTeamId, setSelectedTeamId] = React.useState<string>(teams[0]?.id || '');
  const [targetLevel, setTargetLevel] = React.useState<1 | 2 | 3>(1);
  const [points, setPoints] = React.useState<number>(25);
  const [justification, setJustification] = React.useState<string>('');
  const [evidenceNotes, setEvidenceNotes] = React.useState<string>('');

  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [feedback, setFeedback] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Requests Feed State
  const [adjustments, setAdjustments] = React.useState<ScoreAdjustmentDTO[]>(initialAdjustments);
  const [activeTab, setActiveTab] = React.useState<string>('ALL');
  const [levelFilter, setLevelFilter] = React.useState<string>('ALL');
  const [searchQuery, setSearchQuery] = React.useState<string>('');

  React.useEffect(() => {
    setAdjustments(initialAdjustments);
  }, [initialAdjustments]);

  // Dynamic submit button label
  const submitButtonLabel = React.useMemo(() => {
    if (isSubmitting) return 'SUBMITTING REQUEST...';
    if (typeof points === 'number' && Number.isInteger(points) && points > 0) {
      return `REQUEST +${points} ADDITIONAL POINTS`;
    }
    return 'REQUEST ADDITIONAL POINTS';
  }, [isSubmitting, points]);

  // Form submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!selectedTeamId) {
      setFeedback({ type: 'error', message: 'Target squad selection is required.' });
      return;
    }

    if (!points || !Number.isInteger(points) || points < 1) {
      setFeedback({
        type: 'error',
        message: 'Points must be a positive whole integer (minimum 1 point).',
      });
      return;
    }

    if (!justification.trim() || justification.trim().length < 10) {
      setFeedback({
        type: 'error',
        message: 'Justification must be at least 10 characters explaining the technical basis.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await requestScoreAdjustmentAction({
        teamId: selectedTeamId,
        level: targetLevel,
        points,
        reason: justification.trim(),
        evidenceNote: evidenceNotes.trim() || undefined,
      });

      if (res.success && res.data) {
        setAdjustments((prev) => [res.data, ...prev]);
        setJustification('');
        setEvidenceNotes('');
        setFeedback({
          type: 'success',
          message: `Score adjustment request for +${res.data.points} PTS (Level ${res.data.level}) submitted! It is now PENDING Admin review.`,
        });
        router.refresh();
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'Failed to submit score adjustment request.',
        });
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'A network error occurred while submitting. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered requests list
  const filteredAdjustments = adjustments.filter((item) => {
    if (activeTab !== 'ALL' && item.status !== activeTab) return false;
    if (levelFilter !== 'ALL' && item.level !== parseInt(levelFilter, 10)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTeam = item.teamName.toLowerCase().includes(q);
      const matchReason = item.reason.toLowerCase().includes(q);
      const matchEvidence = item.evidenceNote?.toLowerCase().includes(q);
      const matchRequester = item.requestedByUsername.toLowerCase().includes(q);
      if (!matchTeam && !matchReason && !matchEvidence && !matchRequester) {
        return false;
      }
    }
    return true;
  });

  const pendingCount = adjustments.filter((a) => a.status === 'PENDING').length;

  return (
    <div className="space-y-8 font-mono">
      {/* Top Header */}
      <div className="border-border/80 flex flex-col gap-2 border-b pb-5">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
          <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase">
            DISCRETIONARY ALLOCATION // ADMIN SUPERVISED
          </span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">
          ADDITIONAL POINTS REQUEST
        </h1>
        <p className="text-muted-foreground max-w-3xl text-xs leading-relaxed">
          Recommend bonus or adjustment points for technical excellence, novel exploitation vectors,
          exceptional investigation work, or exceptional reports. All adjustments require Admin
          verification and approval before reflecting on the public leaderboard.
        </p>
      </div>

      {/* Alert Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-xl border p-4 text-xs font-bold ${
            feedback.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[10px] font-bold uppercase hover:underline"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* SCORE ADJUSTMENT FORM */}
      <div className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-xl backdrop-blur-xl md:p-8">
        <div className="border-border/60 flex items-center justify-between border-b pb-4">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold tracking-wider text-cyan-400 uppercase">
              NEW ALLOCATION PROPOSAL
            </span>
            <h2 className="text-lg font-black text-white">SUBMIT ADJUSTMENT PROPOSAL</h2>
          </div>
          <span className="rounded-md border border-cyan-500/30 bg-cyan-950/40 px-2.5 py-1 text-[10px] font-bold text-cyan-300">
            JURY DESK
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {/* TARGET SQUAD * */}
            <div className="space-y-1.5 md:col-span-1">
              <label
                htmlFor="target-squad-select"
                className="text-muted-foreground block text-[11px] font-bold tracking-wider uppercase"
              >
                TARGET SQUAD *
              </label>
              <select
                id="target-squad-select"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                disabled={isSubmitting || teams.length === 0}
                className="border-border/80 bg-background/90 w-full rounded-xl border p-2.5 text-xs font-bold text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              >
                {teams.length === 0 ? (
                  <option value="">No active squads available</option>
                ) : (
                  teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.code ? `(${t.code})` : ''}
                    </option>
                  ))
                )}
              </select>
              <p className="text-muted-foreground text-[10px]">
                Safe squad identifier; no credentials or private data exposed.
              </p>
            </div>

            {/* TARGET LEVEL * */}
            <div className="space-y-1.5 md:col-span-1">
              <label
                htmlFor="target-level-select"
                className="text-muted-foreground block text-[11px] font-bold tracking-wider uppercase"
              >
                TARGET LEVEL *
              </label>
              <select
                id="target-level-select"
                value={targetLevel}
                onChange={(e) => setTargetLevel((Number(e.target.value) as 1 | 2 | 3) || 1)}
                disabled={isSubmitting}
                className="border-border/80 bg-background/90 w-full rounded-xl border p-2.5 text-xs font-bold text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              >
                <option value={1}>LEVEL 1</option>
                <option value={2}>LEVEL 2</option>
                <option value={3}>LEVEL 3</option>
              </select>
              <p className="text-muted-foreground text-[10px]">
                Phase under which these adjustment points are recorded.
              </p>
            </div>

            {/* ADDITIONAL POINTS * */}
            <div className="space-y-1.5 md:col-span-1">
              <label
                htmlFor="target-points-input"
                className="text-muted-foreground block text-[11px] font-bold tracking-wider uppercase"
              >
                ADDITIONAL POINTS *
              </label>
              <input
                id="target-points-input"
                type="number"
                min={1}
                step={1}
                value={points}
                onChange={(e) => setPoints(parseInt(e.target.value, 10) || 0)}
                disabled={isSubmitting}
                placeholder="e.g. 25"
                className="border-border/80 bg-background/90 w-full rounded-xl border p-2.5 text-xs font-black text-amber-300 focus:border-amber-500 focus:outline-none disabled:opacity-50"
              />
              <p className="text-muted-foreground text-[10px]">
                Positive integer. No arbitrary cap imposed.
              </p>
            </div>
          </div>

          {/* JUSTIFICATION / RATIONALE * */}
          <div className="space-y-1.5">
            <label
              htmlFor="target-justification-input"
              className="text-muted-foreground block text-[11px] font-bold tracking-wider uppercase"
            >
              JUSTIFICATION / RATIONALE (REQUIRED, MIN 10 CHARS) *
            </label>
            <textarea
              id="target-justification-input"
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              disabled={isSubmitting}
              placeholder="Explain why the points are justified (e.g. exceptional technical work, novel exploitation technique, strong evidence correlation, exceptional forensic analysis, unusual investigation depth, outstanding report quality)..."
              className="border-border/80 bg-background/80 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border p-3 text-xs focus:border-amber-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* EVIDENCE REFERENCE / NOTES */}
          <div className="space-y-1.5">
            <label
              htmlFor="target-evidence-input"
              className="text-muted-foreground block text-[11px] font-bold tracking-wider uppercase"
            >
              EVIDENCE REFERENCE / NOTES (OPTIONAL)
            </label>
            <textarea
              id="target-evidence-input"
              rows={2}
              value={evidenceNotes}
              onChange={(e) => setEvidenceNotes(e.target.value)}
              disabled={isSubmitting}
              placeholder="Reference specific submission artifacts, exhibit files, station identifiers, timestamps, or supporting notes..."
              className="border-border/80 bg-background/80 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border p-3 text-xs focus:border-amber-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* SUBMIT BUTTON */}
          <div className="flex flex-col items-start justify-between gap-3 pt-2 sm:flex-row sm:items-center">
            <span className="text-muted-foreground text-[11px]">
              Submission creates a PENDING request. Points only reflect on the leaderboard after
              Admin approval.
            </span>
            <button
              type="submit"
              disabled={
                isSubmitting || !selectedTeamId || points < 1 || justification.trim().length < 10
              }
              className="flex items-center gap-2 rounded-xl border border-amber-400 bg-amber-500 px-6 py-2.5 text-xs font-black text-black shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all hover:bg-amber-400 disabled:opacity-50"
            >
              {submitButtonLabel}
            </button>
          </div>
        </form>
      </div>

      {/* REQUEST LIST FEED (BELOW FORM) */}
      <div className="space-y-4">
        <div className="border-border/80 flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-black tracking-wide text-white uppercase">
              SCORE ADJUSTMENT REQUESTS HISTORY ({adjustments.length})
            </span>
            {pendingCount > 0 && (
              <span className="rounded-full border border-amber-500/50 bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]">
                {pendingCount} PENDING
              </span>
            )}
          </div>

          {/* Filter Tabs & Search */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                    activeTab === t.key
                      ? 'border border-cyan-500/50 bg-cyan-950/60 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.2)]'
                      : 'border-border/60 bg-card/40 text-muted-foreground border hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="border-border/80 bg-background/80 text-foreground rounded-lg border px-2.5 py-1 text-xs focus:border-cyan-500 focus:outline-none"
              >
                <option value="ALL">ALL LEVELS</option>
                <option value="1">LEVEL 1</option>
                <option value="2">LEVEL 2</option>
                <option value="3">LEVEL 3</option>
              </select>
            </div>

            <input
              type="text"
              placeholder="Search squad, rationale..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-border/80 bg-background/80 placeholder:text-muted-foreground/60 w-48 rounded-lg border px-3 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Requests Feed Cards */}
        {filteredAdjustments.length === 0 ? (
          <div className="border-border/80 bg-card/40 flex flex-col items-center justify-center rounded-2xl border p-10 text-center backdrop-blur-xl">
            <span className="text-muted-foreground text-xs font-bold uppercase">
              NO SCORE ADJUSTMENTS FOUND
            </span>
            <p className="text-muted-foreground mt-1 text-[11px]">
              {activeTab === 'PENDING'
                ? 'No pending score adjustment requests awaiting review.'
                : 'No adjustment requests matching the current filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAdjustments.map((adj) => (
              <div
                key={adj.id}
                className="border-border/80 bg-card/70 hover:border-border space-y-3 rounded-xl border p-4 backdrop-blur-xl transition-all"
              >
                <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                      LEVEL {adj.level}
                    </span>
                    <h3 className="text-sm font-black tracking-wide text-white">{adj.teamName}</h3>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-base font-black text-amber-300">+{adj.points} PTS</span>
                    {statusBadge(adj.status, adj.points)}
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground font-bold">Rationale: </span>
                    <span className="text-foreground/90 whitespace-pre-wrap">{adj.reason}</span>
                  </div>

                  {adj.evidenceNote && (
                    <div className="text-muted-foreground text-[11px]">
                      <span className="text-muted-foreground/80 font-bold">Evidence / Notes: </span>
                      <span className="whitespace-pre-wrap">{adj.evidenceNote}</span>
                    </div>
                  )}
                </div>

                {/* Audit & Review Metadata Footer */}
                <div className="border-border/40 text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-[10px]">
                  <div>
                    <span>Requested by </span>
                    <span className="font-bold text-cyan-300">@{adj.requestedByUsername}</span>
                    <span> &bull; {formatDateTime(adj.createdAt)}</span>
                  </div>

                  {adj.status === 'APPROVED' && adj.reviewedByUsername && (
                    <div className="font-bold text-emerald-400">
                      Approved by @{adj.reviewedByUsername} at{' '}
                      {adj.reviewedAt ? formatDateTime(adj.reviewedAt) : 'N/A'}
                    </div>
                  )}

                  {adj.status === 'REJECTED' && adj.rejectionReason && (
                    <div className="font-bold text-rose-400">
                      Rejected by @{adj.reviewedByUsername || 'Admin'}: &ldquo;
                      {adj.rejectionReason}&rdquo;{' '}
                      {adj.reviewedAt ? `(${formatDateTime(adj.reviewedAt)})` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
