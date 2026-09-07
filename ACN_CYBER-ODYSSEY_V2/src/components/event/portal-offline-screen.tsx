import * as React from 'react';
import Link from 'next/link';
import { logoutAction } from '@/lib/actions/auth-actions';

export function PortalOfflineScreen() {
  return (
    <div className="cyber-grid-bg bg-background text-foreground relative flex min-h-screen flex-col items-center justify-center p-4">
      {/* Background Ambient Glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 right-10 h-[500px] w-[500px] rounded-full bg-gradient-to-b from-amber-600/15 via-transparent to-transparent blur-3xl" />
        <div className="absolute -bottom-40 left-10 h-[500px] w-[500px] rounded-full bg-gradient-to-t from-rose-600/15 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="border-border/80 bg-card/80 relative z-10 mx-auto max-w-lg space-y-6 rounded-2xl border p-8 text-center shadow-2xl backdrop-blur-xl">
        {/* Status Indicator */}
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-950/30 px-3.5 py-1.5 font-mono text-xs font-semibold text-amber-300">
          <span className="size-2 animate-pulse rounded-full bg-amber-400" />
          <span>PORTAL MAINTENANCE // STANDBY</span>
        </div>

        <div className="space-y-2">
          <div className="font-mono text-xs font-bold tracking-[0.25em] text-cyan-400 uppercase">
            ACN CYBER ODYSSEY
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            Portal Temporarily Offline
          </h1>
          <p className="text-muted-foreground font-mono text-xs sm:text-sm">
            The Cyber Odyssey event portal is currently offline for marshal maintenance or mission
            scheduling. Participant operations and submissions are temporarily paused.
          </p>
        </div>

        <div className="border-border/60 bg-background/60 space-y-3 rounded-xl border p-4 text-left font-mono text-xs text-slate-300">
          <div className="flex items-center gap-2 font-bold text-amber-400">
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>INSTRUCTIONS FOR INVESTIGATORS</span>
          </div>
          <ul className="space-y-1.5 text-slate-400">
            <li>• Please remain on standby at your squad workstations.</li>
            <li>• Do not close your investigation evidence files.</li>
            <li>• Marshals will announce over the intercom when competition resumes.</li>
          </ul>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <form action={logoutAction} className="w-full sm:w-auto">
            <button
              type="submit"
              className="border-border/80 bg-card/60 text-muted-foreground focus-visible:ring-cyan-accent flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 font-mono text-xs font-semibold transition-all hover:border-rose-500/40 hover:bg-rose-950/20 hover:text-rose-300 focus-visible:ring-1 focus-visible:outline-none"
            >
              <span>Sign Out</span>
            </button>
          </form>

          <Link
            href="/login"
            className="focus-visible:ring-cyan-accent flex items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-4 py-2.5 font-mono text-xs font-semibold text-cyan-300 transition-all hover:bg-cyan-900/40 focus-visible:ring-1 focus-visible:outline-none"
          >
            <span>Check Status (Reload)</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
