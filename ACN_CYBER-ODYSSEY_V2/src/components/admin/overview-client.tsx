'use client';

import * as React from 'react';
import Link from 'next/link';
import type {
  AdminOverviewStats,
  AdminAnnouncementItem,
  AdminActivityItem,
} from '@/lib/actions/admin-actions';
import { formatShortTime } from '@/lib/utils/date-formatter';

export interface OverviewClientProps {
  initialStats: AdminOverviewStats;
  recentAnnouncements: AdminAnnouncementItem[];
  recentActivity: AdminActivityItem[];
}

export function OverviewClient({
  initialStats,
  recentAnnouncements,
  recentActivity,
}: OverviewClientProps) {
  const stats = initialStats;
  const isOnline = stats.portalStatus.isOnline;

  return (
    <div className="space-y-8 font-mono">
      {/* Top Mission Operations Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              <span>EVENT OPERATIONS // ADMIN MISSION CONTROL</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Admin Operations Center
            </h1>
            <p className="text-muted-foreground font-sans text-sm">
              Live competition supervision, authoritative level control, broadcast dispatch, and
              telemetry monitoring.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/event"
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-all ${
                isOnline
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.2)] hover:bg-emerald-900/40'
                  : 'border-rose-500/40 bg-rose-950/30 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.2)] hover:bg-rose-900/40'
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  isOnline ? 'animate-pulse bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span>PORTAL: {isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </Link>

            <Link
              href="/admin/levels"
              className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-4 py-2.5 text-xs font-bold text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.2)] transition-all hover:bg-cyan-900/40"
            >
              <span>LEVEL CONTROLS →</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Primary Telemetry Grid */}
      <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Participants */}
        <Link
          href="/admin/participants"
          className="border-border/60 bg-card/40 hover:bg-card/70 group flex flex-col justify-between rounded-2xl border p-5 shadow-lg transition-all hover:border-emerald-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              PARTICIPANTS
            </span>
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/50 p-2 text-emerald-400 transition-transform group-hover:scale-110">
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            </span>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white transition-colors group-hover:text-emerald-300">
              {stats.totalParticipants}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              {stats.activeUsers} Active total accounts
            </div>
          </div>
        </Link>

        {/* Squads / Teams */}
        <Link
          href="/admin/teams"
          className="border-border/60 bg-card/40 hover:bg-card/70 group flex flex-col justify-between rounded-2xl border p-5 shadow-lg transition-all hover:border-cyan-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              SQUADS / TEAMS
            </span>
            <span className="rounded-lg border border-cyan-500/30 bg-cyan-950/50 p-2 text-cyan-400 transition-transform group-hover:scale-110">
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white transition-colors group-hover:text-cyan-300">
              {stats.totalTeams}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">Active registered teams</div>
          </div>
        </Link>

        {/* Submitted Investigations */}
        <Link
          href="/admin/submissions"
          className="border-border/60 bg-card/40 hover:bg-card/70 group flex flex-col justify-between rounded-2xl border p-5 shadow-lg transition-all hover:border-amber-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              SUBMISSIONS
            </span>
            <span className="rounded-lg border border-amber-500/30 bg-amber-950/50 p-2 text-amber-400 transition-transform group-hover:scale-110">
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white transition-colors group-hover:text-amber-300">
              {stats.submittedInvestigations}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              {stats.evaluatedInvestigations} Graded / Evaluated
            </div>
          </div>
        </Link>

        {/* Event Staff Telemetry */}
        <div className="border-border/60 bg-card/40 flex flex-col justify-between rounded-2xl border p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              OPERATIONAL STAFF
            </span>
            <span className="rounded-lg border border-indigo-500/30 bg-indigo-950/50 p-2 text-indigo-400">
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white">
              {stats.totalAdmins + stats.totalEvaluators}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              {stats.totalAdmins} Admins • {stats.totalEvaluators} Evaluators
            </div>
          </div>
        </div>
      </div>

      {/* Level Operations Live Control Summary */}
      <section className="space-y-4" aria-labelledby="level-control-summary-heading">
        <div className="border-border/50 flex items-center justify-between border-b pb-2">
          <h2
            id="level-control-summary-heading"
            className="text-xs font-bold tracking-wider text-emerald-400 uppercase"
          >
            Level Operations & Telemetry
          </h2>
          <Link
            href="/admin/levels"
            className="text-muted-foreground text-[11px] transition-colors hover:text-emerald-300"
          >
            Manage Timers & Status →
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {stats.levels.map((lvl) => {
            const isLive = lvl.status === 'LIVE';
            const isPaused = lvl.status === 'PAUSED';
            const isCompleted = lvl.status === 'COMPLETED';

            const statusBadgeClass = isLive
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
              : isPaused
                ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                : isCompleted
                  ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                  : 'border-border bg-background/60 text-muted-foreground';

            return (
              <div
                key={lvl.levelNumber}
                className="border-border/70 bg-card/50 space-y-4 rounded-2xl border p-5 shadow-xl backdrop-blur-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[10px] font-bold uppercase">
                    LEVEL {lvl.levelNumber}
                  </span>
                  <span
                    className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass}`}
                  >
                    {lvl.status}
                  </span>
                </div>

                <div>
                  <h3 className="font-sans text-sm font-bold text-white">{lvl.name}</h3>
                  <div className="text-muted-foreground mt-0.5 text-[11px]">{lvl.codename}</div>
                </div>

                <div className="border-border/40 grid grid-cols-2 gap-2 border-t pt-3 text-[11px]">
                  <div>
                    <span className="text-muted-foreground text-[10px] uppercase">DURATION</span>
                    <div className="font-bold text-white">{lvl.durationMinutes} MIN</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] uppercase">REMAINING</span>
                    <div
                      className={`font-bold ${isLive ? 'text-emerald-300' : 'text-muted-foreground'}`}
                    >
                      {isLive
                        ? `${Math.floor(lvl.remainingSeconds / 60)}m ${lvl.remainingSeconds % 60}s`
                        : isPaused
                          ? `${Math.floor(lvl.remainingSeconds / 60)}m (Paused)`
                          : '—'}
                    </div>
                  </div>
                </div>

                <div className="text-muted-foreground border-border/40 flex items-center justify-between border-t pt-3 text-[10px]">
                  <span>START: {lvl.startedAt ? formatShortTime(lvl.startedAt) : '—'}</span>
                  <span>END: {lvl.endsAt ? formatShortTime(lvl.endsAt) : '—'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Two-Column Grid: Announcements & Activity Trail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Column 1: Recent Broadcasts */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 shadow-xl backdrop-blur-md">
          <div className="border-border/50 flex items-center justify-between border-b pb-2">
            <h2 className="text-xs font-bold tracking-wider text-cyan-400 uppercase">
              Recent Announcements
            </h2>
            <Link
              href="/admin/announcements"
              className="text-muted-foreground text-[11px] transition-colors hover:text-cyan-300"
            >
              Broadcast Center →
            </Link>
          </div>

          {recentAnnouncements.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-xs">
              No recent announcements published.
            </div>
          ) : (
            <div className="space-y-3">
              {recentAnnouncements.map((a) => (
                <div
                  key={a.id}
                  className="border-border/60 bg-background/40 space-y-1.5 rounded-xl border p-3.5"
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-white">{a.title}</span>
                    <span className="rounded border border-cyan-500/30 bg-cyan-950/60 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">
                      {a.targetAudience}
                    </span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2 font-sans text-xs">
                    {a.content}
                  </p>
                  <div className="text-muted-foreground flex items-center justify-between pt-1 text-[10px]">
                    <span>By {a.createdBy || 'Operations'}</span>
                    <span>{formatShortTime(a.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 2: Recent Operational Activity */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 shadow-xl backdrop-blur-md">
          <div className="border-border/50 flex items-center justify-between border-b pb-2">
            <h2 className="text-xs font-bold tracking-wider text-emerald-400 uppercase">
              Operational Activity Feed
            </h2>
            <Link
              href="/admin/activity"
              className="text-muted-foreground text-[11px] transition-colors hover:text-emerald-300"
            >
              Full Audit Trail →
            </Link>
          </div>

          {recentActivity.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-xs">
              No recent operational events recorded.
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentActivity.map((log) => (
                <div
                  key={log.id}
                  className="border-border/50 bg-background/30 flex items-start justify-between gap-3 rounded-xl border p-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-white">{log.action}</span>
                      {log.actorUsername && (
                        <span className="text-[10px] text-emerald-400">@{log.actorUsername}</span>
                      )}
                    </div>
                    <div className="text-muted-foreground line-clamp-1 font-sans text-[11px]">
                      {log.details || '—'}
                    </div>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {formatShortTime(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
