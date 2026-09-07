'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  getAccountsAction,
  getAccountDetailsAction,
  blockAccountAction,
  unblockAccountAction,
  deleteAccountAction,
  type AccountListItem,
  type AccountDetailData,
} from '@/lib/actions/creator-actions';
import { ConfirmationModal } from './confirmation-modal';
import { TemporaryCredentialButton } from './temporary-credential-button';
import { formatDate, formatDateTime, formatTime } from '@/lib/utils/date-formatter';

export interface AccountsClientProps {
  initialAccounts: AccountListItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
}

export function AccountsClient({
  initialAccounts,
  initialTotal,
  initialPage,
  initialTotalPages,
}: AccountsClientProps) {
  const router = useRouter();
  const [accounts, setAccounts] = React.useState<AccountListItem[]>(initialAccounts);
  const [total, setTotal] = React.useState(initialTotal);
  const [page, setPage] = React.useState(initialPage);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);

  // Filters
  const [roleFilter, setRoleFilter] = React.useState('ALL');
  const [statusFilter, setStatusFilter] = React.useState('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  // Account Detail Modal State
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [selectedUserDetail, setSelectedUserDetail] = React.useState<AccountDetailData | null>(
    null,
  );
  const [isDetailLoading, setIsDetailLoading] = React.useState(false);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = React.useState<{
    isOpen: boolean;
    type: 'block' | 'unblock' | 'delete';
    targetUser: { id: string; username: string; email: string };
  }>({
    isOpen: false,
    type: 'block',
    targetUser: { id: '', username: '', email: '' },
  });
  const [isActionPending, setIsActionPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ text: string; isError?: boolean } | null>(null);

  // Fetch accounts when filters/page change
  const fetchAccounts = React.useCallback(
    async (targetPage = 1, role = roleFilter, status = statusFilter, search = searchQuery) => {
      setIsLoading(true);
      try {
        const result = await getAccountsAction({
          page: targetPage,
          limit: 15,
          role,
          status,
          search,
        });

        if (result.success && result.data) {
          setAccounts(result.data.accounts);
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
    [roleFilter, statusFilter, searchQuery],
  );

  async function handleOpenDetail(userId: string) {
    setSelectedUserId(userId);
    setSelectedUserDetail(null);
    setIsDetailLoading(true);

    try {
      const result = await getAccountDetailsAction(userId);
      if (result.success && result.data) {
        setSelectedUserDetail(result.data);
      }
    } catch {
      // Fallback
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleConfirmAction() {
    if (isActionPending || !confirmModal.targetUser.id) return;
    setIsActionPending(true);
    setFeedback(null);

    const { type, targetUser } = confirmModal;

    try {
      let result;
      if (type === 'block') {
        result = await blockAccountAction(targetUser.id);
      } else if (type === 'unblock') {
        result = await unblockAccountAction(targetUser.id);
      } else if (type === 'delete') {
        result = await deleteAccountAction(targetUser.id);
      }

      if (result && result.success) {
        setFeedback({
          text:
            type === 'block'
              ? `Account @${targetUser.username} has been blocked and sessions revoked.`
              : type === 'unblock'
                ? `Account @${targetUser.username} unblocked. Status restored to ACTIVE.`
                : `Account @${targetUser.username} permanently deleted.`,
        });
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        setSelectedUserId(null);
        setSelectedUserDetail(null);
        await fetchAccounts(page);
        router.refresh();
      } else {
        setFeedback({
          text: result?.error || `Failed to execute ${type} operation.`,
          isError: true,
        });
      }
    } catch {
      setFeedback({ text: 'Network error executing operation.', isError: true });
    } finally {
      setIsActionPending(false);
    }
  }

  const roleTabs = [
    { id: 'ALL', label: 'All Accounts' },
    { id: 'PARTICIPANT', label: 'Participants' },
    { id: 'EVALUATOR', label: 'Evaluators' },
    { id: 'ADMIN', label: 'Admins' },
    { id: 'CREATOR', label: 'Creators' },
  ];

  return (
    <div className="space-y-6">
      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`rounded-xl border p-4 font-mono text-xs ${
            feedback.isError
              ? 'border-rose-500/40 bg-rose-950/20 text-rose-300'
              : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-5 backdrop-blur-md">
        {/* Role Tabs */}
        <div className="flex flex-wrap gap-2">
          {roleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setRoleFilter(tab.id);
                fetchAccounts(1, tab.id, statusFilter, searchQuery);
              }}
              className={`rounded-xl px-3.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                roleFilter === tab.id
                  ? 'border border-fuchsia-500/50 bg-fuchsia-950/50 text-fuchsia-200 shadow-[0_0_12px_rgba(217,70,239,0.25)]'
                  : 'border-border/60 bg-background/50 text-muted-foreground hover:border-border border hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Status Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search by username, email, or squad name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  fetchAccounts(1, roleFilter, statusFilter, searchQuery);
                }
              }}
              className="border-border/80 bg-background/70 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border px-4 py-2 font-mono text-xs focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              aria-label="Filter accounts by status"
              onChange={(e) => {
                const s = e.target.value;
                setStatusFilter(s);
                fetchAccounts(1, roleFilter, s, searchQuery);
              }}
              className="border-border/80 bg-background/70 text-foreground rounded-xl border px-3 py-2 font-mono text-xs focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
              <option value="BLOCKED">BLOCKED</option>
              <option value="SUSPENDED">SUSPENDED</option>
              <option value="REJECTED">REJECTED</option>
            </select>

            <button
              type="button"
              onClick={() => fetchAccounts(1, roleFilter, statusFilter, searchQuery)}
              className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-950/40 px-4 py-2 font-mono text-xs font-semibold text-fuchsia-200 transition-all hover:bg-fuchsia-900/60"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="border-border/60 bg-background/60 text-muted-foreground border-b uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Squad / Team</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Last Login</th>
                <th className="px-4 py-3 font-semibold">Last Active</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-3 animate-spin rounded-full border-2 border-fuchsia-400 border-t-transparent" />
                      Loading accounts telemetry...
                    </span>
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    No registered accounts matching filters.
                  </td>
                </tr>
              ) : (
                accounts.map((user) => {
                  const isPending = user.status === 'PENDING_APPROVAL';

                  return (
                    <tr key={user.id} className="hover:bg-background/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">@{user.username}</span>
                            {user.isOnline && (
                              <span
                                className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                                title="Online"
                              />
                            )}
                          </div>
                          <span className="text-muted-foreground text-[11px]">{user.email}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                            user.role === 'CREATOR'
                              ? 'border-fuchsia-500/40 bg-fuchsia-950/40 text-fuchsia-300'
                              : user.role === 'ADMIN'
                                ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                                : user.role === 'EVALUATOR'
                                  ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                                  : 'border-slate-500/30 bg-slate-900/40 text-slate-300'
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                            user.status === 'ACTIVE'
                              ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-400'
                              : isPending
                                ? 'border-amber-500/30 bg-amber-950/40 text-amber-400'
                                : 'border-rose-500/30 bg-rose-950/40 text-rose-400'
                          }`}
                        >
                          {user.status}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {user.team ? (
                          <div className="flex flex-col">
                            <span className="text-foreground font-semibold">{user.team.name}</span>
                            <span className="text-muted-foreground text-[10px] uppercase">
                              {user.team.role === 'CREATOR' || user.team.role === 'HEAD'
                                ? 'HEAD'
                                : 'MEMBER'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60 text-[11px]">—</span>
                        )}
                      </td>

                      <td className="text-muted-foreground px-4 py-3 text-[11px]">
                        {formatDate(user.createdAt)}
                      </td>

                      <td className="text-muted-foreground px-4 py-3 text-[11px]">
                        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                      </td>

                      <td className="text-muted-foreground px-4 py-3 text-[11px]">
                        {user.lastActivityAt ? formatTime(user.lastActivityAt) : 'Inactive'}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(user.id)}
                          className="border-border/80 bg-background/60 rounded-lg border px-2.5 py-1 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="border-border/60 bg-background/40 flex items-center justify-between border-t px-4 py-3 font-mono text-xs">
          <span className="text-muted-foreground">
            Showing {accounts.length} of {total} accounts
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => fetchAccounts(page - 1)}
              className="border-border/70 bg-card/60 text-muted-foreground hover:bg-card rounded-lg border px-3 py-1 text-xs hover:text-white disabled:opacity-40"
            >
              Previous
            </button>

            <span className="text-muted-foreground px-2">
              Page {page} of {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => fetchAccounts(page + 1)}
              className="border-border/70 bg-card/60 text-muted-foreground hover:bg-card rounded-lg border px-3 py-1 text-xs hover:text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Account Details Slide-Over / Modal */}
      {selectedUserId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-details-title"
        >
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedUserId(null)}
            aria-hidden="true"
          />

          <div className="border-border/80 bg-card/95 relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-6 font-mono text-xs shadow-2xl backdrop-blur-2xl">
            {isDetailLoading || !selectedUserDetail ? (
              <div className="p-12 text-center text-slate-400">
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 animate-spin rounded-full border-2 border-fuchsia-400 border-t-transparent" />
                  Loading account profile...
                </span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <div className="border-border/50 flex items-start justify-between border-b pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 id="account-details-title" className="text-lg font-bold text-white">
                        @{selectedUserDetail.username}
                      </h3>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          selectedUserDetail.status === 'ACTIVE'
                            ? 'border border-emerald-500/40 bg-emerald-950/60 text-emerald-400'
                            : 'border border-rose-500/40 bg-rose-950/60 text-rose-400'
                        }`}
                      >
                        {selectedUserDetail.status}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{selectedUserDetail.email}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedUserId(null)}
                    className="text-muted-foreground rounded-lg p-1.5 hover:text-white"
                    aria-label="Close details"
                  >
                    ✕
                  </button>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="border-border/60 bg-background/50 rounded-xl border p-3">
                    <span className="text-muted-foreground text-[10px] uppercase">ROLE</span>
                    <div className="font-bold text-white">{selectedUserDetail.role}</div>
                  </div>

                  <div className="border-border/60 bg-background/50 rounded-xl border p-3">
                    <span className="text-muted-foreground text-[10px] uppercase">LOGIN COUNT</span>
                    <div className="font-bold text-cyan-300">{selectedUserDetail.loginCount}</div>
                  </div>

                  <div className="border-border/60 bg-background/50 rounded-xl border p-3">
                    <span className="text-muted-foreground text-[10px] uppercase">
                      FAILED LOGINS
                    </span>
                    <div className="font-bold text-amber-300">
                      {selectedUserDetail.failedLoginCount}
                    </div>
                  </div>

                  <div className="border-border/60 bg-background/50 rounded-xl border p-3">
                    <span className="text-muted-foreground text-[10px] uppercase">SESSION</span>
                    <div className="font-bold">
                      {selectedUserDetail.isOnline ? (
                        <span className="text-emerald-400">● ONLINE</span>
                      ) : (
                        <span className="text-slate-500">○ OFFLINE</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Squad Information (if participant) */}
                {selectedUserDetail.team && (
                  <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-4">
                    <span className="text-muted-foreground text-[10px] font-bold text-cyan-400 uppercase">
                      OPERATIONAL SQUAD ASSIGNMENT
                    </span>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-white">
                          {selectedUserDetail.team.name}
                        </div>
                        <span className="text-muted-foreground text-[11px]">
                          Squad Role:{' '}
                          {selectedUserDetail.team.role === 'CREATOR' ||
                          selectedUserDetail.team.role === 'HEAD'
                            ? 'HEAD'
                            : 'MEMBER'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-4 text-[11px]">
                  <div className="border-border/30 flex justify-between border-b py-1">
                    <span className="text-muted-foreground">Registered At:</span>
                    <span className="text-white">
                      {formatDateTime(selectedUserDetail.createdAt)}
                    </span>
                  </div>
                  <div className="border-border/30 flex justify-between border-b py-1">
                    <span className="text-muted-foreground">Last Successful Login:</span>
                    <span className="text-white">
                      {selectedUserDetail.lastLoginAt
                        ? formatDateTime(selectedUserDetail.lastLoginAt)
                        : 'None'}
                    </span>
                  </div>
                  <div className="border-border/30 flex justify-between border-b py-1">
                    <span className="text-muted-foreground">Last Logout:</span>
                    <span className="text-white">
                      {selectedUserDetail.lastLogoutAt
                        ? formatDateTime(selectedUserDetail.lastLogoutAt)
                        : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">Last Activity Trace:</span>
                    <span className="text-white">
                      {selectedUserDetail.lastActivityAt
                        ? formatDateTime(selectedUserDetail.lastActivityAt)
                        : 'Inactive'}
                    </span>
                  </div>
                </div>

                {/* Credential recovery (Creator spec section 10).
                    Replaces the credential; never reveals the existing one. */}
                {selectedUserDetail.role !== 'CREATOR' && (
                  <div className="border-border/60 space-y-2 border-t pt-4">
                    <span className="text-muted-foreground text-[10px] font-bold text-fuchsia-400 uppercase">
                      CREDENTIAL RECOVERY
                    </span>
                    <p className="text-muted-foreground font-sans text-[11px] leading-relaxed">
                      Existing passwords are stored as one-way hashes and cannot be displayed to
                      anyone. To restore access, issue a new temporary password.
                    </p>
                    <TemporaryCredentialButton
                      target="ACCOUNT"
                      targetId={selectedUserDetail.id}
                      label={`@${selectedUserDetail.username}`}
                    />
                  </div>
                )}

                {/* Action Controls */}
                <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <div className="flex items-center gap-2">
                    {selectedUserDetail.role !== 'CREATOR' && (
                      <>
                        {selectedUserDetail.status === 'ACTIVE' ? (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmModal({
                                isOpen: true,
                                type: 'block',
                                targetUser: {
                                  id: selectedUserDetail.id,
                                  username: selectedUserDetail.username,
                                  email: selectedUserDetail.email,
                                },
                              })
                            }
                            className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3.5 py-2 font-semibold text-amber-300 transition-all hover:bg-amber-900/50"
                          >
                            Block Account
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmModal({
                                isOpen: true,
                                type: 'unblock',
                                targetUser: {
                                  id: selectedUserDetail.id,
                                  username: selectedUserDetail.username,
                                  email: selectedUserDetail.email,
                                },
                              })
                            }
                            className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-2 font-semibold text-emerald-300 transition-all hover:bg-emerald-900/50"
                          >
                            Unblock Account
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              isOpen: true,
                              type: 'delete',
                              targetUser: {
                                id: selectedUserDetail.id,
                                username: selectedUserDetail.username,
                                email: selectedUserDetail.email,
                              },
                            })
                          }
                          className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3.5 py-2 font-semibold text-rose-300 transition-all hover:bg-rose-900/50"
                        >
                          Delete Account
                        </button>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedUserId(null)}
                    className="border-border/80 bg-background/60 text-muted-foreground rounded-xl border px-4 py-2 transition-colors hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={
          confirmModal.type === 'delete'
            ? `Delete Account: @${confirmModal.targetUser.username}?`
            : confirmModal.type === 'block'
              ? `Block Account: @${confirmModal.targetUser.username}?`
              : `Unblock Account: @${confirmModal.targetUser.username}?`
        }
        description={
          confirmModal.type === 'delete'
            ? 'This permanently removes the account and associated session records from the database. The user may register again under normal signup rules.'
            : confirmModal.type === 'block'
              ? 'Blocked accounts cannot log in, all active sessions are immediately invalidated, and protected actions are blocked. Audit history remains preserved.'
              : 'This restores the account status to ACTIVE. The user will be permitted to log in.'
        }
        confirmLabel={
          confirmModal.type === 'delete'
            ? 'Delete Account'
            : confirmModal.type === 'block'
              ? 'Block Account'
              : 'Unblock Account'
        }
        variant={
          confirmModal.type === 'delete'
            ? 'danger'
            : confirmModal.type === 'block'
              ? 'warning'
              : 'primary'
        }
        isPending={isActionPending}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
