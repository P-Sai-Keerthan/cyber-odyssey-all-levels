'use client';

import * as React from 'react';
import type { AdminActivityItem } from '@/lib/actions/admin-actions';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface ActivityClientProps {
  initialLogs: AdminActivityItem[];
  totalCount: number;
}

export function ActivityClient({ initialLogs }: ActivityClientProps) {
  const [logs] = React.useState<AdminActivityItem[]>(initialLogs);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [actionFilter, setActionFilter] = React.useState('ALL');
  const [roleFilter, setRoleFilter] = React.useState('ALL');

  const filtered = logs.filter((l) => {
    if (actionFilter !== 'ALL' && l.action !== actionFilter) return false;
    if (roleFilter !== 'ALL' && l.actorRole !== roleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchAction = l.action.toLowerCase().includes(q);
      const matchDetails = l.details?.toLowerCase().includes(q);
      const matchActor = l.actorUsername?.toLowerCase().includes(q);
      const matchTarget = l.targetUsername?.toLowerCase().includes(q);
      if (!matchAction && !matchDetails && !matchActor && !matchTarget) return false;
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
              <span>SECURITY INTELLIGENCE // AUDIT TRAIL</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Operational Activity Feed
            </h1>
            <p className="text-muted-foreground font-sans text-sm">
              Real-time chronological telemetry stream recording staff logins, level transitions,
              broadcasts, and submissions.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-1.5 font-bold text-emerald-300">
              {filtered.length} / {logs.length} EVENTS
            </span>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-3">
          <input
            type="text"
            placeholder="Search action, details, or username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-border/80 bg-background/60 placeholder:text-muted-foreground rounded-xl border px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
          />

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="border-border/80 bg-background/60 rounded-xl border px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL">All Event Actions</option>
            <option value="ADMIN_LOGIN">ADMIN_LOGIN</option>
            <option value="ADMIN_LOGOUT">ADMIN_LOGOUT</option>
            <option value="LOGIN">LOGIN</option>
            <option value="LOGOUT">LOGOUT</option>
            <option value="LEVEL_STARTED">LEVEL_STARTED</option>
            <option value="LEVEL_PAUSED">LEVEL_PAUSED</option>
            <option value="LEVEL_RESUMED">LEVEL_RESUMED</option>
            <option value="LEVEL_STOPPED">LEVEL_STOPPED</option>
            <option value="LEVEL_COMPLETED">LEVEL_COMPLETED</option>
            <option value="LEVEL_RESET">LEVEL_RESET</option>
            <option value="PORTAL_ONLINE">PORTAL_ONLINE</option>
            <option value="PORTAL_OFFLINE">PORTAL_OFFLINE</option>
            <option value="ANNOUNCEMENT_CREATED">ANNOUNCEMENT_CREATED</option>
            <option value="ANNOUNCEMENT_PUBLISHED">ANNOUNCEMENT_PUBLISHED</option>
            <option value="SUBMISSION_SUBMITTED">SUBMISSION_SUBMITTED</option>
            <option value="EVALUATION_SUBMITTED">EVALUATION_SUBMITTED</option>
          </select>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="border-border/80 bg-background/60 rounded-xl border px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL">All Actor Roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="CREATOR">CREATOR</option>
            <option value="EVALUATOR">EVALUATOR</option>
            <option value="PARTICIPANT">PARTICIPANT</option>
          </select>
        </div>
      </div>

      {/* Activity Logs Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border shadow-xl backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-border/60 bg-background/40 text-muted-foreground border-b text-[10px] uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Actor / Role</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground py-12 text-center">
                    No activity logs match filter criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-card/40 transition-colors">
                    <td className="text-muted-foreground px-4 py-3.5 text-[11px] whitespace-nowrap">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-[11px] font-bold text-white uppercase">{l.action}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      {l.actorUsername ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-emerald-400">@{l.actorUsername}</span>
                          {l.actorRole && (
                            <span className="bg-background/60 border-border py-0.2 text-muted-foreground rounded border px-1.5 text-[9px] font-bold">
                              {l.actorRole}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[11px] italic">System</span>
                      )}
                    </td>
                    <td className="text-muted-foreground max-w-lg px-4 py-3.5 font-sans text-xs leading-relaxed">
                      {l.details || '—'}
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
