'use client';

import * as React from 'react';
import {
  getActivityLogsAction,
  type AuditLogItem,
  type ActiveSessionItem,
} from '@/lib/actions/creator-actions';
import { formatDate, formatDateTime, formatTime } from '@/lib/utils/date-formatter';

export interface ActivityClientProps {
  initialSessions: ActiveSessionItem[];
  initialLogs: AuditLogItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
}

export function ActivityClient({
  initialSessions,
  initialLogs,
  initialTotal,
  initialPage,
  initialTotalPages,
}: ActivityClientProps) {
  const [sessions] = React.useState<ActiveSessionItem[]>(initialSessions);
  const [logs, setLogs] = React.useState<AuditLogItem[]>(initialLogs);
  const [total, setTotal] = React.useState(initialTotal);
  const [page, setPage] = React.useState(initialPage);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);

  const [eventTypeFilter, setEventTypeFilter] = React.useState('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  const fetchActivity = React.useCallback(
    async (targetPage = 1, action = eventTypeFilter, search = searchQuery) => {
      setIsLoading(true);
      try {
        const result = await getActivityLogsAction({
          page: targetPage,
          limit: 20,
          action: action === 'ALL' ? undefined : action,
          search: search.trim() || undefined,
        });

        if (result.success && result.data) {
          setLogs(result.data.logs);
          setTotal(result.data.total);
          setPage(result.data.page);
          setTotalPages(result.data.totalPages);
        }
      } catch {
        // Fallback
      } finally {
        setIsLoading(false);
      }
    },
    [eventTypeFilter, searchQuery],
  );

  return (
    <div className="space-y-8 font-mono text-xs">
      {/* Top Active Sessions Telemetry */}
      <section className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-md">
        <div className="border-border/50 flex items-center justify-between border-b pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-emerald-400 uppercase">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              <span>ACTIVE SESSIONS TELEMETRY</span>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Live valid server session tokens with active investigator access.
            </p>
          </div>
          <span className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-1 font-bold text-emerald-300">
            {sessions.length} Live Sessions
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="border-border/40 bg-background/40 rounded-xl border p-8 text-center text-slate-400">
            No active user sessions currently detected.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-border/60 bg-background/60 text-muted-foreground text-[10px] uppercase">
                <tr>
                  <th className="px-3 py-2.5">User</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Session Created</th>
                  <th className="px-3 py-2.5">Expires At</th>
                  <th className="px-3 py-2.5">Last Activity</th>
                  <th className="px-3 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-border/40 divide-y">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-background/40">
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-bold text-white">@{s.username}</span>
                        <span className="text-muted-foreground text-[11px]">{s.email}</span>
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <span className="border-border/60 bg-background/60 rounded border px-2 py-0.5 text-[10px] font-bold text-slate-300">
                        {s.role}
                      </span>
                    </td>

                    <td className="text-muted-foreground px-3 py-2.5 text-[11px]">
                      {formatTime(s.createdAt)}
                    </td>

                    <td className="text-muted-foreground px-3 py-2.5 text-[11px]">
                      {formatDate(s.expiresAt)}
                    </td>

                    <td className="text-muted-foreground px-3 py-2.5 text-[11px]">
                      {s.lastActivityAt ? formatTime(s.lastActivityAt) : 'Active'}
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        ONLINE
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Authentication & Activity Timeline */}
      <section className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 backdrop-blur-md">
        <div className="border-border/50 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-cyan-400 uppercase">
              <span className="size-2 rounded-full bg-cyan-400" />
              <span>AUTHENTICATION & ACTIVITY TIMELINE</span>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Chronological log of user logins, logouts, and authentication telemetry.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {['ALL', 'LOGIN', 'LOGOUT', 'FAILED_LOGIN'].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setEventTypeFilter(tab);
                  fetchActivity(1, tab, searchQuery);
                }}
                className={`rounded-xl px-3 py-1 font-semibold transition-all ${
                  eventTypeFilter === tab
                    ? 'border border-cyan-500/50 bg-cyan-950/50 text-cyan-200'
                    : 'border-border/60 bg-background/50 text-muted-foreground border hover:text-white'
                }`}
              >
                {tab === 'FAILED_LOGIN' ? 'FAILED' : tab}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Filter activity by details, email, or username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                fetchActivity(1, eventTypeFilter, searchQuery);
              }
            }}
            className="border-border/80 bg-background/70 text-foreground placeholder:text-muted-foreground/60 flex-1 rounded-xl border px-4 py-2 text-xs focus-visible:ring-1 focus-visible:ring-cyan-400 focus-visible:outline-none"
          />

          <button
            type="button"
            onClick={() => fetchActivity(1, eventTypeFilter, searchQuery)}
            className="rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-4 py-2 font-semibold text-cyan-200 transition-all hover:bg-cyan-900/60"
          >
            Search
          </button>
        </div>

        {/* Timeline Log Table */}
        <div className="border-border/60 bg-background/50 overflow-hidden rounded-xl border">
          <table className="w-full text-left">
            <thead className="border-border/60 bg-background/80 text-muted-foreground text-[10px] uppercase">
              <tr>
                <th className="px-4 py-2.5">Timestamp</th>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">Actor / Target</th>
                <th className="px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                      Loading activity timeline...
                    </span>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-400">
                    No activity logs recorded.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isLogin = log.action === 'LOGIN';
                  const isLogout = log.action === 'LOGOUT';
                  const isFailed = log.action === 'FAILED_LOGIN';

                  return (
                    <tr key={log.id} className="hover:bg-background/40">
                      <td className="text-muted-foreground px-4 py-3 text-[11px] whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase ${
                            isLogin
                              ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                              : isLogout
                                ? 'border border-slate-500/40 bg-slate-900/40 text-slate-300'
                                : isFailed
                                  ? 'border border-rose-500/40 bg-rose-950/40 text-rose-300'
                                  : 'border border-fuchsia-500/40 bg-fuchsia-950/40 text-fuchsia-300'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {log.actor ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-white">@{log.actor.username}</span>
                            <span className="text-muted-foreground text-[10px]">
                              {log.actor.email}
                            </span>
                          </div>
                        ) : log.target ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-white">@{log.target.username}</span>
                            <span className="text-muted-foreground text-[10px]">
                              {log.target.email}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-slate-300">
                        {log.details || 'Operational action logged.'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="border-border/40 flex items-center justify-between pt-3">
          <span className="text-muted-foreground text-[11px]">
            Showing {logs.length} of {total} records
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => fetchActivity(page - 1)}
              className="border-border/70 bg-card/60 text-muted-foreground hover:bg-card rounded-lg border px-3 py-1 text-xs hover:text-white disabled:opacity-40"
            >
              Previous
            </button>

            <span className="text-muted-foreground px-2 text-[11px]">
              Page {page} of {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => fetchActivity(page + 1)}
              className="border-border/70 bg-card/60 text-muted-foreground hover:bg-card rounded-lg border px-3 py-1 text-xs hover:text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
