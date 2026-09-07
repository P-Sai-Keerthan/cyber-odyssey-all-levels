'use client';

import * as React from 'react';
import { ReportToCreatorButton } from './report-to-creator-button';
import type { AdminTeamItem } from '@/lib/actions/admin-actions';

export interface TeamsClientProps {
  initialTeams: AdminTeamItem[];
  totalCount: number;
}

export function TeamsClient({ initialTeams }: TeamsClientProps) {
  const [teams] = React.useState<AdminTeamItem[]>(initialTeams);
  const [searchQuery, setSearchQuery] = React.useState('');

  const filtered = teams.filter((t) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = t.name.toLowerCase().includes(q);
      const matchHead = t.headUsername?.toLowerCase().includes(q);
      const matchMember = t.members.some((m) => m.username.toLowerCase().includes(q));
      if (!matchName && !matchHead && !matchMember) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
              <span className="size-2 rounded-full bg-cyan-400" />
              <span>SQUAD OPERATIONS // TEAMS</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Squad Monitoring Terminal
            </h1>
            <p className="text-muted-foreground font-sans text-sm">
              Live squadron roster, team head assignments, score verification, and submission
              tracking.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-3.5 py-1.5 font-bold text-cyan-300">
              {filtered.length} / {teams.length} SQUADS
            </span>
          </div>
        </div>

        {/* Search Control */}
        <div className="pt-6">
          <input
            type="text"
            placeholder="Search squad name, team head, or member username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-border/80 bg-background/60 placeholder:text-muted-foreground w-full max-w-md rounded-xl border px-3.5 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Teams Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border shadow-xl backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-border/60 bg-background/40 text-muted-foreground border-b text-[10px] uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Squad Name</th>
                <th className="px-4 py-3 font-semibold">Team Head</th>
                <th className="px-4 py-3 font-semibold">Members</th>
                <th className="px-4 py-3 font-semibold">Score</th>
                <th className="px-4 py-3 font-semibold">Level Progress</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Escalate</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground py-12 text-center">
                    No squads match search query.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-card/40 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-white uppercase">{t.name}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">ID: {t.id}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      {t.headUsername ? (
                        <span className="font-bold text-cyan-300 uppercase">@{t.headUsername}</span>
                      ) : (
                        <span className="text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {t.members.map((m) => (
                          <span
                            key={m.id}
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                              m.role === 'HEAD'
                                ? 'border border-cyan-500/30 bg-cyan-950/60 text-cyan-300'
                                : 'bg-background/80 border-border/60 text-muted-foreground border'
                            }`}
                          >
                            @{m.username}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-black text-amber-300">{t.score} PTS</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase ${
                          t.level2Submitted
                            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                            : 'border-border bg-background/60 text-muted-foreground'
                        }`}
                      >
                        {t.level2Submitted ? 'LEVEL 2 SUBMITTED' : 'IN PROGRESS'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase ${
                          t.status === 'ACTIVE'
                            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      {/* Admins observe squads but do not act on them — squad
                          discipline is Creator authority (Admin spec section 5). */}
                      <ReportToCreatorButton teamId={t.id} subjectLabel={t.name} />
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
