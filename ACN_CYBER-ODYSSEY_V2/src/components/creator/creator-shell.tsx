import * as React from 'react';
import { CreatorSidebar } from './creator-sidebar';

export interface CreatorShellProps {
  username: string;
  pendingApprovalsCount?: number | undefined;
  isPortalOnline?: boolean | undefined;
  children: React.ReactNode;
}

export function CreatorShell({
  username,
  pendingApprovalsCount = 0,
  isPortalOnline = true,
  children,
}: CreatorShellProps) {
  return (
    <div className="cyber-grid-bg bg-background text-foreground relative min-h-screen">
      {/* Background Ambient Glow Effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 right-10 h-[500px] w-[500px] rounded-full bg-gradient-to-b from-fuchsia-600/10 via-transparent to-transparent blur-3xl" />
        <div className="absolute -bottom-40 left-80 h-[500px] w-[500px] rounded-full bg-gradient-to-t from-cyan-600/10 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Persistent Left Sidebar Navigation */}
      <CreatorSidebar
        username={username}
        pendingApprovalsCount={pendingApprovalsCount}
        isPortalOnline={isPortalOnline}
      />

      {/* Main Content Workspace */}
      <div className="relative z-10 flex min-h-screen flex-col md:pl-72">
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl space-y-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
