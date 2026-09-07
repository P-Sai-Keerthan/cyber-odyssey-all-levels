'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { GradientButton } from '@/components/ui/gradient-button';
import { formatDateTime } from '@/lib/utils/date-formatter';
import {
  resolveCreatorReportAction,
  type CreatorReportItem,
} from '@/lib/actions/creator-report-actions';

export interface CreatorReportsClientProps {
  reports: CreatorReportItem[];
  openCount: number;
  /**
   * CREATOR sees an actionable inbox; ADMIN sees a read-only record of what has
   * been raised. One component serves both so the two portals cannot drift apart
   * in how a report is presented.
   */
  mode: 'CREATOR' | 'ADMIN';
}

const ISSUE_LABELS: Record<string, string> = {
  TEAM_CONDUCT: 'Squad conduct',
  PARTICIPANT_CONDUCT: 'Participant conduct',
  TECHNICAL: 'Technical',
  SUBMISSION: 'Submission',
  OTHER: 'Other',
};

function statusStyles(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'border-amber-500/40 bg-amber-950/40 text-amber-300';
    case 'ACKNOWLEDGED':
      return 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300';
    case 'RESOLVED':
      return 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300';
    default:
      return 'border-border/60 bg-background/40 text-muted-foreground';
  }
}

export function CreatorReportsClient({ reports, openCount, mode }: CreatorReportsClientProps) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState('ALL');

  const visible = reports.filter((r) => filter === 'ALL' || r.status === filter);

  async function decide(id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') {
    setBusyId(id);
    setError(null);
    const res = await resolveCreatorReportAction(id, status);
    setBusyId(null);
    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Could not update the report.');
    }
  }

  return (
    <div className="space-y-6 font-mono">
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-fuchsia-400 uppercase">
              <span className="size-2 rounded-full bg-fuchsia-400" />
              <span>{mode === 'CREATOR' ? 'ESCALATIONS INBOX' : 'REPORTS RAISED'}</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {mode === 'CREATOR' ? 'Reports from Admins' : 'Reports to the Creator'}
            </h1>
            <p className="text-muted-foreground max-w-2xl font-sans text-sm">
              {mode === 'CREATOR'
                ? 'Issues raised by event administrators about squads and participants. Administrators observe and escalate; acting on a squad is your authority.'
                : 'Issues you and other administrators have escalated to the event Creator. Squad and account actions are taken by the Creator.'}
            </p>
          </div>

          <span className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3.5 py-1.5 text-xs font-bold text-amber-300">
            {openCount} OPEN
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-6">
          {['ALL', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={filter === s}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase transition-colors ${
                filter === s
                  ? 'border-fuchsia-500/60 bg-fuchsia-950/50 text-fuchsia-200'
                  : 'border-border/60 bg-background/40 text-muted-foreground hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200"
        >
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="border-border/60 bg-card/40 space-y-2 rounded-2xl border p-12 text-center">
          <h2 className="text-sm font-bold text-white uppercase">No reports</h2>
          <p className="text-muted-foreground mx-auto max-w-md font-sans text-xs">
            {mode === 'CREATOR'
              ? 'Administrators have not escalated any issues. Reports appear here as they are raised.'
              : 'You have not raised any reports. Use the Report to Creator action on a squad or participant.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((r) => (
            <article
              key={r.id}
              className="border-border/80 bg-card/60 space-y-3 rounded-2xl border p-5 backdrop-blur-md"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`rounded-md border px-2 py-0.5 font-bold uppercase ${statusStyles(r.status)}`}
                    >
                      {r.status}
                    </span>
                    <span className="border-border/60 bg-background/50 text-muted-foreground rounded-md border px-2 py-0.5 font-bold uppercase">
                      {ISSUE_LABELS[r.issueType] ?? r.issueType}
                    </span>
                  </div>
                  <h3 className="font-sans text-sm font-bold text-white">
                    {r.teamName ? `Squad: ${r.teamName}` : null}
                    {r.teamName && r.targetUsername ? ' · ' : null}
                    {r.targetUsername ? `Participant: @${r.targetUsername}` : null}
                  </h3>
                  <p className="text-muted-foreground text-[11px]">
                    Raised by @{r.authorUsername} on {formatDateTime(r.createdAt)} UTC
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground border-border/60 bg-background/50 rounded-xl border p-3 font-sans text-xs whitespace-pre-line">
                {r.description}
              </p>

              {r.status === 'RESOLVED' && (
                <p className="text-xs text-emerald-300">
                  Resolved{r.resolvedByUsername ? ` by @${r.resolvedByUsername}` : ''}
                  {r.resolvedAt ? ` on ${formatDateTime(r.resolvedAt)} UTC` : ''}.
                </p>
              )}

              {mode === 'CREATOR' && r.status !== 'RESOLVED' && (
                <div className="border-border/40 flex flex-wrap gap-3 border-t pt-3">
                  {r.status === 'OPEN' && (
                    <GradientButton
                      variant="outline"
                      size="sm"
                      isLoading={busyId === r.id}
                      onClick={() => decide(r.id, 'ACKNOWLEDGED')}
                      className="text-xs font-semibold uppercase"
                    >
                      Acknowledge
                    </GradientButton>
                  )}
                  <GradientButton
                    variant="cyan"
                    size="sm"
                    isLoading={busyId === r.id}
                    onClick={() => decide(r.id, 'RESOLVED')}
                    className="text-xs font-semibold uppercase"
                  >
                    Mark resolved
                  </GradientButton>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
