'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { GradientButton } from '@/components/ui/gradient-button';
import { createCreatorReportAction } from '@/lib/actions/creator-report-actions';
import { REPORT_ISSUE_TYPES, REPORT_ISSUE_LABELS } from '@/lib/reports/constants';

export interface ReportToCreatorButtonProps {
  /** Exactly one of these identifies the subject of the report. */
  teamId?: string | undefined;
  targetUserId?: string | undefined;
  /** Shown in the composer so the Admin can see what they are reporting. */
  subjectLabel: string;
  className?: string;
}

const MIN_DESCRIPTION = 15;

/**
 * Escalates an observation about a squad or participant to the event Creator.
 *
 * The Admin observes but does not act on squads directly — blocking, deleting and
 * credential recovery are Creator authority. This gives the Admin a route to
 * raise a concern without widening their permissions, which is why the button
 * produces a report rather than an action.
 */
export function ReportToCreatorButton({
  teamId,
  targetUserId,
  subjectLabel,
  className = '',
}: ReportToCreatorButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [issueType, setIssueType] = React.useState<string>(REPORT_ISSUE_TYPES[0]);
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  async function send() {
    setBusy(true);
    setError(null);

    const res = await createCreatorReportAction({
      teamId,
      targetUserId,
      issueType,
      description,
    });

    setBusy(false);

    if (res.success) {
      setSent(true);
      setOpen(false);
      setDescription('');
      router.refresh();
      window.setTimeout(() => setSent(false), 4000);
    } else {
      setError(res.error ?? 'Could not send the report.');
    }
  }

  if (sent) {
    return (
      <p
        role="status"
        className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 font-mono text-[11px] text-emerald-200"
      >
        Report sent to the Creator.
      </p>
    );
  }

  if (!open) {
    return (
      <div className={className}>
        <GradientButton
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="text-[11px] font-semibold uppercase"
        >
          Report to Creator
        </GradientButton>
      </div>
    );
  }

  return (
    <div className="border-border/60 bg-background/50 space-y-3 rounded-xl border p-4 font-mono">
      <div className="space-y-1">
        <span className="text-muted-foreground text-[10px] font-bold uppercase">
          Report to Creator
        </span>
        <p className="text-muted-foreground font-sans text-[11px]">
          About <span className="font-bold text-white">{subjectLabel}</span>. The Creator decides
          what action to take.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="report-issue-type"
          className="text-muted-foreground block text-[10px] uppercase"
        >
          Issue type
        </label>
        <select
          id="report-issue-type"
          value={issueType}
          onChange={(e) => setIssueType(e.target.value)}
          className="border-border/60 bg-background/60 w-full rounded-xl border px-3 py-2 text-xs text-white outline-none focus:border-fuchsia-500/60 focus:ring-2 focus:ring-fuchsia-500/30"
        >
          {REPORT_ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {REPORT_ISSUE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="report-description"
          className="text-muted-foreground block text-[10px] uppercase"
        >
          What did you observe?
        </label>
        <textarea
          id="report-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what you saw and why it needs the Creator's attention..."
          className="border-border/60 bg-background/60 w-full rounded-xl border px-3 py-2 font-sans text-xs text-white outline-none focus:border-fuchsia-500/60 focus:ring-2 focus:ring-fuchsia-500/30"
        />
      </div>

      {error && <p className="text-[11px] text-rose-300">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <GradientButton
          variant="cyan"
          size="sm"
          isLoading={busy}
          disabled={description.trim().length < MIN_DESCRIPTION}
          onClick={send}
          className="text-[11px] font-semibold uppercase"
        >
          Send report
        </GradientButton>
        <GradientButton
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-[11px] font-semibold uppercase"
        >
          Cancel
        </GradientButton>
      </div>
    </div>
  );
}
