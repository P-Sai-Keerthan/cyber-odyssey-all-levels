'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  getTeamsAction,
  getTeamDetailsAction,
  blockTeamAction,
  unblockTeamAction,
  deleteTeamAction,
  type TeamListItem,
  type TeamDetailData,
} from '@/lib/actions/creator-actions';
import { ConfirmationModal } from './confirmation-modal';
import { TemporaryCredentialButton } from '@/components/creator/temporary-credential-button';
import { formatDate } from '@/lib/utils/date-formatter';

export interface TeamsClientProps {
  initialTeams: TeamListItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
}

export function TeamsClient({
  initialTeams,
  initialTotal,
  initialPage,
  initialTotalPages,
}: TeamsClientProps) {
  const router = useRouter();
  const [teams, setTeams] = React.useState<TeamListItem[]>(initialTeams);
  const [total, setTotal] = React.useState(initialTotal);
  const [page, setPage] = React.useState(initialPage);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);

  const [statusFilter, setStatusFilter] = React.useState('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  // Detail Modal State
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);
  const [selectedTeamDetail, setSelectedTeamDetail] = React.useState<TeamDetailData | null>(null);
  const [isDetailLoading, setIsDetailLoading] = React.useState(false);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = React.useState<{
    isOpen: boolean;
    type: 'block' | 'unblock' | 'delete';
    targetTeam: { id: string; name: string };
  }>({
    isOpen: false,
    type: 'block',
    targetTeam: { id: '', name: '' },
  });
  const [isActionPending, setIsActionPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ text: string; isError?: boolean } | null>(null);

  const fetchTeams = React.useCallback(
    async (targetPage = 1, status = statusFilter, search = searchQuery) => {
      setIsLoading(true);
      try {
        const result = await getTeamsAction({
          page: targetPage,
          limit: 15,
          status,
          search,
        });

        if (result.success && result.data) {
          setTeams(result.data.teams);
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
    [statusFilter, searchQuery],
  );

  async function handleOpenDetail(teamId: string) {
    setSelectedTeamId(teamId);
    setSelectedTeamDetail(null);
    setIsDetailLoading(true);

    try {
      const result = await getTeamDetailsAction(teamId);
      if (result.success && result.data) {
        setSelectedTeamDetail(result.data);
      }
    } catch {
      // Fallback
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleConfirmAction() {
    if (isActionPending || !confirmModal.targetTeam.id) return;
    setIsActionPending(true);
    setFeedback(null);

    const { type, targetTeam } = confirmModal;

    try {
      let result;
      if (type === 'block') {
        result = await blockTeamAction(targetTeam.id);
      } else if (type === 'unblock') {
        result = await unblockTeamAction(targetTeam.id);
      } else if (type === 'delete') {
        result = await deleteTeamAction(targetTeam.id);
      }

      if (result && result.success) {
        setFeedback({
          text:
            type === 'block'
              ? `Squad "${targetTeam.name}" has been blocked from event participation.`
              : type === 'unblock'
                ? `Squad "${targetTeam.name}" unblocked. Status restored to ACTIVE.`
                : `Squad "${targetTeam.name}" deleted. Members have been unassigned and can join new squads.`,
        });
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        setSelectedTeamId(null);
        setSelectedTeamDetail(null);
        await fetchTeams(page);
        router.refresh();
      } else {
        setFeedback({
          text: result?.error || `Failed to execute ${type} operation on squad.`,
          isError: true,
        });
      }
    } catch {
      setFeedback({ text: 'Network error executing squad operation.', isError: true });
    } finally {
      setIsActionPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Action Feedback Banner */}
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search squads by team name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  fetchTeams(1, statusFilter, searchQuery);
                }
              }}
              className="border-border/80 bg-background/70 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border px-4 py-2 font-mono text-xs focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              aria-label="Filter squads by status"
              onChange={(e) => {
                const s = e.target.value;
                setStatusFilter(s);
                fetchTeams(1, s, searchQuery);
              }}
              className="border-border/80 bg-background/70 text-foreground rounded-xl border px-3 py-2 font-mono text-xs focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="BLOCKED">BLOCKED</option>
              <option value="DISQUALIFIED">DISQUALIFIED</option>
            </select>

            <button
              type="button"
              onClick={() => fetchTeams(1, statusFilter, searchQuery)}
              className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-950/40 px-4 py-2 font-mono text-xs font-semibold text-fuchsia-200 transition-all hover:bg-fuchsia-900/60"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Teams Table */}
      <div className="border-border/80 bg-card/60 overflow-hidden rounded-2xl border backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="border-border/60 bg-background/60 text-muted-foreground border-b uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Squad Name</th>
                <th className="px-4 py-3 font-semibold">Squad ID</th>
                <th className="px-4 py-3 font-semibold">Lead Investigator</th>
                <th className="px-4 py-3 font-semibold">Members</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Score</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-3 animate-spin rounded-full border-2 border-fuchsia-400 border-t-transparent" />
                      Loading squad registry...
                    </span>
                  </td>
                </tr>
              ) : teams.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    No squads found matching criteria.
                  </td>
                </tr>
              ) : (
                teams.map((team) => (
                  <tr key={team.id} className="hover:bg-background/40 transition-colors">
                    <td className="px-4 py-3 font-bold text-white">{team.name}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-400">{team.id}</td>
                    <td className="px-4 py-3">
                      {team.head ? (
                        <div className="flex flex-col">
                          <span className="text-foreground font-semibold">
                            @{team.head.username}
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {team.head.email}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="border-border/60 bg-background/50 rounded-md border px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                        {team.memberCount} / 3
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                          team.status === 'ACTIVE'
                            ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-400'
                            : 'border-rose-500/30 bg-rose-950/40 text-rose-400'
                        }`}
                      >
                        {team.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-amber-300">{team.score} PTS</td>
                    <td className="text-muted-foreground px-4 py-3 text-[11px]">
                      {formatDate(team.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(team.id)}
                        className="border-border/80 bg-background/60 rounded-lg border px-2.5 py-1 text-xs font-semibold text-slate-300 transition-colors hover:border-fuchsia-500/40 hover:text-fuchsia-300"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="border-border/60 bg-background/40 flex items-center justify-between border-t px-4 py-3 font-mono text-xs">
          <span className="text-muted-foreground">
            Showing {teams.length} of {total} squads
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => fetchTeams(page - 1)}
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
              onClick={() => fetchTeams(page + 1)}
              className="border-border/70 bg-card/60 text-muted-foreground hover:bg-card rounded-lg border px-3 py-1 text-xs hover:text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Team Details Modal */}
      {selectedTeamId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-details-title"
        >
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedTeamId(null)}
            aria-hidden="true"
          />

          <div className="border-border/80 bg-card/95 relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-6 font-mono text-xs shadow-2xl backdrop-blur-2xl">
            {isDetailLoading || !selectedTeamDetail ? (
              <div className="p-12 text-center text-slate-400">
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 animate-spin rounded-full border-2 border-fuchsia-400 border-t-transparent" />
                  Loading squad telemetry...
                </span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <div className="border-border/50 flex items-start justify-between border-b pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 id="team-details-title" className="text-lg font-bold text-white">
                        {selectedTeamDetail.name}
                      </h3>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          selectedTeamDetail.status === 'ACTIVE'
                            ? 'border border-emerald-500/40 bg-emerald-950/60 text-emerald-400'
                            : 'border border-rose-500/40 bg-rose-950/60 text-rose-400'
                        }`}
                      >
                        {selectedTeamDetail.status}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      Squad ID: {selectedTeamDetail.id}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedTeamId(null)}
                    className="text-muted-foreground rounded-lg p-1.5 hover:text-white"
                    aria-label="Close squad details"
                  >
                    ✕
                  </button>
                </div>

                {/* Score & Member Metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="border-border/60 bg-background/50 rounded-xl border p-3">
                    <span className="text-muted-foreground text-[10px] uppercase">SCORE</span>
                    <div className="text-base font-bold text-amber-300">
                      {selectedTeamDetail.score} PTS
                    </div>
                  </div>

                  <div className="border-border/60 bg-background/50 rounded-xl border p-3">
                    <span className="text-muted-foreground text-[10px] uppercase">ROSTER</span>
                    <div className="text-base font-bold text-white">
                      {selectedTeamDetail.members.length} / 3 Investigators
                    </div>
                  </div>

                  <div className="border-border/60 bg-background/50 rounded-xl border p-3">
                    <span className="text-muted-foreground text-[10px] uppercase">SUBMISSIONS</span>
                    <div className="text-base font-bold text-cyan-300">
                      {selectedTeamDetail.submissions.length} Records
                    </div>
                  </div>
                </div>

                {/* Squad Members Roster */}
                <div className="space-y-2">
                  <span className="text-muted-foreground text-[10px] font-bold text-fuchsia-400 uppercase">
                    SQUAD MEMBERS ROSTER
                  </span>
                  <div className="divide-border/40 border-border/60 bg-background/50 divide-y rounded-xl border">
                    {selectedTeamDetail.members.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-3">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">@{member.username}</span>
                            <span className="text-[10px] font-bold text-fuchsia-400 uppercase">
                              [
                              {member.role === 'CREATOR' || member.role === 'HEAD'
                                ? 'HEAD'
                                : 'MEMBER'}
                              ]
                            </span>
                            {member.isOnline && (
                              <span
                                className="size-1.5 rounded-full bg-emerald-400"
                                title="Online"
                              />
                            )}
                          </div>
                          <span className="text-muted-foreground text-[11px]">{member.email}</span>
                        </div>

                        <div className="text-muted-foreground text-right text-[11px]">
                          Joined: {formatDate(member.joinedAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Squad credential recovery (Creator spec section 6). */}
                <div className="border-border/60 space-y-2 border-t pt-4">
                  <span className="text-muted-foreground text-[10px] font-bold text-fuchsia-400 uppercase">
                    SQUAD CREDENTIAL RECOVERY
                  </span>
                  <p className="text-muted-foreground font-sans text-[11px] leading-relaxed">
                    The squad password is stored as a one-way hash and cannot be displayed. Issue a
                    new temporary squad password if the squad has lost it.
                  </p>
                  <TemporaryCredentialButton
                    target="TEAM"
                    targetId={selectedTeamDetail.id}
                    label={selectedTeamDetail.name}
                  />
                </div>

                {/* Action Controls */}
                <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <div className="flex items-center gap-2">
                    {selectedTeamDetail.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmModal({
                            isOpen: true,
                            type: 'block',
                            targetTeam: {
                              id: selectedTeamDetail.id,
                              name: selectedTeamDetail.name,
                            },
                          })
                        }
                        className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3.5 py-2 font-semibold text-amber-300 transition-all hover:bg-amber-900/50"
                      >
                        Block Squad
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmModal({
                            isOpen: true,
                            type: 'unblock',
                            targetTeam: {
                              id: selectedTeamDetail.id,
                              name: selectedTeamDetail.name,
                            },
                          })
                        }
                        className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-2 font-semibold text-emerald-300 transition-all hover:bg-emerald-900/50"
                      >
                        Unblock Squad
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          isOpen: true,
                          type: 'delete',
                          targetTeam: {
                            id: selectedTeamDetail.id,
                            name: selectedTeamDetail.name,
                          },
                        })
                      }
                      className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3.5 py-2 font-semibold text-rose-300 transition-all hover:bg-rose-900/50"
                    >
                      Delete Squad
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedTeamId(null)}
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
            ? `Delete Squad "${confirmModal.targetTeam.name}"?`
            : confirmModal.type === 'block'
              ? `Block Squad "${confirmModal.targetTeam.name}"?`
              : `Unblock Squad "${confirmModal.targetTeam.name}"?`
        }
        description={
          confirmModal.type === 'delete'
            ? 'Deleting the squad will detach and unassign its participant members without deleting their accounts. They will be free to join or create other teams.'
            : confirmModal.type === 'block'
              ? 'Blocked squads cannot submit work or continue event challenges. Roster records remain visible for audit.'
              : 'This restores the squad status to ACTIVE and re-enables event actions for its members.'
        }
        confirmLabel={
          confirmModal.type === 'delete'
            ? 'Delete Squad'
            : confirmModal.type === 'block'
              ? 'Block Squad'
              : 'Unblock Squad'
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
