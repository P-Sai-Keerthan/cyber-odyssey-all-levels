import * as React from 'react';
import Link from 'next/link';

export interface TeamSummaryCardProps {
  teamName: string;
  teamCode: string;
  memberCount: number;
  maxCapacity?: number | undefined;
}

export function TeamSummaryCard({
  teamName,
  teamCode,
  memberCount,
  maxCapacity = 3,
}: TeamSummaryCardProps) {
  const isFull = memberCount >= maxCapacity;

  return (
    <div className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-6 shadow-xl backdrop-blur-md">
      <div className="border-border/50 flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
          <span className="size-2 rounded-full bg-cyan-400" />
          <span>MY TEAM</span>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
            isFull
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              : 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
          }`}
        >
          {isFull ? 'SQUAD FULL' : `${maxCapacity - memberCount} SLOTS OPEN`}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            SQUAD CODENAME
          </span>
          <h3 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">
            {teamName}
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-3 font-mono text-xs">
          <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
            <span className="text-muted-foreground text-[10px] uppercase">MEMBERS</span>
            <div className="text-foreground text-base font-bold">
              {memberCount} / {maxCapacity}
            </div>
          </div>

          <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
            <span className="text-muted-foreground text-[10px] uppercase">TEAM ID</span>
            <div className="text-base font-bold tracking-wider text-cyan-300">{teamCode}</div>
          </div>
        </div>
      </div>

      <Link
        href="/team"
        className="group border-border/70 bg-card focus-visible:ring-cyan-accent flex items-center justify-between rounded-xl border px-4 py-2.5 font-mono text-xs font-semibold text-cyan-300 transition-all hover:border-cyan-500/50 hover:bg-cyan-950/30 focus-visible:ring-1 focus-visible:outline-none"
      >
        <span>VIEW MY TEAM</span>
        <span className="transition-transform group-hover:translate-x-1">→</span>
      </Link>
    </div>
  );
}
