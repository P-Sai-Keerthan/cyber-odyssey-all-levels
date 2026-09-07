'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  getEvaluatorSubmissionsAction,
  type EvaluatorSubmissionListItem,
} from '@/lib/actions/evaluator-actions';
import { formatDate } from '@/lib/utils/date-formatter';

interface EvaluationsClientProps {
  initialSubmissions: EvaluatorSubmissionListItem[];
  totalCount: number;
  totalPages: number;
}

export function EvaluatorEvaluationsClient({
  initialSubmissions,
  totalCount: initialTotalCount,
  totalPages: initialTotalPages,
}: EvaluationsClientProps) {
  const [submissions, setSubmissions] =
    React.useState<EvaluatorSubmissionListItem[]>(initialSubmissions);
  const [totalCount, setTotalCount] = React.useState(initialTotalCount);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState<string>('EVALUATED');
  const [isLoading, setIsLoading] = React.useState(false);

  const fetchEvaluations = React.useCallback(async (page: number, status: string) => {
    setIsLoading(true);
    const res = await getEvaluatorSubmissionsAction({
      page,
      limit: 20,
      status: status === 'ALL' ? undefined : status,
    });
    if (res.success && res.data) {
      setSubmissions(res.data.submissions);
      setTotalCount(res.data.totalCount);
      setTotalPages(res.data.totalPages);
      setCurrentPage(page);
    }
    setIsLoading(false);
  }, []);

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    fetchEvaluations(1, status);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="font-mono text-xs font-semibold tracking-widest text-cyan-400 uppercase">
              JURY EVALUATIONS
            </span>
          </div>
          <h1 className="font-mono text-2xl font-black tracking-tight text-white md:text-3xl">
            COMPLETED & IN-REVIEW EVALUATIONS
          </h1>
          <p className="text-muted-foreground text-sm">
            Audited jury score records, rubric marks allocation, and evaluator feedback.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3.5 py-1.5 font-mono text-xs font-bold text-cyan-300">
            TOTAL EVALUATIONS: {totalCount}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="border-border/80 bg-card/60 flex items-center justify-between rounded-2xl border p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-muted-foreground uppercase">FILTER BY STATUS:</span>
          <button
            type="button"
            onClick={() => handleStatusChange('EVALUATED')}
            className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
              statusFilter === 'EVALUATED'
                ? 'border border-emerald-500/60 bg-emerald-950/60 text-emerald-300'
                : 'text-muted-foreground hover:bg-background/60'
            }`}
          >
            COMPLETED ({statusFilter === 'EVALUATED' ? totalCount : '—'})
          </button>
          <button
            type="button"
            onClick={() => handleStatusChange('IN_REVIEW')}
            className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
              statusFilter === 'IN_REVIEW'
                ? 'border border-blue-500/60 bg-blue-950/60 text-blue-300'
                : 'text-muted-foreground hover:bg-background/60'
            }`}
          >
            IN REVIEW
          </button>
          <button
            type="button"
            onClick={() => handleStatusChange('RETURNED')}
            className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
              statusFilter === 'RETURNED'
                ? 'border border-rose-500/60 bg-rose-950/60 text-rose-300'
                : 'text-muted-foreground hover:bg-background/60'
            }`}
          >
            RETURNED
          </button>
          <button
            type="button"
            onClick={() => handleStatusChange('ALL')}
            className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
              statusFilter === 'ALL'
                ? 'border border-cyan-500/60 bg-cyan-950/60 text-cyan-300'
                : 'text-muted-foreground hover:bg-background/60'
            }`}
          >
            ALL STATUSES
          </button>
        </div>
      </div>

      {/* Evaluations Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="border-border/80 bg-background/80 text-muted-foreground border-b text-[11px] uppercase">
              <tr>
                <th className="px-4 py-3.5 font-bold text-cyan-400">SQUAD NAME</th>
                <th className="px-4 py-3.5 font-bold">LEVEL</th>
                <th className="px-4 py-3.5 font-bold">EVALUATION STATUS</th>
                <th className="px-4 py-3.5 font-bold">SCORE ASSIGNED</th>
                <th className="px-4 py-3.5 font-bold">ADMIN DECISION</th>
                <th className="px-4 py-3.5 font-bold">EVALUATOR</th>
                <th className="px-4 py-3.5 font-bold">SUBMITTED AT</th>
                <th className="px-4 py-3.5 text-right font-bold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted-foreground py-12 text-center">
                    No evaluations found matching the selected filter.
                  </td>
                </tr>
              ) : (
                submissions.map((sub) => (
                  <tr key={sub.id} className="transition-colors hover:bg-cyan-950/10">
                    <td className="px-4 py-3.5 font-bold text-white">{sub.teamName}</td>
                    <td className="px-4 py-3.5 font-bold text-cyan-300">LEVEL {sub.level}</td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          sub.evaluationStatus === 'EVALUATED'
                            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                            : sub.evaluationStatus === 'IN_REVIEW'
                              ? 'border-blue-500/40 bg-blue-950/40 text-blue-300'
                              : sub.evaluationStatus === 'RETURNED'
                                ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                                : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                        }`}
                      >
                        {sub.evaluationStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-bold text-amber-300">
                      {sub.score !== null ? `${sub.score} / 100 PTS` : 'PENDING'}
                    </td>
                    <td className="px-4 py-3.5">
                      {sub.approvalStatus ? (
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                            sub.approvalStatus === 'APPROVED'
                              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                              : sub.approvalStatus === 'REJECTED'
                                ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                                : sub.approvalStatus === 'PENDING_APPROVAL'
                                  ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                                  : 'border-border/60 bg-background/40 text-muted-foreground'
                          }`}
                        >
                          {sub.approvalStatusLabel}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {sub.approvalStatus === 'REJECTED' && sub.rejectionReason && (
                        <p className="text-muted-foreground mt-1.5 max-w-xs font-sans text-[11px] leading-relaxed">
                          <span className="font-semibold text-rose-300">
                            Returned for correction:
                          </span>{' '}
                          {sub.rejectionReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-cyan-300">{sub.evaluatedBy || 'UNASSIGNED'}</td>
                    <td className="text-muted-foreground px-4 py-3.5">
                      {formatDate(sub.submittedAt)}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/evaluator/evaluations/${sub.id}`}
                        className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-1 text-[11px] font-bold text-cyan-300 transition-all hover:bg-cyan-900/60"
                      >
                        INSPECT RUBRIC
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="border-border/80 bg-background/60 flex items-center justify-between border-t px-4 py-3 font-mono text-xs">
            <span className="text-muted-foreground">
              Page {currentPage} of {totalPages} ({totalCount} total items)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchEvaluations(currentPage - 1, statusFilter)}
                disabled={currentPage <= 1 || isLoading}
                className="border-border/80 hover:bg-card rounded-lg border px-3 py-1 transition-all disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => fetchEvaluations(currentPage + 1, statusFilter)}
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
