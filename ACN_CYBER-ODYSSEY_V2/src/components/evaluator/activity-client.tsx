'use client';

import * as React from 'react';
import { getEvaluatorActivityLogsAction } from '@/lib/actions/evaluator-actions';
import { formatDateTime } from '@/lib/utils/date-formatter';

interface ActivityLogItem {
  id: string;
  action: string;
  details: string | null;
  createdAt: Date;
  actor: { id: string; username: string; email: string } | null;
}

interface ActivityClientProps {
  initialLogs: ActivityLogItem[];
  totalCount: number;
  totalPages: number;
}

export function EvaluatorActivityClient({
  initialLogs,
  totalCount: initialTotalCount,
  totalPages: initialTotalPages,
}: ActivityClientProps) {
  const [logs, setLogs] = React.useState<ActivityLogItem[]>(initialLogs);
  const [totalCount, setTotalCount] = React.useState(initialTotalCount);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [actionFilter, setActionFilter] = React.useState<string>('ALL');
  const [isLoading, setIsLoading] = React.useState(false);

  const fetchLogs = React.useCallback(async (page: number, action: string) => {
    setIsLoading(true);
    const res = await getEvaluatorActivityLogsAction({
      page,
      limit: 25,
      action: action === 'ALL' ? undefined : action,
    });
    if (res.success && res.data) {
      setLogs(res.data.logs);
      setTotalCount(res.data.totalCount);
      setTotalPages(res.data.totalPages);
      setCurrentPage(page);
    }
    setIsLoading(false);
  }, []);

  const handleActionChange = (action: string) => {
    setActionFilter(action);
    fetchLogs(1, action);
  };

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case 'EVALUATION_SUBMITTED':
        return 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300';
      case 'SCORE_UPDATED':
      case 'EVALUATION_STARTED':
        return 'border-blue-500/40 bg-blue-950/40 text-blue-300';
      case 'SUBMISSION_OPENED':
      case 'FILE_ACCESSED':
        return 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300';
      case 'EVALUATION_RETURNED':
        return 'border-rose-500/40 bg-rose-950/40 text-rose-300';
      default:
        return 'border-border bg-background text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="font-mono text-xs font-semibold tracking-widest text-cyan-400 uppercase">
              AUDIT TRAIL
            </span>
          </div>
          <h1 className="font-mono text-2xl font-black tracking-tight text-white md:text-3xl">
            EVALUATION ACTIVITY TELEMETRY
          </h1>
          <p className="text-muted-foreground text-sm">
            Immutable chronological record of evaluator reviews, evidence inspections, and score
            updates.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3.5 py-1.5 font-mono text-xs font-bold text-cyan-300">
            RECORDED EVENTS: {totalCount}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="border-border/80 bg-card/60 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 font-mono text-xs backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground mr-1 uppercase">ACTION FILTER:</span>
          {[
            { key: 'ALL', label: 'ALL EVENTS' },
            { key: 'EVALUATION_SUBMITTED', label: 'SUBMISSIONS EVALUATED' },
            { key: 'EVALUATION_STARTED', label: 'REVIEW STARTED' },
            { key: 'FILE_ACCESSED', label: 'FILES ACCESSED' },
            { key: 'SUBMISSION_OPENED', label: 'OPENED DELIVERABLES' },
            { key: 'EVALUATION_RETURNED', label: 'RETURNED' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => handleActionChange(item.key)}
              className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                actionFilter === item.key
                  ? 'border border-cyan-500/60 bg-cyan-950/60 text-cyan-300'
                  : 'text-muted-foreground hover:bg-background/60'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Activity Stream Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border font-mono text-xs backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-border/80 bg-background/80 text-muted-foreground border-b text-[11px] uppercase">
              <tr>
                <th className="px-4 py-3.5 font-bold text-cyan-400">TIMESTAMP</th>
                <th className="px-4 py-3.5 font-bold">ACTION</th>
                <th className="px-4 py-3.5 font-bold">EVENT DETAILS</th>
                <th className="px-4 py-3.5 text-right font-bold">EVALUATOR</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground py-12 text-center">
                    No activity records found matching the active filter.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-cyan-950/10">
                    <td className="text-muted-foreground px-4 py-3.5 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${getActionBadgeColor(
                          log.action,
                        )}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="text-foreground max-w-xl px-4 py-3.5 break-words">
                      {log.details || '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap text-cyan-300">
                      @{log.actor?.username || 'SYSTEM'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="border-border/80 bg-background/60 flex items-center justify-between border-t px-4 py-3">
            <span className="text-muted-foreground">
              Page {currentPage} of {totalPages} ({totalCount} total audit records)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchLogs(currentPage - 1, actionFilter)}
                disabled={currentPage <= 1 || isLoading}
                className="border-border/80 hover:bg-card rounded-lg border px-3 py-1 transition-all disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => fetchLogs(currentPage + 1, actionFilter)}
                disabled={currentPage >= totalPages || isLoading}
                className="border-border/80 hover:bg-card rounded-lg border px-3 py-1 transition-all disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
