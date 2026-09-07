'use client';

import * as React from 'react';
import { findTeamHead } from '@/lib/team/roles';

export interface TeamMemberDisplay {
  id: string;
  userId: string;
  username: string;
  role: string; // HEAD or MEMBER (or legacy CREATOR)
  joinedAt: Date | string;
}

export interface TeamCardProps {
  teamName: string;
  teamCode: string;
  members: TeamMemberDisplay[];
  currentUserId: string;
}

export function TeamCard({ teamName, teamCode, members, currentUserId }: TeamCardProps) {
  const [copied, setCopied] = React.useState(false);

  const capacity = members.length;
  const isFull = capacity >= 3;

  // Authoritative separation of team head/captain and regular members
  const headMember = findTeamHead(members);
  const regularMembers = members.filter((m) => m !== headMember);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(teamCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  }

  return (
    <div className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-5 shadow-2xl backdrop-blur-md sm:p-6">
      {/* Top Header & Team Code */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="text-muted-foreground flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase">
            <span>OPERATIONAL SQUAD</span>
            <span>•</span>
            <span className="text-cyan-accent">ACTIVE</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{teamName}</h2>
        </div>

        {/* Team Code with Copy Button */}
        <div className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-3 py-2">
          <div className="flex flex-col">
            <span className="text-muted-foreground font-mono text-[9px] tracking-wider uppercase">
              Team Code
            </span>
            <span className="font-mono text-sm font-bold tracking-widest text-cyan-300">
              {teamCode}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="focus-visible:ring-cyan-accent ml-2 rounded-lg border border-cyan-500/40 bg-cyan-900/40 p-1.5 text-cyan-200 transition-colors hover:border-cyan-300 hover:bg-cyan-800/60 focus-visible:ring-1 focus-visible:outline-none"
            aria-label="Copy team code"
            title="Copy team code"
          >
            {copied ? (
              <svg
                className="size-4 text-emerald-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Team Capacity Progress Bar */}
      <div className="border-border/50 space-y-1.5 border-t pt-4">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-muted-foreground">UNIT CAPACITY</span>
          <span className={`font-semibold ${isFull ? 'text-amber-400' : 'text-cyan-400'}`}>
            {capacity} / 3 {isFull ? '(SQUAD FULL)' : '(OPEN FOR JOIN)'}
          </span>
        </div>
        <div className="bg-background/80 h-2 w-full overflow-hidden rounded-full">
          <div
            className={`h-full transition-all duration-300 ${
              isFull
                ? 'bg-gradient-to-r from-cyan-400 via-teal-400 to-amber-400'
                : 'bg-gradient-to-r from-cyan-500 to-teal-400'
            }`}
            style={{ width: `${(capacity / 3) * 100}%` }}
          />
        </div>
      </div>

      {/* Squad Roster: Separated HEAD and MEMBERS sections */}
      <div className="border-border/50 space-y-4 border-t pt-4">
        <span className="text-muted-foreground font-mono text-xs font-semibold tracking-wider uppercase">
          Squad Roster
        </span>

        {/* TEAM HEAD */}
        {headMember && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="font-bold tracking-wider text-fuchsia-400 uppercase">HEAD</span>
              <span className="text-muted-foreground text-[10px]">Team Captain</span>
            </div>

            <div
              className={`flex items-center justify-between rounded-xl border p-3 font-mono text-xs transition-colors ${
                headMember.userId === currentUserId
                  ? 'border-fuchsia-500/50 bg-fuchsia-950/30 text-fuchsia-100 shadow-[0_0_12px_rgba(217,70,239,0.15)]'
                  : 'text-foreground/95 border-fuchsia-500/30 bg-fuchsia-950/15'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full border border-fuchsia-500/40 bg-fuchsia-950/60 font-mono text-[10px] font-bold text-fuchsia-300">
                  👑
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{headMember.username}</span>
                  {headMember.userId === currentUserId && (
                    <span className="rounded border border-cyan-500/30 bg-cyan-950/60 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300 uppercase">
                      You
                    </span>
                  )}
                </div>
              </div>

              <span className="rounded-md border border-fuchsia-500/40 bg-fuchsia-950/50 px-2 py-0.5 text-[9px] font-bold tracking-wider text-fuchsia-300 uppercase">
                HEAD
              </span>
            </div>
          </div>
        )}

        {/* MEMBERS */}
        <div className="space-y-2">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-muted-foreground font-bold tracking-wider uppercase">
              MEMBERS
            </span>
            <span className="text-muted-foreground text-[10px]">
              {regularMembers.length} of 2 rostered
            </span>
          </div>

          {regularMembers.map((member, index) => {
            const isCurrentUser = member.userId === currentUserId;

            return (
              <div
                key={member.id}
                className={`flex items-center justify-between rounded-xl border p-3 font-mono text-xs transition-colors ${
                  isCurrentUser
                    ? 'border-cyan-500/40 bg-cyan-950/20 text-cyan-100'
                    : 'border-border/60 bg-background/50 text-foreground/90'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="bg-card text-muted-foreground flex size-6 items-center justify-center rounded-full font-mono text-[10px]">
                    0{index + 2}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{member.username}</span>
                    {isCurrentUser && (
                      <span className="rounded border border-cyan-500/30 bg-cyan-950/60 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300 uppercase">
                        You
                      </span>
                    )}
                  </div>
                </div>

                <span className="rounded-md border border-cyan-500/40 bg-cyan-950/30 px-2 py-0.5 text-[9px] font-bold tracking-wider text-cyan-300 uppercase">
                  MEMBER
                </span>
              </div>
            );
          })}

          {/* Empty Member Slots */}
          {Array.from({ length: 2 - regularMembers.length }).map((_, i) => (
            <div
              key={`empty-member-${i}`}
              className="border-border/40 text-muted-foreground/50 flex items-center justify-between rounded-xl border border-dashed p-3 font-mono text-xs"
            >
              <div className="flex items-center gap-3">
                <span className="bg-card/30 flex size-6 items-center justify-center rounded-full font-mono text-[10px]">
                  0{regularMembers.length + i + 2}
                </span>
                <span>[ Empty Squad Slot ]</span>
              </div>
              <span className="text-[10px] uppercase">Awaiting Teammate</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
