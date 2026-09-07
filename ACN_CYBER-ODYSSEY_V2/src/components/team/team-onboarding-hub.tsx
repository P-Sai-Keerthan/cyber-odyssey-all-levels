'use client';

import * as React from 'react';
import { CreateTeamForm } from './create-team-form';
import { JoinTeamForm } from './join-team-form';
import { TeamCreatedView } from './team-created-view';
import type { CreatedTeamData } from '@/lib/actions/team-actions';

type OnboardingTab = 'CREATE' | 'JOIN';

export function TeamOnboardingHub() {
  const [tab, setTab] = React.useState<OnboardingTab>('CREATE');
  const [createdTeam, setCreatedTeam] = React.useState<CreatedTeamData | null>(null);

  if (createdTeam) {
    return <TeamCreatedView team={createdTeam} />;
  }

  return (
    <div className="space-y-6">
      {/* Mode Switcher Segmented Control */}
      <div
        role="tablist"
        aria-label="Team Onboarding Action"
        className="border-border/80 bg-card/60 grid grid-cols-2 gap-1 rounded-xl border p-1 backdrop-blur-md"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'CREATE'}
          onClick={() => setTab('CREATE')}
          className={`focus-visible:ring-cyan-accent flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold tracking-wider uppercase transition-all duration-150 focus-visible:ring-1 focus-visible:outline-none ${
            tab === 'CREATE'
              ? 'border border-fuchsia-500/40 bg-fuchsia-950/40 text-fuchsia-200 shadow-[0_0_15px_-3px_rgba(217,70,239,0.3)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
          }`}
        >
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Create a Team</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'JOIN'}
          onClick={() => setTab('JOIN')}
          className={`focus-visible:ring-cyan-accent flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold tracking-wider uppercase transition-all duration-150 focus-visible:ring-1 focus-visible:outline-none ${
            tab === 'JOIN'
              ? 'border border-cyan-500/40 bg-cyan-950/40 text-cyan-200 shadow-[0_0_15px_-3px_rgba(6,182,212,0.3)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
          }`}
        >
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>Join a Team</span>
        </button>
      </div>

      {/* Selected Action Form */}
      <div className="border-border/70 bg-card/40 rounded-2xl border p-6 backdrop-blur-md">
        {tab === 'CREATE' ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-foreground text-base font-semibold">Create a New Team</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Establish an investigation squad. You will receive a unique Team ID to invite
                teammates.
              </p>
            </div>
            <CreateTeamForm onSuccess={(team) => setCreatedTeam(team)} />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-foreground text-base font-semibold">Join an Existing Team</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Enter the Team ID and Team Password provided by your Team Head.
              </p>
            </div>
            <JoinTeamForm />
          </div>
        )}
      </div>
    </div>
  );
}
