import * as React from 'react';
import { EvaluatorSidebar, type EvaluatorSidebarProps } from './evaluator-sidebar';

export interface EvaluatorShellProps extends EvaluatorSidebarProps {
  children: React.ReactNode;
}

export function EvaluatorShell({
  children,
  username,
  pendingEvaluationsCount,
  isPortalOnline,
}: EvaluatorShellProps) {
  return (
    <div className="bg-background text-foreground relative min-h-screen">
      {/* Background Matrix Grid Pattern */}
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-40"
        aria-hidden="true"
      />

      {/* Cyber Glow Orbs */}
      <div
        className="pointer-events-none fixed -top-32 left-1/4 h-96 w-96 rounded-full bg-cyan-600/10 blur-[120px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none fixed right-1/4 bottom-0 h-96 w-96 rounded-full bg-teal-600/10 blur-[120px]"
        aria-hidden="true"
      />

      {/* Persistent Left Navigation Sidebar */}
      <EvaluatorSidebar
        username={username}
        pendingEvaluationsCount={pendingEvaluationsCount}
        isPortalOnline={isPortalOnline}
      />

      {/* Main Workspace Frame */}
      <div className="relative z-10 flex min-h-screen flex-col md:pl-72">
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
