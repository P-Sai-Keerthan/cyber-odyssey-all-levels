'use client';

import * as React from 'react';
import Link from 'next/link';
import { GradientButton } from '@/components/ui/gradient-button';
import { LEADERBOARD_LEVELS, type LeaderboardLevel } from '@/lib/leaderboard/levels';

export interface LeaderboardTeamItem {
  id: string;
  name: string;
  /** Official score per level. `null` = not scored yet. `0` = genuinely scored zero. */
  levelScores: Record<LeaderboardLevel, number | null>;
  /** Unadjusted base score per level */
  levelBaseScores?: Record<LeaderboardLevel, number | null> | undefined;
  /** Approved additional points adjustments per level */
  levelAdjustmentScores?: Record<LeaderboardLevel, number> | undefined;
  /** Sum of levels that carry an official score; `null` when none do. */
  totalScore: number | null;
  hasOfficialScore: boolean;
  /** `null` for squads with no official score — listed, but not ranked. */
  rank: number | null;
  updatedAt: string;
  createdAt: string;
}

export interface LeaderboardViewProps {
  teams: LeaderboardTeamItem[];
  currentUserTeamId?: string | null;
  eventPeriodLabel?: string;
  scoredTeamCount?: number;
}

/** Rendered wherever a level has no official score yet. Never shown for a real 0. */
const NOT_SCORED = '—';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatScore(score: number): string {
  return new Intl.NumberFormat('en-US').format(score);
}

/**
 * Formats a nullable level or total score.
 *
 * The `null` check is explicit rather than falsy: `0` is a legitimate earned
 * score and must render as "0", not as the not-scored dash.
 */
function formatNullableScore(score: number | null): string {
  return score === null ? NOT_SCORED : formatScore(score);
}

/**
 * Official leaderboard.
 *
 * Columns are Rank · Team · Level 1 · Level 2 · Level 3 · Total — competition
 * performance only. Membership and squad status are deliberately absent: they
 * are roster administration, not results, and are available to staff in the
 * Creator and Admin consoles.
 *
 * Every score arrives already resolved by `getLeaderboardStandings`, which reads
 * current database state. Nothing here computes, caches or overrides a score, so
 * an Admin approval is reflected on the next render with no manual step.
 */
