'use client';

import * as React from 'react';
import Link from 'next/link';
import type { EvaluatorOverviewStats } from '@/lib/actions/evaluator-actions';
import { formatTime } from '@/lib/utils/date-formatter';

interface DashboardClientProps {
  initialStats: EvaluatorOverviewStats;
}

export function EvaluatorDashboardClient({ initialStats }: DashboardClientProps) {
  const stats = initialStats;

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="font-mono text-xs font-semibold tracking-widest text-cyan-400 uppercase">
              OPERATIONAL COMMAND DESK
            </span>
          </div>
          <h1 className="font-mono text-2xl font-black tracking-tight text-white md:text-3xl">
            EVALUATOR MISSION CONTROL
          </h1>
          <p className="text-muted-foreground text-sm">
            Live forensic evidence intake, criteria scoring rubrics, and squad evaluations.
          </p>
        </div>

        {/* Action Shortcuts */}
        <div className="flex items-center gap-3">
          <Link
            href="/evaluator/submissions"
            className="flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-950/40 px-4 py-2 font-mono text-xs font-bold text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.2)] transition-all hover:bg-cyan-900/60 hover:text-white"
          >
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
            <span>REVIEW SUBMISSIONS ({stats.pendingEvaluations})</span>
          </Link>
        </div>
      </div>

      {/* Active Level Visual Selector (Requirement 4) */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-5 backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-muted-foreground font-mono text-xs font-bold tracking-widest uppercase">
            EVENT PHASE // INVESTIGATION LEVELS
          </span>
          <span className="font-mono text-[11px] text-cyan-400">CURRENT TARGET: LEVEL 2</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Level 1 Card */}
          <div className="border-border/60 bg-background/50 rounded-xl border p-4 opacity-80 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-mono text-xs font-semibold">LEVEL 1</span>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                ACTIVE
              </span>
            </div>
            <div className="mt-2 font-mono text-sm font-bold text-white">RECONNAISSANCE</div>
            <p className="text-muted-foreground text-xs">
              Automated challenge questions &amp; authoritative server scoring (no deliverables)
            </p>
          </div>

          {/* Level 2 Card - Highlighted (Current Investigation Level) */}
          <div className="relative overflow-hidden rounded-xl border-2 border-cyan-500 bg-cyan-950/30 p-4 shadow-[0_0_25px_rgba(34,211,238,0.2)]">
            <div className="absolute top-0 right-0 h-16 w-16 bg-cyan-500/10 blur-xl" />
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-cyan-400">LEVEL 2</span>
              <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/60 bg-cyan-500/20 px-2.5 py-0.5 font-mono text-[10px] font-extrabold text-cyan-300">
                <span className="size-1.5 animate-ping rounded-full bg-cyan-400" />
                ACTIVE EVALUATION
              </span>
            </div>
            <div className="mt-2 font-mono text-base font-black text-white">LATERAL MOVEMENT</div>
            <p className="text-xs text-cyan-200/80">
              Physical + Digital Forensic Investigation & PCAP Analysis
            </p>
          </div>

          {/* Level 3 Card */}
          <div className="border-border/60 bg-background/50 rounded-xl border p-4 opacity-80 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-mono text-xs font-semibold">LEVEL 3</span>
              <span className="rounded-md border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-400">
                LOCKED
              </span>
            </div>
            <div className="mt-2 font-mono text-sm font-bold text-white">ROOT ACCESS & EXFIL</div>
            <p className="text-muted-foreground text-xs">
              Final exploit reverse-engineering & incident mitigation
            </p>
          </div>
        </div>
      </div>

      {/* Operational Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Squads */}
        <div className="border-border/80 bg-card/60 rounded-2xl border p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-mono text-xs font-semibold uppercase">
              REGISTERED SQUADS
            </span>
            <span className="size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          </div>
          <div className="mt-3 font-mono text-3xl font-black text-white">{stats.totalTeams}</div>
          <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
            <span>Active Squads:</span>
            <span className="font-mono font-bold text-emerald-400">{stats.activeTeams}</span>
          </div>
        </div>

        {/* Total Submissions */}
        <div className="border-border/80 bg-card/60 rounded-2xl border p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-mono text-xs font-semibold uppercase">
              DELIVERABLES INTAKE
            </span>
            <span className="size-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
          </div>
          <div className="mt-3 font-mono text-3xl font-black text-white">
            {stats.totalSubmissions}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
            <span>Forensic Evidence Sets</span>
            <span className="font-mono text-blue-300">LEVEL 2</span>
          </div>
        </div>

        {/* Pending Evaluations */}
        <div className="border-border/80 bg-card/60 rounded-2xl border p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-mono text-xs font-semibold uppercase">
              PENDING EVALUATIONS
            </span>
            <span className="size-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
          </div>
          <div className="mt-3 font-mono text-3xl font-black text-amber-300">
            {stats.pendingEvaluations}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
            <span>Awaiting Jury Review</span>
            <Link
              href="/evaluator/submissions"
              className="font-mono text-[11px] text-amber-400 hover:underline"
            >
              Start Review &rarr;
            </Link>
          </div>
        </div>

        {/* Completed Evaluations */}
        <div className="border-border/80 bg-card/60 rounded-2xl border p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-mono text-xs font-semibold uppercase">
              COMPLETED REVIEWS
            </span>
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          </div>
          <div className="mt-3 font-mono text-3xl font-black text-emerald-300">
            {stats.completedEvaluations}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
            <span>Official Scores Published</span>
            <span className="font-mono text-emerald-400">100% AUDITED</span>
          </div>
        </div>
      </div>

      {/* Split Section: Quick Action Queue & Recent Evaluator Feed */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Navigation & Quick Jump Hub */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-xl lg:col-span-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold tracking-widest text-cyan-400 uppercase">
              OPERATIONAL HUB
            </span>
          </div>
          <h2 className="font-mono text-lg font-bold text-white">EVALUATOR WORKSPACE</h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Direct access to squad rosters, forensic submissions, criteria scoring rubrics, and jury
            logs.
          </p>

          <div className="space-y-2.5 pt-2">
            <Link
              href="/evaluator/submissions"
              className="group border-border/80 bg-background/60 flex items-center justify-between rounded-xl border p-3.5 transition-all hover:border-cyan-500/40 hover:bg-cyan-950/20"
            >
              <div className="flex items-center gap-3">
                <span className="text-cyan-400">
                  <svg
                    className="size-4.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-bold text-white group-hover:text-cyan-300">
                    Review Submissions
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Inspect deliverables & assign criteria marks
                  </span>
                </div>
              </div>
              <span className="text-muted-foreground font-mono text-xs group-hover:text-cyan-300">
                &rarr;
              </span>
            </Link>

            <Link
              href="/evaluator/teams"
              className="group border-border/80 bg-background/60 flex items-center justify-between rounded-xl border p-3.5 transition-all hover:border-cyan-500/40 hover:bg-cyan-950/20"
            >
              <div className="flex items-center gap-3">
                <span className="text-cyan-400">
                  <svg
                    className="size-4.5"
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
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-bold text-white group-hover:text-cyan-300">
                    Squad Directory
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Inspect squad rosters and level scores
                  </span>
                </div>
              </div>
              <span className="text-muted-foreground font-mono text-xs group-hover:text-cyan-300">
                &rarr;
              </span>
            </Link>

            <Link
              href="/evaluator/evaluations"
              className="group border-border/80 bg-background/60 flex items-center justify-between rounded-xl border p-3.5 transition-all hover:border-cyan-500/40 hover:bg-cyan-950/20"
            >
              <div className="flex items-center gap-3">
                <span className="text-cyan-400">
                  <svg
                    className="size-4.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-bold text-white group-hover:text-cyan-300">
                    Completed Evaluations
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Review rubric scores and jury remarks
                  </span>
                </div>
              </div>
              <span className="text-muted-foreground font-mono text-xs group-hover:text-cyan-300">
                &rarr;
              </span>
            </Link>

            <Link
              href="/evaluator/activity"
              className="group border-border/80 bg-background/60 flex items-center justify-between rounded-xl border p-3.5 transition-all hover:border-cyan-500/40 hover:bg-cyan-950/20"
            >
              <div className="flex items-center gap-3">
                <span className="text-cyan-400">
                  <svg
                    className="size-4.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-bold text-white group-hover:text-cyan-300">
                    Activity & Audit Log
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Chronological audit trail of jury operations
                  </span>
                </div>
              </div>
              <span className="text-muted-foreground font-mono text-xs group-hover:text-cyan-300">
                &rarr;
              </span>
            </Link>
          </div>
        </div>

        {/* Recent Evaluator Activity Feed */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-xl lg:col-span-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold tracking-widest text-cyan-400 uppercase">
              LIVE AUDIT TELEMETRY
            </span>
            <Link
              href="/evaluator/activity"
              className="text-muted-foreground font-mono text-xs hover:text-cyan-300 hover:underline"
            >
              Full Log &rarr;
            </Link>
          </div>

          <h2 className="font-mono text-lg font-bold text-white">RECENT JURY OPERATIONS</h2>

          {stats.recentActivity.length === 0 ? (
            <div className="border-border/60 bg-background/40 flex flex-col items-center justify-center rounded-xl border py-12 text-center">
              <span className="text-muted-foreground font-mono text-xs font-bold">
                NO RECENT EVALUATOR TELEMETRY RECORDED
              </span>
              <p className="text-muted-foreground/80 mt-1 max-w-sm text-xs">
                Evaluator actions such as opening evidence packages and submitting marks will be
                recorded here.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {stats.recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="border-border/60 bg-background/40 hover:bg-card/40 flex items-start justify-between rounded-xl border p-3 font-mono text-xs transition-all"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 rounded border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                      {item.action}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-foreground font-medium">{item.details}</span>
                      <span className="text-muted-foreground text-[10px]">
                        Actor: @{item.actorUsername}
                      </span>
                    </div>
                  </div>

                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {formatTime(item.createdAt)}
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
