import type { Metadata } from 'next';
import Link from 'next/link';
import { requireParticipant } from '@/lib/auth/guards';
import { TeamOnboardingHub } from '@/components/team/team-onboarding-hub';
import { GradientButton } from '@/components/ui/gradient-button';
import { logoutAction } from '@/lib/actions/auth-actions';

export const metadata: Metadata = {
  title: 'Team Onboarding',
  description: 'Create or join a team for the Cyber Odyssey forensic investigation.',
};

export default async function TeamOnboardingPage() {
  const user = await requireParticipant();

  // If user already belongs to a team, show the explicit "Already Assigned" view
  if (user.membership) {
    const team = user.membership.team;
    return (
      <div className="cyber-grid-bg relative flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 lg:p-10">
        {/* Background ambient lighting */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[450px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-b from-cyan-600/10 via-transparent to-transparent blur-3xl" />
        </div>

        <div className="relative z-10 w-full max-w-lg space-y-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-950/30 text-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.25)]">
            <svg
              className="size-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>

          <div className="space-y-2">
            <span className="font-mono text-xs font-semibold tracking-widest text-cyan-400 uppercase">
              Operational Status // Assigned
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              YOU ARE ALREADY ASSIGNED TO A TEAM
            </h1>
            <p className="text-muted-foreground text-sm">
              Your account is registered to active squad{' '}
              <strong className="text-white">{team.name}</strong> ({team.code}).
            </p>
          </div>

          <div className="space-y-2 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-5 text-left font-mono text-xs text-cyan-200/90 backdrop-blur-md">
            <div className="flex justify-between border-b border-cyan-500/20 pb-2">
              <span className="text-muted-foreground">SQUAD NAME</span>
              <span className="font-bold text-white">{team.name}</span>
            </div>
            <div className="flex justify-between border-b border-cyan-500/20 pb-2">
              <span className="text-muted-foreground">TEAM ID</span>
              <span className="font-bold text-cyan-300">{team.code}</span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-muted-foreground">ROLE</span>
              <span className="font-bold text-emerald-400">
                {user.membership.role === 'CREATOR' || user.membership.role === 'HEAD'
                  ? 'HEAD'
                  : 'MEMBER'}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <Link href="/team" className="flex-1">
              <GradientButton
                variant="cyan"
                fullWidth
                className="font-mono text-xs font-semibold uppercase"
              >
                View My Team
              </GradientButton>
            </Link>
            <Link href="/dashboard" className="flex-1">
              <GradientButton
                variant="outline"
                fullWidth
                className="font-mono text-xs font-semibold uppercase"
              >
                Go to Dashboard
              </GradientButton>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-grid-bg relative flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 lg:p-10">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[450px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-b from-fuchsia-600/10 via-transparent to-transparent blur-3xl" />
        <div className="absolute -bottom-40 left-1/2 h-[450px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-t from-cyan-600/10 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-xl space-y-6">
        {/* Top Header & User Identity */}
        <div className="border-border/60 flex items-center justify-between border-b pb-4">
          <div className="space-y-0.5">
            <span className="text-cyan-accent font-mono text-[10px] font-semibold tracking-[0.25em] uppercase">
              ACN CYBER ODYSSEY // UNIT FORMATION
            </span>
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              Team Onboarding
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right font-mono text-xs">
              <div className="text-foreground font-semibold">@{user.username}</div>
              <div className="text-muted-foreground text-[10px]">PARTICIPANT</div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="border-border/70 bg-card/60 text-muted-foreground hover:border-border hover:bg-card focus-visible:ring-cyan-accent rounded-lg border px-2.5 py-1 font-mono text-xs transition-colors hover:text-rose-300 focus-visible:ring-1 focus-visible:outline-none"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>

        {/* Instructions Summary */}
        <div className="border-cyan-accent/30 rounded-xl border bg-cyan-950/20 p-4 font-mono text-xs text-cyan-200/90 backdrop-blur-md">
          <p className="font-semibold text-cyan-300">OPERATION PROTOCOL:</p>
          <p className="mt-1 leading-relaxed">
            All participants must belong to a registered squad (1–3 members) before entering the
            mission dashboard. Either create a new unit or enter a team code from your team lead.
          </p>
        </div>

        {/* Interactive Hub */}
        <TeamOnboardingHub />
      </div>
    </div>
  );
}
