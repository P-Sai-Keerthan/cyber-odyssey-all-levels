'use client';

import * as React from 'react';
import type { AdminParticipantItem } from '@/lib/actions/admin-actions';
import { formatDate, formatDateTime } from '@/lib/utils/date-formatter';

export interface ParticipantsClientProps {
  initialParticipants: AdminParticipantItem[];
  totalCount: number;
}

export function ParticipantsClient({ initialParticipants }: ParticipantsClientProps) {
  const [participants] = React.useState<AdminParticipantItem[]>(initialParticipants);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('ALL');
  const [teamFilter, setTeamFilter] = React.useState('ALL');

  const filtered = participants.filter((p) => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (teamFilter === 'TEAMLESS' && p.teamId !== null) return false;
    if (teamFilter === 'ASSIGNED' && p.teamId === null) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchEmail = p.email.toLowerCase().includes(q);
      const matchUsername = p.username.toLowerCase().includes(q);
      const matchTeam = p.teamName?.toLowerCase().includes(q);
      if (!matchEmail && !matchUsername && !matchTeam) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
              <span className="size-2 rounded-full bg-emerald-400" />
              <span>ROSTER OPERATIONS // PARTICIPANTS</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Participant Management
            </h1>
            <p className="text-muted-foreground font-sans text-sm">
              Operational participant directory, squad assignment status, and telemetry
              verification.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-1.5 font-bold text-emerald-300">
              {filtered.length} / {participants.length} PARTICIPANTS
            </span>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-3">
          <input
            type="text"
            placeholder="Search email, username, or squad..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-border/80 bg-background/60 placeholder:text-muted-foreground rounded-xl border px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border-border/80 bg-background/60 rounded-xl border px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL">All Account Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="BLOCKED">BLOCKED</option>
            <option value="SUSPENDED">SUSPENDED</option>
          </select>

          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="border-border/80 bg-background/60 rounded-xl border px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL">All Squad Affiliations</option>
            <option value="ASSIGNED">Assigned to Squad</option>
            <option value="TEAMLESS">Teamless / Unassigned</option>
          </select>
        </div>
      </div>

      {/* Participants Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border shadow-xl backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-border/60 bg-background/40 text-muted-foreground border-b text-[10px] uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Squad / Role</th>
                <th className="px-4 py-3 font-semibold">Submissions</th>
                <th className="px-4 py-3 font-semibold">Last Login</th>
                <th className="px-4 py-3 font-semibold">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground py-12 text-center">
                    No participants match current filter criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-card/40 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-white uppercase">@{p.username}</div>
                      <div className="text-muted-foreground text-[11px]">{p.email}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase ${
                          p.status === 'ACTIVE'
                            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {p.teamName ? (
                        <div>
                          <span className="font-bold text-cyan-300 uppercase">{p.teamName}</span>
                          <div className="text-muted-foreground text-[10px] uppercase">
                            {p.teamRole || 'MEMBER'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[11px] italic">TEAMLESS</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-bold text-white">{p.submissionCount}</span>
                      <span className="text-muted-foreground ml-1 text-[10px]">DELIVERABLES</span>
                    </td>
                    <td className="text-muted-foreground px-4 py-3.5 text-[11px]">
                      {p.lastLoginAt ? formatDateTime(p.lastLoginAt) : 'Never'}
                    </td>
                    <td className="text-muted-foreground px-4 py-3.5 text-[11px]">
                      {formatDate(p.createdAt)}
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
