'use client';

import * as React from 'react';
import Link from 'next/link';
import type { CreatorOverviewStats, PendingStaffUser } from '@/lib/actions/creator-actions';

export interface OverviewClientProps {
  initialStats: CreatorOverviewStats;
  initialPending: PendingStaffUser[];
  initialLogs?: unknown[];
}

export function OverviewClient({ initialStats, initialPending }: OverviewClientProps) {
  const stats = initialStats;
  const isOnline = stats.portalStatus.isOnline;

  return (
    <div className="space-y-8">
      {/* Top Mission Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-fuchsia-400 uppercase">
              <span className="size-2 animate-pulse rounded-full bg-fuchsia-400" />
              <span>MISSION CONTROL // CREATOR DESK</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Creator Control Center
            </h1>
            <p className="text-muted-foreground text-sm">
              Live operational telemetry, staff clearances, account governance, and portal controls.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/creator/portal-control"
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 font-mono text-xs font-bold transition-all ${
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
          </div>
        </div>
      </div>

      {/* Primary Telemetry Grid */}
      <div className="grid grid-cols-1 gap-4 font-mono sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Participants */}
        <Link
          href="/creator/accounts?role=PARTICIPANT"
          className="border-border/60 bg-card/40 hover:bg-card/70 group flex flex-col justify-between rounded-2xl border p-5 shadow-lg transition-all hover:border-cyan-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              PARTICIPANTS
            </span>
            <span className="rounded-lg border border-cyan-500/30 bg-cyan-950/50 p-2 text-cyan-400 transition-transform group-hover:scale-110">
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
            <div className="text-3xl font-black text-white transition-colors group-hover:text-cyan-300">
              {stats.totalParticipants}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              {stats.activeAccounts} Active total users
            </div>
          </div>
        </Link>

        {/* Squads / Teams */}
        <Link
          href="/creator/teams"
          className="border-border/60 bg-card/40 hover:bg-card/70 group flex flex-col justify-between rounded-2xl border p-5 shadow-lg transition-all hover:border-fuchsia-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              SQUADS / TEAMS
            </span>
            <span className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-950/50 p-2 text-fuchsia-400 transition-transform group-hover:scale-110">
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </span>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white transition-colors group-hover:text-fuchsia-300">
              {stats.activeTeams}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              {stats.totalTeams} Registered squads ({stats.blockedTeams} blocked)
            </div>
          </div>
        </Link>

        {/* Staff Clearance Queue */}
        <Link
          href="/creator/approvals"
          className={`bg-card/40 group flex flex-col justify-between rounded-2xl border p-5 shadow-lg transition-all ${
            stats.pendingStaffApprovals > 0
              ? 'border-amber-500/50 hover:border-amber-400 hover:bg-amber-950/20'
              : 'border-border/60 hover:border-border hover:bg-card/70'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              PENDING CLEARANCES
            </span>
            <span className="rounded-lg border border-amber-500/30 bg-amber-950/50 p-2 text-amber-400 transition-transform group-hover:scale-110">
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <polyline points="16 11 18 13 22 9" />
              </svg>
            </span>
          </div>
          <div className="mt-4">
            <div
              className={`text-3xl font-black transition-colors ${
                stats.pendingStaffApprovals > 0 ? 'text-amber-300' : 'text-white'
              }`}
            >
              {stats.pendingStaffApprovals}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              Evaluators & Admins awaiting approval
            </div>
          </div>
        </Link>

        {/* Active Sessions */}
        <Link
          href="/creator/activity"
          className="border-border/60 bg-card/40 hover:bg-card/70 group flex flex-col justify-between rounded-2xl border p-5 shadow-lg transition-all hover:border-emerald-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              ACTIVE SESSIONS
            </span>
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/50 p-2 text-emerald-400 transition-transform group-hover:scale-110">
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </span>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-emerald-300 transition-colors group-hover:text-emerald-200">
              {stats.activeSessions}
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              Live active authentication tokens
            </div>
          </div>
        </Link>
      </div>

      {/* Middle Section: Staff Roles & Clearance Overview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Staff Role Breakdown */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-md">
          <div className="flex items-center justify-between font-mono">
            <span className="text-xs font-bold tracking-wider text-fuchsia-400 uppercase">
              STAFF OVERVIEW
            </span>
            <Link
              href="/creator/accounts"
              className="text-muted-foreground text-[11px] transition-colors hover:text-white"
            >
              View All →
            </Link>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="border-border/50 bg-background/50 flex items-center justify-between rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-cyan-400" />
                <span className="text-foreground">Evaluators</span>
              </div>
              <span className="font-bold text-white">{stats.totalEvaluators}</span>
            </div>

            <div className="border-border/50 bg-background/50 flex items-center justify-between rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-fuchsia-400" />
                <span className="text-foreground">Administrators</span>
              </div>
              <span className="font-bold text-white">{stats.totalAdmins}</span>
            </div>

            <div className="border-border/50 bg-background/50 flex items-center justify-between rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-rose-400" />
                <span className="text-foreground">Blocked / Suspended Accounts</span>
              </div>
              <span className="font-bold text-rose-300">{stats.blockedAccounts}</span>
            </div>
          </div>
        </div>

        {/* Quick Clearance Queue */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-md lg:col-span-2">
          <div className="flex items-center justify-between font-mono">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-amber-400" />
              <span className="text-xs font-bold tracking-wider text-white uppercase">
                PENDING STAFF CLEARANCES
              </span>
            </div>
            <Link
              href="/creator/approvals"
              className="text-[11px] text-amber-400 transition-colors hover:text-amber-300"
            >
              Open Approvals Desk →
            </Link>
          </div>

          {initialPending.length === 0 ? (
            <div className="border-border/40 bg-background/30 flex h-36 flex-col items-center justify-center rounded-xl border text-center font-mono text-xs text-slate-400">
              <span>All staff requests cleared. No pending applications.</span>
            </div>
          ) : (
            <div className="space-y-2 font-mono text-xs">
              {initialPending.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="border-border/50 bg-background/50 flex items-center justify-between rounded-xl border p-3"
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">@{item.username}</span>
                      <span className="rounded-md border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        {item.role}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-[11px]">{item.email}</span>
                  </div>

                  <Link
                    href="/creator/approvals"
                    className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-950/40 px-3 py-1 text-xs font-semibold text-fuchsia-200 transition-all hover:bg-fuchsia-900/60"
                  >
                    Review
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