export function LeaderboardView({
  teams,
  currentUserTeamId,
  eventPeriodLabel = 'SEASON 2026 // SECTOR ALPHA-09',
  scoredTeamCount,
}: LeaderboardViewProps) {
  const [pageSize, setPageSize] = React.useState<number>(10);
  const [currentPage, setCurrentPage] = React.useState<number>(1);
  const [searchQuery, setSearchQuery] = React.useState<string>('');

  const filteredTeams = React.useMemo(() => {
    if (!searchQuery.trim()) return teams;
    const q = searchQuery.toLowerCase().trim();
    return teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [teams, searchQuery]);

  // The podium shows ranked squads only. A squad with no official score has not
  // placed — it simply has not been marked — so it never occupies a podium slot.
  const rankedTeams = React.useMemo(() => teams.filter((t) => t.rank !== null), [teams]);
  const podium = [rankedTeams[0] ?? null, rankedTeams[1] ?? null, rankedTeams[2] ?? null];
  const scoredCount = scoredTeamCount ?? rankedTeams.length;

  const totalTeams = filteredTeams.length;
  const totalPages = Math.max(1, Math.ceil(totalTeams / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalTeams);
  const paginatedTeams = filteredTeams.slice(startIndex, endIndex);

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  /** Podium slot: a placed squad, or an OPEN plinth while the position is unclaimed. */
  function PodiumSlot({ team, place }: { team: LeaderboardTeamItem | null; place: 1 | 2 | 3 }) {
    const theme =
      place === 1
        ? {
            badge: 'border-amber-300 bg-amber-600 text-amber-50',
            avatar: 'border-amber-400/50 from-amber-600 to-amber-900 text-amber-100',
            card: 'border-amber-500/50 shadow-[0_0_28px_rgba(245,158,11,0.18)] hover:border-amber-400',
            score: 'text-amber-200',
            plinth: 'border-amber-500/30 bg-amber-950/50 text-amber-200',
            label: 'FIRST PLACE',
          }
        : place === 2
          ? {
              badge: 'border-slate-300 bg-slate-800 text-slate-200',
              avatar: 'border-slate-400/50 from-slate-700 to-slate-900 text-slate-200',
              card: 'border-slate-500/40 shadow-lg hover:border-slate-400',
              score: 'text-slate-200',
              plinth: 'border-slate-500/30 bg-slate-900/60 text-slate-300',
              label: 'SECOND PLACE',
            }
          : {
              badge: 'border-amber-700 bg-amber-900 text-amber-200',
              avatar: 'border-amber-700/50 from-amber-800 to-amber-950 text-amber-200',
              card: 'border-amber-700/40 shadow-lg hover:border-amber-600',
              score: 'text-amber-400',
              plinth: 'border-amber-700/30 bg-amber-950/40 text-amber-300',
              label: 'THIRD PLACE',
            };

    if (!team) {
      return (
        <div className="border-border/40 bg-background/30 flex w-full flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center opacity-60">
          <span className="text-muted-foreground font-mono text-xs font-bold">#{place} OPEN</span>
          <span className="text-muted-foreground mt-1 font-sans text-[10px]">
            Awaiting first official score
          </span>
        </div>
      );
    }

    const isUserTeam = currentUserTeamId === team.id;

    return (
      <div
        className={`group relative flex w-full flex-col items-center rounded-2xl border p-5 text-center transition-all ${
          isUserTeam
            ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_20px_rgba(6,182,212,0.25)]'
            : `bg-card/80 ${theme.card}`
        }`}
      >
        <div className="absolute -top-3.5 flex items-center justify-center">
          <span
            className={`inline-flex size-7 items-center justify-center rounded-full border font-mono text-xs font-extrabold shadow-md ${theme.badge}`}
          >
            #{team.rank}
          </span>
        </div>

        <div
          className={`mt-2 flex size-14 items-center justify-center rounded-2xl border bg-gradient-to-br font-mono text-base font-black shadow-inner ${theme.avatar}`}
        >
          {getInitials(team.name)}
        </div>

        <div className="mt-3 space-y-1">
          <h3 className="max-w-[160px] truncate font-sans text-base font-bold text-white">
            {team.name}
          </h3>
          {isUserTeam && (
            <span className="inline-block rounded border border-cyan-400/60 bg-cyan-950/80 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-cyan-300 uppercase">
              YOUR SQUAD
            </span>
          )}
          <div className={`font-mono text-xl font-black ${theme.score}`}>
            {formatNullableScore(team.totalScore)}{' '}
            <span className="text-muted-foreground text-xs">PTS</span>
          </div>

          {/* Per-level breakdown, so the podium total is explainable at a glance. */}
          <div className="text-muted-foreground flex items-center justify-center gap-2 font-mono text-[10px]">
            {LEADERBOARD_LEVELS.map((level) => (
              <span key={level} className="whitespace-nowrap">
                L{level}{' '}
                <span
                  className={
                    team.levelScores[level] === null ? 'text-muted-foreground' : 'text-white'
                  }
                >
                  {formatNullableScore(team.levelScores[level])}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div
          className={`mt-4 w-full rounded-xl border py-2.5 font-mono text-[11px] font-bold ${theme.plinth}`}
        >
          {theme.label}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ===================================================================== */}
      {/* 1. HEADER BRIEFING                                                    */}
      {/* ===================================================================== */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-widest text-amber-400 uppercase">
            <span className="size-2 animate-pulse rounded-full bg-amber-400" />
            <span>{eventPeriodLabel}</span>
          </div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Cyber Odyssey Leaderboard
          </h1>
          <p className="text-muted-foreground font-sans text-sm">
            Official scores by investigation level. A level shows{' '}
            <span className="font-mono text-white">{NOT_SCORED}</span> until its result is official.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <GradientButton
              variant="outline"
              size="sm"
              className="font-mono text-xs font-semibold uppercase"
            >
              ← Dashboard
            </GradientButton>
          </Link>
          <Link href="/team">
            <GradientButton
              variant="cyan"
              size="sm"
              className="font-mono text-xs font-semibold uppercase"
            >
              My Team →
            </GradientButton>
          </Link>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2. PODIUM                                                             */}
      {/* ===================================================================== */}
      <section
        className="border-border/80 bg-card/60 relative overflow-hidden rounded-2xl border p-6 shadow-2xl backdrop-blur-md sm:p-8"
        aria-label="Top 3 podium rankings"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-500/5 via-cyan-500/5 to-transparent"
          aria-hidden="true"
        />

        <div className="relative z-10 space-y-6">
          <div className="text-center font-mono">
            <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">
              HONOR ROLL // ELITE SQUADS
            </span>
            <h2 className="font-sans text-lg font-bold tracking-wider text-white uppercase sm:text-xl">
              Competition Podium
            </h2>
          </div>

          {scoredCount === 0 && (
            <p className="text-muted-foreground mx-auto max-w-md text-center font-sans text-xs">
              No squad has received an official score yet. Podium positions open as evaluations are
              completed and approved.
            </p>
          )}

          {/* #2 left, #1 centre and elevated, #3 right. */}
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3 sm:gap-6">
            <div className="order-2 flex flex-col items-center sm:order-1">
              <PodiumSlot team={podium[1] ?? null} place={2} />
            </div>
            <div className="order-1 flex flex-col items-center sm:order-2 sm:-translate-y-2">
              <PodiumSlot team={podium[0] ?? null} place={1} />
            </div>
            <div className="order-3 flex flex-col items-center">
              <PodiumSlot team={podium[2] ?? null} place={3} />
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 3. CONTROLS                                                           */}
      {/* ===================================================================== */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <label htmlFor="leaderboard-search" className="sr-only">
            Search squads by name
          </label>
          <input
            id="leaderboard-search"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search squad name..."
            className="border-border/60 bg-card/60 w-full rounded-xl border px-3.5 py-2 font-mono text-xs text-white outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/30"
          />
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-muted-foreground">
            {scoredCount} of {teams.length} squads scored
          </span>
          <label htmlFor="leaderboard-page-size" className="sr-only">
            Rows per page
          </label>
          <select
            id="leaderboard-page-size"
            value={pageSize}
            onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
            className="border-border/60 bg-card/60 rounded-xl border px-3 py-2 text-white outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/30"
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 4. STANDINGS TABLE                                                    */}
      {/* ===================================================================== */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-md">
        {paginatedTeams.length === 0 ? (
          <div className="space-y-3 p-12 text-center font-mono">
            <div className="border-border/60 bg-background/60 mx-auto flex size-12 items-center justify-center rounded-2xl border">
              <svg
                className="text-muted-foreground size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18 20V10" />
                <path d="M12 20V4" />
                <path d="M6 20v-6" />
              </svg>
            </div>
            <h3 className="text-foreground text-sm font-bold tracking-wider uppercase">
              {searchQuery ? 'NO SQUADS MATCHING SEARCH' : 'NO SQUADS REGISTERED'}
            </h3>
            <p className="text-muted-foreground mx-auto max-w-sm font-sans text-xs">
              {searchQuery
                ? 'Try adjusting your squad name filter to locate the team.'
                : 'Squads appear here as soon as they register, with scores added as levels are completed.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left font-mono text-xs">
              <caption className="sr-only">
                Official standings by investigation level. A dash means the level has no official
                score yet; a zero means the squad was scored zero.
              </caption>
              <thead>
                <tr className="border-border/60 bg-background/60 text-muted-foreground border-b">
                  <th scope="col" className="w-16 px-4 py-3.5 text-center font-semibold">
                    RANK
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">
                    SQUAD IDENTIFIER
                  </th>
                  {LEADERBOARD_LEVELS.map((level) => (
                    <th
                      key={level}
                      scope="col"
                      className="w-28 px-4 py-3.5 text-center font-semibold"
                    >
                      LEVEL {level}
                    </th>
                  ))}
                  <th scope="col" className="w-36 px-4 py-3.5 text-right font-semibold">
                    TOTAL SCORE
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border/40 divide-y">
                {paginatedTeams.map((t) => {
                  const isUserTeam = currentUserTeamId === t.id;
                  const isTop1 = t.rank === 1;
                  const isTop2 = t.rank === 2;
                  const isTop3 = t.rank === 3;

                  return (
                    <tr
                      key={t.id}
                      className={`transition-colors ${
                        isUserTeam
                          ? 'border-l-4 border-l-cyan-400 bg-cyan-950/30 font-semibold shadow-[inset_0_0_12px_rgba(6,182,212,0.1)]'
                          : 'hover:bg-card/40'
                      }`}
                    >
                      {/* Rank — squads without an official score are unranked. */}
                      <td className="px-4 py-4 text-center">
                        {t.rank === null ? (
                          <span
                            className="text-muted-foreground text-xs"
                            title="Not ranked until this squad receives an official score"
                          >
                            {NOT_SCORED}
                          </span>
                        ) : (
                          <span
                            className={`inline-flex size-7 items-center justify-center rounded-lg text-xs font-bold ${
                              isTop1
                                ? 'border border-amber-500/40 bg-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                                : isTop2
                                  ? 'border border-slate-400/40 bg-slate-300/20 text-slate-200'
                                  : isTop3
                                    ? 'border border-amber-700/40 bg-amber-700/20 text-amber-400'
                                    : 'text-muted-foreground'
                            }`}
                          >
                            {t.rank < 10 ? `0${t.rank}` : t.rank}
                          </span>
                        )}
                      </td>

                      {/* Squad */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="border-border/60 bg-background/80 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-black">
                            {getInitials(t.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-sans font-bold text-white">{t.name}</div>
                            {isUserTeam && (
                              <span className="text-[9px] font-bold tracking-wider text-cyan-300 uppercase">
                                YOUR SQUAD
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Per-level scores */}
                      {LEADERBOARD_LEVELS.map((level) => {
                        const value = t.levelScores[level];
                        const adj = t.levelAdjustmentScores?.[level] ?? 0;
                        const base = t.levelBaseScores?.[level] ?? 0;
                        return (
                          <td key={level} className="px-4 py-4 text-center">
                            {value === null ? (
                              <span
                                className="text-muted-foreground"
                                title={`Level ${level} has no official score yet`}
                              >
                                {NOT_SCORED}
                              </span>
                            ) : (
                              <div className="flex flex-col items-center">
                                <span className="font-bold text-white">
                                  {formatScore(value)}
                                  <span className="text-muted-foreground text-[10px]"> PTS</span>
                                </span>
                                {adj > 0 && (
                                  <span
                                    className="font-mono text-[9px] font-bold text-emerald-400"
                                    title={`Base: ${base} PTS + Adjustment: ${adj} PTS`}
                                  >
                                    +{adj} ADJ
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Total */}
                      <td className="px-4 py-4 text-right">
                        {t.totalScore === null ? (
                          <span
                            className="text-muted-foreground"
                            title="No official score recorded yet"
                          >
                            {NOT_SCORED}
                          </span>
                        ) : (
                          <span className="text-sm font-black text-amber-300">
                            {formatScore(t.totalScore)}
                            <span className="text-muted-foreground text-[10px]"> PTS</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-border/60 bg-background/40 flex flex-col items-center justify-between gap-3 border-t px-4 py-3 font-mono text-xs sm:flex-row">
            <span className="text-muted-foreground">
              Showing {startIndex + 1}–{endIndex} of {totalTeams} squads
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="border-border/60 bg-card/60 text-muted-foreground rounded-lg border px-3 py-1.5 font-bold transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-muted-foreground px-2">
                Page {safeCurrentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                className="border-border/60 bg-card/60 text-muted-foreground rounded-lg border px-3 py-1.5 font-bold transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
