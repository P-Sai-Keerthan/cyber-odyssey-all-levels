'use client';

import * as React from 'react';
import {
  getEvaluatorTeamsAction,
  getEvaluatorTeamDetailsAction,
  type EvaluatorTeamListItem,
  type EvaluatorTeamDetail,
} from '@/lib/actions/evaluator-actions';
import { formatDate, formatDateTime } from '@/lib/utils/date-formatter';

interface TeamsClientProps {
  initialTeams: EvaluatorTeamListItem[];
  totalCount: number;
  totalPages: number;
}

export function EvaluatorTeamsClient({
  initialTeams,
  totalCount: initialTotalCount,
  totalPages: initialTotalPages,
}: TeamsClientProps) {
  const [teams, setTeams] = React.useState<EvaluatorTeamListItem[]>(initialTeams);
  const [totalCount, setTotalCount] = React.useState(initialTotalCount);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  // Team detail drawer state
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);
  const [teamDetail, setTeamDetail] = React.useState<EvaluatorTeamDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const fetchTeams = React.useCallback(async (page: number, search: string) => {
    setIsLoading(true);
    const res = await getEvaluatorTeamsAction({ page, limit: 20, search });
    if (res.success && res.data) {
      setTeams(res.data.teams);
      setTotalCount(res.data.totalCount);
      setTotalPages(res.data.totalPages);
      setCurrentPage(page);
    }
    setIsLoading(false);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTeams(1, searchQuery);
  };

  const handleOpenDetail = async (teamId: string) => {
    setSelectedTeamId(teamId);
    setDetailLoading(true);
    const res = await getEvaluatorTeamDetailsAction(teamId);
    if (res.success && res.data) {
      setTeamDetail(res.data);
    }
    setDetailLoading(false);
  };

  const handleCloseDetail = () => {
    setSelectedTeamId(null);
    setTeamDetail(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="font-mono text-xs font-semibold tracking-widest text-cyan-400 uppercase">
              SQUAD REGISTRY
            </span>
          </div>
          <h1 className="font-mono text-2xl font-black tracking-tight text-white md:text-3xl">
            PARTICIPATING SQUADS
          </h1>
          <p className="text-muted-foreground text-sm">
            Inspect squad rosters, verified score standings, and investigation level progression.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3.5 py-1.5 font-mono text-xs font-bold text-cyan-300">
            TOTAL SQUADS: {totalCount}
          </span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-4 backdrop-blur-xl">
        <form onSubmit={handleSearchSubmit} className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Squad Name, ID, or Member username..."
              className="border-border/80 bg-background/80 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border px-4 py-2.5 font-mono text-xs transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  fetchTeams(1, '');
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs"
              >
                CLEAR
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-950/50 px-5 py-2.5 font-mono text-xs font-bold text-cyan-300 transition-all hover:bg-cyan-900/60 disabled:opacity-50"
          >
            {isLoading ? 'SEARCHING...' : 'SEARCH'}
          </button>
        </form>
      </div>

      {/* Teams Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="border-border/80 bg-background/80 text-muted-foreground border-b text-[11px] uppercase">
              <tr>
                <th className="px-4 py-3.5 font-bold text-cyan-400">SQUAD ID</th>
                <th className="px-4 py-3.5 font-bold">SQUAD NAME</th>
                <th className="px-4 py-3.5 font-bold">TEAM HEAD</th>
                <th className="px-4 py-3.5 font-bold">MEMBERS</th>
                <th className="px-4 py-3.5 font-bold">CURRENT LEVEL</th>
                <th className="px-4 py-3.5 font-bold">SCORE</th>
                <th className="px-4 py-3.5 font-bold">SUBMISSION STATUS</th>
                <th className="px-4 py-3.5 text-right font-bold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {teams.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted-foreground py-12 text-center">
                    No participating squads match your search criteria.
                  </td>
                </tr>
              ) : (
                teams.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-cyan-950/10">
                    <td className="text-muted-foreground px-4 py-3.5">{t.id.slice(0, 10)}...</td>
                    <td className="px-4 py-3.5 font-bold text-white">{t.name}</td>
                    <td className="px-4 py-3.5 text-cyan-300">{t.teamHead}</td>
                    <td className="px-4 py-3.5">
                      <span className="border-border/80 bg-background/60 rounded-md border px-2 py-0.5 font-mono text-[10px]">
                        {t.membersCount} Members
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded-md border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 font-bold text-cyan-300">
                        LEVEL {t.currentLevel}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-bold text-amber-300">{t.score} PTS</td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          t.submissionStatus === 'ACCEPTED'
                            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                            : t.submissionStatus === 'SUBMITTED' ||
                                t.submissionStatus === 'UNDER_REVIEW'
                              ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                              : t.submissionStatus === 'REJECTED'
                                ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                                : 'border-border bg-background/60 text-muted-foreground'
                        }`}
                      >
                        {t.submissionStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(t.id)}
                        className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-1 text-[11px] font-bold text-cyan-300 transition-all hover:bg-cyan-900/60"
                      >
                        INSPECT ROSTER
                      </button>
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
              Page {currentPage} of {totalPages} ({totalCount} total squads)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchTeams(currentPage - 1, searchQuery)}
                disabled={currentPage <= 1 || isLoading}
                className="border-border/80 hover:bg-card rounded-lg border px-3 py-1 transition-all disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => fetchTeams(currentPage + 1, searchQuery)}
                disabled={currentPage >= totalPages || isLoading}
                className="border-border/80 hover:bg-card rounded-lg border px-3 py-1 transition-all disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Team Detail Modal Drawer (Requirement 5 & 14) */}
      {selectedTeamId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={handleCloseDetail}
          aria-modal="true"
        >
          <div
            className="border-border/80 bg-card/95 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-6 font-mono shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading || !teamDetail ? (
              <div className="py-12 text-center">
                <span className="text-xs font-bold text-cyan-400">LOADING SQUAD PROFILE...</span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Modal Header */}
                <div className="border-border/80 flex items-start justify-between border-b pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-cyan-400" />
                      <span className="text-muted-foreground text-[10px] uppercase">
                        SQUAD ROSTER & METRICS
                      </span>
                    </div>
                    <h2 className="text-xl font-bold text-white">{teamDetail.name}</h2>
                    <span className="text-muted-foreground text-xs">ID: {teamDetail.id}</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCloseDetail}
                    className="text-muted-foreground hover:text-foreground rounded-lg p-1.5"
                    aria-label="Close squad modal"
                  >
                    <svg
                      className="size-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* Score Breakdown (Requirement 14) */}
                <div className="border-border/80 bg-background/60 space-y-3 rounded-xl border p-4">
                  <div className="text-muted-foreground text-xs font-bold uppercase">
                    OFFICIAL SCORE BREAKDOWN
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="border-border/60 bg-card/40 rounded-lg border p-2.5">
                      <div className="text-muted-foreground text-[10px]">LEVEL 1</div>
                      <div className="text-base font-bold text-white">
                        {teamDetail.levelScores.level1} PTS
                      </div>
                    </div>
                    <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 p-2.5">
                      <div className="text-[10px] text-cyan-300">LEVEL 2</div>
                      <div className="text-base font-bold text-cyan-200">
                        {teamDetail.levelScores.level2} PTS
                      </div>
                    </div>
                    <div className="border-border/60 bg-card/40 rounded-lg border p-2.5">
                      <div className="text-muted-foreground text-[10px]">LEVEL 3</div>
                      <div className="text-base font-bold text-white">
                        {teamDetail.levelScores.level3} PTS
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-2.5">
                      <div className="text-[10px] text-amber-300">TOTAL</div>
                      <div className="text-base font-bold text-amber-200">
                        {teamDetail.levelScores.total} PTS
                      </div>
                    </div>
                  </div>
                </div>

                {/* Squad Members Roster (Requirement 5 & 28: Team Head, Member 1, Member 2, Member 3) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-bold uppercase">
                      SQUAD ROSTER ({teamDetail.roster.length} MEMBERS)
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      PRIVACY PROTECTED (NO JOIN CODES)
                    </span>
                  </div>

                  <div className="divide-border/60 border-border/80 bg-background/60 divide-y rounded-xl border">
                    {teamDetail.roster.map((member, idx) => (
                      <div
                        key={member.userId}
                        className="flex items-center justify-between p-3 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className="bg-card text-muted-foreground rounded px-2 py-0.5 text-[10px] font-bold">
                            {idx === 0 ? 'TEAM HEAD' : `MEMBER ${idx}`}
                          </span>
                          <div className="flex flex-col">
                            <span className="font-bold text-white">@{member.username}</span>
                            <span className="text-muted-foreground text-[10px]">
                              {member.email}
                            </span>
                          </div>
                        </div>
                        <span className="text-muted-foreground text-[10px]">
                          Joined: {formatDate(member.joinedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Submissions History for this team */}
                <div className="space-y-3">
                  <span className="text-muted-foreground text-xs font-bold uppercase">
                    SUBMITTED DELIVERABLES
                  </span>
                  {teamDetail.submissions.length === 0 ? (
                    <div className="border-border/60 bg-background/40 text-muted-foreground rounded-xl border p-4 text-center text-xs">
                      No investigation deliverables submitted yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {teamDetail.submissions.map((sub) => (
                        <div
                          key={sub.id}
                          className="border-border/60 bg-background/60 flex items-center justify-between rounded-xl border p-3 text-xs"
                        >
                          <div>
                            <span className="font-bold text-cyan-300">LEVEL {sub.level}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatDateTime(sub.submittedAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="bg-card rounded px-2 py-0.5 text-[10px] font-bold">
                              {sub.status}
                            </span>
                            {sub.score !== null && (
                              <span className="font-bold text-amber-300">{sub.score} PTS</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer close */}
                <div className="border-border/80 flex justify-end border-t pt-2">
                  <button
                    type="button"
                    onClick={handleCloseDetail}
                    className="border-border/80 bg-background hover:bg-card rounded-xl border px-4 py-2 text-xs font-bold text-white"
                  >
                    CLOSE
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
