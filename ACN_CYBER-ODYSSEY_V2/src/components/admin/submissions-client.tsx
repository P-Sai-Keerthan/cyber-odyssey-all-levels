'use client';

import * as React from 'react';
import type { AdminSubmissionItem } from '@/lib/actions/admin-actions';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface SubmissionsClientProps {
  initialSubmissions: AdminSubmissionItem[];
  totalCount: number;
}

export function SubmissionsClient({ initialSubmissions }: SubmissionsClientProps) {
  const [submissions] = React.useState<AdminSubmissionItem[]>(initialSubmissions);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [levelFilter, setLevelFilter] = React.useState('ALL');
  const [statusFilter, setStatusFilter] = React.useState('ALL');

  const filtered = submissions.filter((s) => {
    if (levelFilter !== 'ALL' && s.level !== parseInt(levelFilter, 10)) return false;
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTeam = s.teamName.toLowerCase().includes(q);
      const matchUser = s.submitterUsername.toLowerCase().includes(q);
      if (!matchTeam && !matchUser) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-amber-400 uppercase">
              <span className="size-2 rounded-full bg-amber-400" />
              <span>INTAKE TELEMETRY // SUBMISSIONS</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Investigation Submissions
            </h1>
            <p className="text-muted-foreground font-sans text-sm">
              Read-only operations intake terminal. Monitor deliverable packages and evaluation
              status across all levels.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3.5 py-1.5 font-bold text-amber-300">
              {filtered.length} / {submissions.length} SUBMISSIONS
            </span>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-3">
          <input
            type="text"
            placeholder="Search squad or submitter username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-border/80 bg-background/60 placeholder:text-muted-foreground rounded-xl border px-3.5 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
          />

          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="border-border/80 bg-background/60 rounded-xl border px-3.5 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
          >
            <option value="ALL">All Levels</option>
            <option value="1">Level 1</option>
            <option value="2">Level 2</option>
            <option value="3">Level 3</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border-border/80 bg-background/60 rounded-xl border px-3.5 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
          >
            <option value="ALL">All Submission Statuses</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="UNDER_REVIEW">UNDER_REVIEW</option>
            <option value="ACCEPTED">ACCEPTED / EVALUATED</option>
            <option value="REJECTED">REJECTED / RETURNED</option>
          </select>
        </div>
      </div>

      {/* Submissions Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border shadow-xl backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-border/60 bg-background/40 text-muted-foreground border-b text-[10px] uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Squad / Submitter</th>
                <th className="px-4 py-3 font-semibold">Level</th>
                <th className="px-4 py-3 font-semibold">Files</th>
                <th className="px-4 py-3 font-semibold">Submission Status</th>
                <th className="px-4 py-3 font-semibold">Evaluation Status</th>
                <th className="px-4 py-3 font-semibold">Score</th>
                <th className="px-4 py-3 font-semibold">Submitted At</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground py-12 text-center">
                    No submissions found matching criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-card/40 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-white uppercase">{s.teamName}</div>
                      <div className="text-muted-foreground text-[10px]">
                        By @{s.submitterUsername}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-bold text-cyan-300">LEVEL {s.level}</td>
                    <td className="px-4 py-3.5">
                      <span className="font-bold text-white">{s.fileCount}</span>
                      <span className="text-muted-foreground ml-1 text-[10px]">FILES</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="border-border bg-background/60 rounded-md border px-2 py-0.5 text-[9px] font-bold text-white uppercase">
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {s.evaluationStatus ? (
                        <div>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase ${
                              s.evaluationStatus === 'EVALUATED'
                                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                                : s.evaluationStatus === 'IN_REVIEW'
                                  ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                                  : 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                            }`}
                          >
                            {s.evaluationStatus}
                          </span>
                          {s.evaluatorUsername && (
                            <div className="text-muted-foreground mt-0.5 text-[10px]">
                              @{s.evaluatorUsername}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[11px] italic">PENDING</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {s.score !== null ? (
                        <span className="font-bold text-amber-300">
                          {s.score} / {s.maxScore ?? 100}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-3.5 text-[11px] whitespace-nowrap">
                      {formatDateTime(s.submittedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
