'use client';

import * as React from 'react';
import { getActivityLogsAction, type AuditLogItem } from '@/lib/actions/creator-actions';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface AuditLogClientProps {
  initialLogs: AuditLogItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
}

export function AuditLogClient({
  initialLogs,
  initialTotal,
  initialPage,
  initialTotalPages,
}: AuditLogClientProps) {
  const [logs, setLogs] = React.useState<AuditLogItem[]>(initialLogs);
  const [total, setTotal] = React.useState(initialTotal);
  const [page, setPage] = React.useState(initialPage);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);

  const [actionFilter, setActionFilter] = React.useState('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  const fetchLogs = React.useCallback(
    async (targetPage = 1, action = actionFilter, search = searchQuery) => {
      setIsLoading(true);
      try {
        const result = await getActivityLogsAction({
          page: targetPage,
          limit: 25,
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
    [actionFilter, searchQuery],
  );

  const actionTypes = [
    { value: 'ALL', label: 'All Operations' },
    { value: 'STAFF_APPROVED', label: 'STAFF_APPROVED' },
    { value: 'STAFF_REJECTED', label: 'STAFF_REJECTED' },
    { value: 'ACCOUNT_BLOCKED', label: 'ACCOUNT_BLOCKED' },
    { value: 'ACCOUNT_UNBLOCKED', label: 'ACCOUNT_UNBLOCKED' },
    { value: 'ACCOUNT_DELETED', label: 'ACCOUNT_DELETED' },
    { value: 'TEAM_BLOCKED', label: 'TEAM_BLOCKED' },
    { value: 'TEAM_UNBLOCKED', label: 'TEAM_UNBLOCKED' },
    { value: 'TEAM_DELETED', label: 'TEAM_DELETED' },
    { value: 'PORTAL_ONLINE', label: 'PORTAL_ONLINE' },
    { value: 'PORTAL_OFFLINE', label: 'PORTAL_OFFLINE' },
    { value: 'LOGIN', label: 'LOGIN' },
    { value: 'LOGOUT', label: 'LOGOUT' },
  ];

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* Search & Filter Header */}
      <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-5 backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search audit trail by actor, target, or operation details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  fetchLogs(1, actionFilter, searchQuery);
                }
              }}
              className="border-border/80 bg-background/70 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border px-4 py-2 text-xs focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={actionFilter}
              aria-label="Filter audit logs by action"
              onChange={(e) => {
                const a = e.target.value;
                setActionFilter(a);
                fetchLogs(1, a, searchQuery);
              }}
              className="border-border/80 bg-background/70 text-foreground rounded-xl border px-3 py-2 text-xs focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
            >
              {actionTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => fetchLogs(1, actionFilter, searchQuery)}
              className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-950/40 px-4 py-2 font-semibold text-fuchsia-200 transition-all hover:bg-fuchsia-900/60"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-border/60 bg-background/60 text-muted-foreground text-[10px] uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Timestamp (Local)</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">Target</th>
                <th className="px-4 py-3 font-semibold">Operation Details</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-3 animate-spin rounded-full border-2 border-fuchsia-400 border-t-transparent" />
                      Loading audit log records...
                    </span>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    No audit records matching query.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isDestructive =
                    log.action.includes('DELETED') ||
                    log.action.includes('BLOCKED') ||
                    log.action.includes('OFFLINE');
                  const isPositive =
                    log.action.includes('APPROVED') ||
                    log.action.includes('UNBLOCKED') ||
                    log.action.includes('ONLINE');

                  return (
                    <tr key={log.id} className="hover:bg-background/40 transition-colors">
                      <td className="text-muted-foreground px-4 py-3 text-[11px] whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                            isDestructive
                              ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                              : isPositive
                                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                                : 'border-border/80 bg-background/60 text-slate-300'
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
                              {log.actor.role || 'CREATOR'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">System</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {log.target ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-white">@{log.target.username}</span>
                            <span className="text-muted-foreground text-[10px]">
                              {log.target.email}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-slate-300">
                        {log.details || 'Action logged.'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="border-border/60 bg-background/40 flex items-center justify-between border-t px-4 py-3">
          <span className="text-muted-foreground text-[11px]">
            Showing {logs.length} of {total} audit records
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => fetchLogs(page - 1)}
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
              onClick={() => fetchLogs(page + 1)}
              className="border-border/70 bg-card/60 text-muted-foreground hover:bg-card rounded-lg border px-3 py-1 text-xs hover:text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
