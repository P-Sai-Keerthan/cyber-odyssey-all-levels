'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  getEvaluatorSubmissionsAction,
  getEvaluatorSquadSubmissionStatusesAction,
  type EvaluatorSubmissionListItem,
  type EvaluatorSubmissionsSummaryStats,
  type EvaluatorSquadSubmissionStatusItem,
} from '@/lib/actions/evaluator-actions';
import { formatDateTime } from '@/lib/utils/date-formatter';

interface SubmissionsClientProps {
  initialSubmissions: EvaluatorSubmissionListItem[];
  totalCount: number;
  totalPages: number;
  initialSummaryStats?: EvaluatorSubmissionsSummaryStats | undefined;
}

export function EvaluatorSubmissionsClient({
  initialSubmissions,
  totalCount: initialTotalCount,
  totalPages: initialTotalPages,
  initialSummaryStats,
}: SubmissionsClientProps) {
  const [submissions, setSubmissions] =
    React.useState<EvaluatorSubmissionListItem[]>(initialSubmissions);
  const [totalCount, setTotalCount] = React.useState(initialTotalCount);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [levelFilter, setLevelFilter] = React.useState<number | undefined>(undefined);
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [summaryStats, setSummaryStats] = React.useState<
    EvaluatorSubmissionsSummaryStats | undefined
  >(initialSummaryStats);

  // Tab switcher: Deliverables Queue vs Squad Submission Tracker (Requirement 11)
  const [activeTab, setActiveTab] = React.useState<'DELIVERABLES' | 'SQUAD_STATUS'>('DELIVERABLES');
  const [squadStatuses, setSquadStatuses] = React.useState<EvaluatorSquadSubmissionStatusItem[]>(
    [],
  );
  const [isSquadLoading, setIsSquadLoading] = React.useState(false);
  const [squadFilter, setSquadFilter] = React.useState<
    'ALL' | 'SUBMITTED_L2' | 'PENDING_L2' | 'NOT_SUBMITTED_L2'
  >('ALL');

  const fetchSubmissions = React.useCallback(
    async (page: number, level?: number, status?: string, search?: string) => {
      setIsLoading(true);
      const res = await getEvaluatorSubmissionsAction({
        page,
        limit: 20,
        level: level && level > 0 ? level : undefined,
        status: status === 'ALL' ? undefined : status,
        search,
      });
      if (res.success && res.data) {
        setSubmissions(res.data.submissions);
        setTotalCount(res.data.totalCount);
        setTotalPages(res.data.totalPages);
        setSummaryStats(res.data.summaryStats);
        setCurrentPage(page);
      }
      setIsLoading(false);
    },
    [],
  );

  const fetchSquadStatuses = React.useCallback(async (search?: string) => {
    setIsSquadLoading(true);
    const res = await getEvaluatorSquadSubmissionStatusesAction({ search });
    if (res.success && res.data) {
      setSquadStatuses(res.data.squads);
    }
    setIsSquadLoading(false);
  }, []);

  React.useEffect(() => {
    if (activeTab === 'SQUAD_STATUS' && squadStatuses.length === 0) {
      void fetchSquadStatuses(searchQuery);
    }
  }, [activeTab, fetchSquadStatuses, searchQuery, squadStatuses.length]);

  const handleFilterChange = (newLevel?: number, newStatus?: string) => {
    const nextLevel = newLevel !== undefined ? newLevel : levelFilter;
    const nextStatus = newStatus !== undefined ? newStatus : statusFilter;
    setLevelFilter(nextLevel);
    setStatusFilter(nextStatus);
    fetchSubmissions(1, nextLevel, nextStatus, searchQuery);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'DELIVERABLES') {
      fetchSubmissions(1, levelFilter, statusFilter, searchQuery);
    } else {
      void fetchSquadStatuses(searchQuery);
    }
  };

  // Filtered squads for tracker view
  const filteredSquads = React.useMemo(() => {
    if (squadFilter === 'SUBMITTED_L2') {
      return squadStatuses.filter((s) => s.level2Submission.submitted);
    }
    if (squadFilter === 'PENDING_L2') {
      return squadStatuses.filter(
        (s) => s.level2Submission.submitted && s.level2Submission.evaluationStatus === 'PENDING',
      );
    }
    if (squadFilter === 'NOT_SUBMITTED_L2') {
      return squadStatuses.filter((s) => !s.level2Submission.submitted);
    }
    return squadStatuses;
  }, [squadStatuses, squadFilter]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="font-mono text-xs font-semibold tracking-widest text-cyan-400 uppercase">
              EVALUATOR INTAKE
            </span>
          </div>
          <h1 className="font-mono text-2xl font-black tracking-tight text-white md:text-3xl">
            SUBMISSIONS TERMINAL
          </h1>
          <p className="text-muted-foreground text-sm">
            Triage forensic evidence packages, verify structured findings, and assign rubric scores.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="bg-card/60 flex items-center rounded-xl border border-cyan-500/30 p-1 font-mono text-xs backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setActiveTab('DELIVERABLES')}
            className={`rounded-lg px-3.5 py-1.5 font-bold transition-all ${
              activeTab === 'DELIVERABLES'
                ? 'border border-cyan-500/50 bg-cyan-950/70 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            DELIVERABLES QUEUE
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('SQUAD_STATUS');
              if (squadStatuses.length === 0) {
                void fetchSquadStatuses(searchQuery);
              }
            }}
            className={`rounded-lg px-3.5 py-1.5 font-bold transition-all ${
              activeTab === 'SQUAD_STATUS'
                ? 'border border-cyan-500/50 bg-cyan-950/70 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            SQUAD STATUS TRACKER
          </button>
        </div>
      </div>

      {/* Summary Counts Bar (Requirement 10) */}
      {summaryStats && (
        <div className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-3 lg:grid-cols-6">
          <div className="bg-card/60 rounded-2xl border border-cyan-500/40 p-3.5 backdrop-blur-xl transition-all hover:border-cyan-400/60">
            <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              TOTAL SUBMISSIONS
            </span>
            <div className="mt-1 text-2xl font-black text-cyan-300">
              {summaryStats.totalSubmissions}
            </div>
            <span className="text-muted-foreground text-[10px]">Deliverable levels</span>
          </div>

          <div className="bg-card/60 rounded-2xl border border-cyan-500/30 p-3.5 backdrop-blur-xl">
            <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              LEVEL 2 FORENSICS
            </span>
            <div className="mt-1 text-2xl font-black text-cyan-400">
              {summaryStats.level2Submissions}
            </div>
            <span className="text-muted-foreground text-[10px]">Investigation reports</span>
          </div>

          <div className="bg-card/60 rounded-2xl border border-purple-500/30 p-3.5 backdrop-blur-xl">
            <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              LEVEL 3 (WEB)
            </span>
            <div className="mt-1 text-2xl font-black text-purple-300">
              {summaryStats.level3Submissions}
            </div>
            <span className="text-muted-foreground text-[10px]">Final reports</span>
          </div>

          <div className="bg-card/60 rounded-2xl border border-amber-500/30 p-3.5 backdrop-blur-xl">
            <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              PENDING
            </span>
            <div className="mt-1 text-2xl font-black text-amber-300">
              {summaryStats.pendingCount}
            </div>
            <span className="text-muted-foreground text-[10px]">Awaiting evaluation</span>
          </div>

          <div className="bg-card/60 rounded-2xl border border-blue-500/30 p-3.5 backdrop-blur-xl">
            <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              IN REVIEW
            </span>
            <div className="mt-1 text-2xl font-black text-blue-300">
              {summaryStats.inReviewCount}
            </div>
            <span className="text-muted-foreground text-[10px]">Under jury review</span>
          </div>

          <div className="bg-card/60 rounded-2xl border border-emerald-500/30 p-3.5 backdrop-blur-xl">
            <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              EVALUATED
            </span>
            <div className="mt-1 text-2xl font-black text-emerald-300">
              {summaryStats.evaluatedCount}
            </div>
            <span className="text-muted-foreground text-[10px]">Scoring completed</span>
          </div>
        </div>
      )}

      {/* Level Architecture Notice Banner (Requirements 1, 9, 15) */}
      <div className="via-card/60 rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/40 to-purple-950/30 p-4 font-mono text-xs backdrop-blur-xl">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-2.5">
            <span className="shrink-0 rounded-md border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
              CORE RULE
            </span>
            <div className="text-muted-foreground space-y-0.5">
              <p>
                <strong className="text-white">Level 1 is automatically scored</strong> via
                authoritative challenge verification (no deliverable submission required).
              </p>
              <p>
                <strong className="text-cyan-300">Level 2 (Forensics)</strong> and{' '}
                <strong className="text-purple-300">Level 3 (Web Security)</strong> are
                submission/evaluation based and reviewed by the jury.
              </p>
            </div>
          </div>
          <Link
            href="/evaluator/teams"
            className="shrink-0 text-[11px] font-bold text-cyan-400 underline decoration-cyan-500/40 underline-offset-4 hover:text-cyan-200"
          >
            Inspect Level 1 Scores in Squad Registry &rarr;
          </Link>
        </div>
      </div>

      {/* TAB 1: DELIVERABLES QUEUE */}
      {activeTab === 'DELIVERABLES' && (
        <div className="space-y-4">
          {/* Filter Controls Bar (Requirement 2 & 15) */}
          <div className="border-border/80 bg-card/60 space-y-3 rounded-2xl border p-4 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Level Filter Buttons — strictly deliverable levels only */}
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-muted-foreground mr-1 uppercase">LEVEL:</span>
                <button
                  type="button"
                  onClick={() => handleFilterChange(undefined, undefined)}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    levelFilter === undefined
                      ? 'border border-cyan-500/60 bg-cyan-950/60 text-cyan-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  ALL
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange(2, undefined)}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    levelFilter === 2
                      ? 'border border-cyan-500/60 bg-cyan-950/60 text-cyan-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  LEVEL 2 (FORENSICS)
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange(3, undefined)}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    levelFilter === 3
                      ? 'border border-purple-500/60 bg-purple-950/60 text-purple-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  LEVEL 3
                </button>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-muted-foreground mr-1 uppercase">STATUS:</span>
                <button
                  type="button"
                  onClick={() => handleFilterChange(undefined, 'ALL')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    statusFilter === 'ALL'
                      ? 'border border-cyan-500/60 bg-cyan-950/60 text-cyan-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  ALL
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange(undefined, 'PENDING')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    statusFilter === 'PENDING'
                      ? 'border border-amber-500/60 bg-amber-950/60 text-amber-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  PENDING
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange(undefined, 'IN_REVIEW')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    statusFilter === 'IN_REVIEW'
                      ? 'border border-blue-500/60 bg-blue-950/60 text-blue-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  IN REVIEW
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange(undefined, 'EVALUATED')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    statusFilter === 'EVALUATED'
                      ? 'border border-emerald-500/60 bg-emerald-950/60 text-emerald-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  EVALUATED
                </button>
              </div>
            </div>

            {/* Search by Squad */}
            <form onSubmit={handleSearchSubmit} className="flex gap-3 pt-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Squad Name, Submitter, or ID..."
                className="border-border/80 bg-background/80 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border px-4 py-2 font-mono text-xs transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-xl border border-cyan-500/50 bg-cyan-950/50 px-5 py-2 font-mono text-xs font-bold text-cyan-300 transition-all hover:bg-cyan-900/60 disabled:opacity-50"
              >
                {isLoading ? 'FILTERING...' : 'APPLY'}
              </button>
            </form>
          </div>

          {/* Submissions Table (Requirement 15) */}
          <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border backdrop-blur-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="border-border/80 bg-background/80 text-muted-foreground border-b text-[11px] uppercase">
                  <tr>
                    <th className="px-4 py-3.5 font-bold text-cyan-400">LEVEL</th>
                    <th className="px-4 py-3.5 font-bold">TEAM / SQUAD</th>
                    <th className="px-4 py-3.5 font-bold">SUBMITTED BY</th>
                    <th className="px-4 py-3.5 font-bold">SUBMITTED AT</th>
                    <th className="px-4 py-3.5 font-bold">DELIVERABLES</th>
                    <th className="px-4 py-3.5 font-bold">STATUS</th>
                    <th className="px-4 py-3.5 font-bold">SCORE</th>
                    <th className="px-4 py-3.5 text-right font-bold">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-border/40 divide-y">
                  {submissions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-muted-foreground py-12 text-center">
                        No deliverable submissions found matching the active filters.
                      </td>
                    </tr>
                  ) : (
                    submissions.map((sub) => (
                      <tr key={sub.id} className="transition-colors hover:bg-cyan-950/10">
                        <td className="px-4 py-3.5 font-bold">
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                              sub.level === 2
                                ? 'border-cyan-500/40 bg-cyan-950/60 text-cyan-300'
                                : 'border-purple-500/40 bg-purple-950/60 text-purple-300'
                            }`}
                          >
                            LEVEL {sub.level}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-white">{sub.teamName}</div>
                          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10px]">
                            <span>ID: {sub.teamId.slice(0, 8)}...</span>
                            <span>&bull;</span>
                            <span>Head: {sub.teamHead}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-white">{sub.submitterName}</div>
                          <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                            <span>{sub.submitterRole}</span>
                          </div>
                        </td>
                        <td className="text-muted-foreground px-4 py-3.5 whitespace-nowrap">
                          {formatDateTime(sub.submittedAt)}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-white">
                              {sub.deliverablesSummary}
                            </span>
                            <div className="flex items-center gap-1 text-[10px]">
                              <span
                                className={`rounded border px-1.5 py-0.5 ${
                                  sub.hasReport
                                    ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                                    : 'border-border/60 text-muted-foreground'
                                }`}
                              >
                                {sub.hasReport ? '✓ Report' : '— No Report'}
                              </span>
                              <span
                                className={`rounded border px-1.5 py-0.5 ${
                                  sub.hasAnswers
                                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                                    : 'border-border/60 text-muted-foreground'
                                }`}
                              >
                                {sub.hasAnswers ? '✓ Answers' : '— No Answers'}
                              </span>
                              <span className="border-border/60 text-muted-foreground rounded border px-1.5 py-0.5">
                                {sub.filesCount} Files
                              </span>
                            </div>
                          </div>
                        </td>
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
                          {sub.score !== null
                            ? `${sub.score}${sub.maxScore ? ` / ${sub.maxScore}` : ''} PTS`
                            : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <Link
                            href={`/evaluator/evaluations/${sub.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-3 py-1 font-mono text-[11px] font-bold text-cyan-200 transition-all hover:bg-cyan-900/60 hover:text-white"
                          >
                            <span>{sub.evaluationStatus === 'EVALUATED' ? 'VIEW' : 'REVIEW'}</span>
                            <span>&rarr;</span>
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
                  Page {currentPage} of {totalPages} ({totalCount} total deliverables)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      fetchSubmissions(currentPage - 1, levelFilter, statusFilter, searchQuery)
                    }
                    disabled={currentPage <= 1 || isLoading}
                    className="border-border/80 hover:bg-card rounded-lg border px-3 py-1 transition-all disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      fetchSubmissions(currentPage + 1, levelFilter, statusFilter, searchQuery)
                    }
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
      )}

      {/* TAB 2: SQUAD SUBMISSION STATUS TRACKER (Requirement 11) */}
      {activeTab === 'SQUAD_STATUS' && (
        <div className="space-y-4">
          {/* Tracker Filters */}
          <div className="border-border/80 bg-card/60 space-y-3 rounded-2xl border p-4 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground mr-1 uppercase">FILTER:</span>
                <button
                  type="button"
                  onClick={() => setSquadFilter('ALL')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    squadFilter === 'ALL'
                      ? 'border border-cyan-500/60 bg-cyan-950/60 text-cyan-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  ALL SQUADS ({squadStatuses.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSquadFilter('SUBMITTED_L2')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    squadFilter === 'SUBMITTED_L2'
                      ? 'border border-emerald-500/60 bg-emerald-950/60 text-emerald-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  SUBMITTED L2 ({squadStatuses.filter((s) => s.level2Submission.submitted).length})
                </button>
                <button
                  type="button"
                  onClick={() => setSquadFilter('PENDING_L2')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    squadFilter === 'PENDING_L2'
                      ? 'border border-amber-500/60 bg-amber-950/60 text-amber-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  PENDING L2 (
                  {
                    squadStatuses.filter(
                      (s) =>
                        s.level2Submission.submitted &&
                        s.level2Submission.evaluationStatus === 'PENDING',
                    ).length
                  }
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setSquadFilter('NOT_SUBMITTED_L2')}
                  className={`rounded-lg px-3 py-1.5 font-bold transition-all ${
                    squadFilter === 'NOT_SUBMITTED_L2'
                      ? 'border border-rose-500/60 bg-rose-950/60 text-rose-300'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  NOT SUBMITTED L2 (
                  {squadStatuses.filter((s) => !s.level2Submission.submitted).length})
                </button>
              </div>

              <span className="text-muted-foreground text-[11px]">
                * Real-time derived status. Zero artificial records created.
              </span>
            </div>

            {/* Search Input for Tracker */}
            <form onSubmit={handleSearchSubmit} className="flex gap-3 pt-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search squad name or member..."
                className="border-border/80 bg-background/80 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border px-4 py-2 font-mono text-xs transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSquadLoading}
                className="rounded-xl border border-cyan-500/50 bg-cyan-950/50 px-5 py-2 font-mono text-xs font-bold text-cyan-300 transition-all hover:bg-cyan-900/60 disabled:opacity-50"
              >
                {isSquadLoading ? 'SEARCHING...' : 'SEARCH'}
              </button>
            </form>
          </div>

          {/* Squad Tracker Matrix Table */}
          <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border backdrop-blur-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="border-border/80 bg-background/80 text-muted-foreground border-b text-[11px] uppercase">
                  <tr>
                    <th className="px-4 py-3.5 font-bold text-cyan-400">SQUAD NAME</th>
                    <th className="px-4 py-3.5 font-bold">TEAM HEAD</th>
                    <th className="px-4 py-3.5 font-bold">LEVEL 1 (AUTOMATIC)</th>
                    <th className="px-4 py-3.5 font-bold">LEVEL 2 (FORENSICS)</th>
                    <th className="px-4 py-3.5 font-bold">LEVEL 3 (WEB)</th>
                    <th className="px-4 py-3.5 text-right font-bold">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-border/40 divide-y">
                  {isSquadLoading ? (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground py-12 text-center">
                        Loading squad submission matrix...
                      </td>
                    </tr>
                  ) : filteredSquads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground py-12 text-center">
                        No squads found matching the active tracker filter.
                      </td>
                    </tr>
                  ) : (
                    filteredSquads.map((squad) => (
                      <tr key={squad.teamId} className="transition-colors hover:bg-cyan-950/10">
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-white">{squad.teamName}</div>
                          <div className="text-muted-foreground text-[10px]">
                            {squad.membersCount} Members &bull; ID: {squad.teamId.slice(0, 8)}...
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-cyan-300">{squad.teamHead}</td>
                        <td className="px-4 py-3.5">
                          <span className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                            ✓ {squad.level1Status.score} PTS ({squad.level1Status.challengesSolved}{' '}
                            Solved)
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {squad.level2Submission.submitted ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-emerald-400">✓ SUBMITTED</span>
                                <span
                                  className={`py-0.2 rounded border px-1.5 text-[9px] font-bold ${
                                    squad.level2Submission.evaluationStatus === 'EVALUATED'
                                      ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                                      : squad.level2Submission.evaluationStatus === 'IN_REVIEW'
                                        ? 'border-blue-500/40 bg-blue-950/40 text-blue-300'
                                        : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                                  }`}
                                >
                                  {squad.level2Submission.evaluationStatus}
                                </span>
                              </div>
                              <span className="text-muted-foreground text-[10px]">
                                {squad.level2Submission.filesCount} Files &bull;{' '}
                                {squad.level2Submission.deliverablesSummary}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground font-semibold">
                              — NOT SUBMITTED
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {squad.level3Submission.submitted ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-purple-400">✓ SUBMITTED</span>
                                <span
                                  className={`py-0.2 rounded border px-1.5 text-[9px] font-bold ${
                                    squad.level3Submission.evaluationStatus === 'EVALUATED'
                                      ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                                      : squad.level3Submission.evaluationStatus === 'IN_REVIEW'
                                        ? 'border-blue-500/40 bg-blue-950/40 text-blue-300'
                                        : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                                  }`}
                                >
                                  {squad.level3Submission.evaluationStatus}
                                </span>
                              </div>
                              <span className="text-muted-foreground text-[10px]">
                                {squad.level3Submission.filesCount} Files
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground font-semibold">
                              — NOT SUBMITTED
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {squad.level2Submission.submitted &&
                          squad.level2Submission.submissionId ? (
                            <Link
                              href={`/evaluator/evaluations/${squad.level2Submission.submissionId}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-2.5 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-900/60"
                            >
                              <span>REVIEW L2</span>
                              <span>&rarr;</span>
                            </Link>
                          ) : squad.level3Submission.submitted &&
                            squad.level3Submission.submissionId ? (
                            <Link
                              href={`/evaluator/evaluations/${squad.level3Submission.submissionId}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-950/30 px-2.5 py-1 text-[11px] font-bold text-purple-300 hover:bg-purple-900/60"
                            >
                              <span>REVIEW L3</span>
                              <span>&rarr;</span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">
                              Awaiting Upload
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
