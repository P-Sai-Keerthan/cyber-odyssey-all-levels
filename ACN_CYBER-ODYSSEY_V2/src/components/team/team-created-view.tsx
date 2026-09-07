'use client';

import * as React from 'react';
import Link from 'next/link';
import { GradientButton } from '@/components/ui/gradient-button';
import type { CreatedTeamData } from '@/lib/actions/team-actions';

interface TeamCreatedViewProps {
  team: CreatedTeamData;
}

export function TeamCreatedView({ team }: TeamCreatedViewProps) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(team.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  }

  return (
    <div className="animate-in fade-in-0 zoom-in-95 space-y-6 text-center duration-200">
      {/* Success Icon */}
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 shadow-[0_0_25px_rgba(52,211,153,0.3)]">
        <svg
          className="size-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <div className="space-y-1">
        <span className="font-mono text-xs font-semibold tracking-widest text-emerald-400 uppercase">
          Unit Registered Successfully
        </span>
        <h3 className="text-2xl font-bold tracking-tight text-white">{team.name}</h3>
      </div>

      {/* Credentials Card */}
      <div className="border-cyan-accent/40 space-y-4 rounded-2xl border bg-cyan-950/20 p-5 backdrop-blur-md">
        <div className="space-y-1">
          <span className="text-muted-foreground font-mono text-[11px] tracking-wider uppercase">
            Team ID / Joining Code
          </span>
          <div className="flex items-center justify-center gap-3">
            <span className="font-mono text-2xl font-black tracking-widest text-cyan-300">
              {team.code}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="focus-visible:ring-cyan-accent inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 font-mono text-xs text-cyan-200 hover:border-cyan-400 hover:bg-cyan-900/60 focus-visible:ring-1 focus-visible:outline-none"
              aria-label="Copy team code"
            >
              {copied ? (
                <>
                  <svg
                    className="size-3.5 text-emerald-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <svg
                    className="size-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="border-cyan-accent/20 text-muted-foreground/90 border-t pt-3 text-xs">
          <div className="flex items-center justify-between font-mono text-xs">
            <span>TEAM MEMBERS</span>
            <span className="font-semibold text-cyan-400">1 / 3 (Team Head Active)</span>
          </div>
        </div>
      </div>

      {/* Share Guidance */}
      <div className="border-border/70 bg-card/60 text-muted-foreground rounded-xl border p-4 text-left font-mono text-xs leading-relaxed">
        <p className="text-foreground font-semibold">NEXT STEPS:</p>
        <p className="mt-1">
          Share the <strong className="text-cyan-400">Team ID ({team.code})</strong> and your{' '}
          <strong className="text-cyan-400">Team Password</strong> with your teammates so they can
          join your squad.
        </p>
      </div>

      {/* Action Button */}
      <Link href="/dashboard" className="block w-full">
        <GradientButton
          variant="magenta"
          fullWidth
          className="text-sm font-semibold tracking-wider uppercase"
        >
          Enter Participant Dashboard →
        </GradientButton>
      </Link>
    </div>
  );
}
