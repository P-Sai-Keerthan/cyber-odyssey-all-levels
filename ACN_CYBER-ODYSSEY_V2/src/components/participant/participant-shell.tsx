import * as React from 'react';
import { ParticipantSidebar } from './participant-sidebar';

export interface ParticipantShellProps {
  username: string;
  teamName?: string | undefined;
  unreadAnnouncementsCount?: number | undefined;
  children: React.ReactNode;
}

export function ParticipantShell({
  username,
  teamName,
  unreadAnnouncementsCount = 0,
  children,
}: ParticipantShellProps) {
  return (
    <div className="cyber-grid-bg bg-background text-foreground relative min-h-screen">
      {/* Ambient background glow effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 right-10 h-[500px] w-[500px] rounded-full bg-gradient-to-b from-cyan-600/10 via-transparent to-transparent blur-3xl" />
        <div className="absolute -bottom-40 left-80 h-[500px] w-[500px] rounded-full bg-gradient-to-t from-fuchsia-600/10 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Persistent Left Sidebar Navigation */}
      <ParticipantSidebar
        username={username}
        teamName={teamName}
        unreadAnnouncementsCount={unreadAnnouncementsCount}
      />

      {/* Main Content Workspace (Offset by sidebar width on desktop) */}
      <div className="relative z-10 flex min-h-screen flex-col md:pl-72">
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl space-y-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
