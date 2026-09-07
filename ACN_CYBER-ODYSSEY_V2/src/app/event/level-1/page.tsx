import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireParticipant } from '@/lib/auth/guards';
import { getLevelDisplayPointsLabel } from '@/lib/event/level-points';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { GradientButton } from '@/components/ui/gradient-button';
import { LevelTimer } from '@/components/event/level-timer';
import { Level1Launch } from '@/components/event/level-1-launch';
import { checkAuthoritativeLevelAccess, getLevelConfig } from '@/lib/event/level-access';
import { countVisibleAnnouncements } from '@/lib/event/announcements';
import { level1ChallengeUrl } from '@/lib/level1/config';

export const metadata: Metadata = {
  title: 'Level 1 — The Initial Trace',
  description: 'Digital triage and initial trace investigation phase of Cyber Odyssey — TRACE.',
};

/**
 * Level 1 — The Initial Trace.
 *
 * The challenge itself lives in a dedicated external application. This page is the
 * participant's briefing for it: what Level 1 is, what the tracks cover, and the
 * control that takes them there.
 *
 * Deliberately NOT here: event telemetry, the recorded score, and the handoff
 * explanation. A participant opening this page wants to know what they are about
 * to do — the score lives on the leaderboard and the dashboard, and how the
 * handoff works is not their problem.
 */
export default async function Level1Page() {
  const user = await requireParticipant();

  if (!user.membership) {
    redirect('/team/onboarding');
  }

  const team = user.membership.team;

  const [access, totalAnnouncementsCount, level1PointsLabel] = await Promise.all([
    checkAuthoritativeLevelAccess(1, Boolean(user.membership)),
    countVisibleAnnouncements('PARTICIPANT'),
    getLevelDisplayPointsLabel(1),
  ]);

  const config = getLevelConfig(1)!;
  const state = access.state;
  const status = state?.status ?? 'LOCKED';
  const configured = Boolean(level1ChallengeUrl());

  return (
    <ParticipantShell
      username={user.username}
      teamName={team.name}
      unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
    >
      <div className="space-y-6 font-sans">
        {/* Return to the level index.
            `hideLevelNav` on the header below suppresses the shared nav block,
            which pairs "← All Levels" with a "Level 2 →" jump. Level 1 wants the
            first and not the second — this page is about Level 1, and offering a
            shortcut into another level from here is noise. So the back control
            lives here explicitly instead. */}
        <div>
          <Link href="/event">
            <GradientButton
              variant="outline"
              size="sm"
              className="text-xs font-semibold tracking-wider uppercase"
            >
              ← All Levels
            </GradientButton>
          </Link>
        </div>

        {/* Workspace Header & Authoritative Mission Clock */}
        <LevelTimer
          levelNumber={1}
          name={state?.name || config.name}
          codename={state?.codename || config.codename}
          status={status}
          startedAt={state?.startedAt}
          endsAt={state?.endsAt}
          pausedAt={state?.pausedAt}
          remainingSeconds={state?.remainingSeconds ?? 3600}
          durationMinutes={state?.durationMinutes ?? 60}
          // Configured, not literal: LevelState(1).maxScore. The hardcoded
          // "100 PTS" here was the last participant-facing score literal that
          // had no database behind it.
          points={level1PointsLabel}
          description="Digital Triage & Initial Trace: Perimeter log inspection, edge gateway compromise analysis, and initial trace extraction."
          variant="workspace"
          hideLevelNav={true}
        />

        {/* Level 1 Brief Section */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 shadow-xl backdrop-blur-md sm:p-8">
          <div className="border-border/40 space-y-1 border-b pb-4">
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
              <span className="size-2 rounded-full bg-cyan-400" />
              <span>PHASE 1 BRIEFING // OPERATIONAL CONTEXT</span>
            </div>
            <h2 className="font-sans text-xl font-bold tracking-tight text-white sm:text-2xl">
              LEVEL 1 BRIEF
            </h2>
          </div>

          <div className="text-muted-foreground space-y-4 font-sans text-sm leading-relaxed">
            <p className="text-foreground/90 text-base leading-relaxed">
              The Initial Trace is the first digital investigation phase of Cyber Odyssey — TRACE.
              Teams analyze the provided cybersecurity evidence, identify relevant findings, and
              answer investigation questions based on what they discover.
            </p>

            <div className="border-border/60 bg-background/50 space-y-3 rounded-xl border p-4">
              <h4 className="font-mono text-xs font-bold tracking-wider text-cyan-300 uppercase">
                Investigation Objectives
              </h4>
              <ul className="text-muted-foreground grid grid-cols-1 gap-2 sm:grid-cols-2">
                <li className="flex items-center gap-2">
                  <span className="text-cyan-400">▪</span>
                  <span>Inspect the provided evidence</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-cyan-400">▪</span>
                  <span>Analyze cybersecurity findings</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-cyan-400">▪</span>
                  <span>Identify relevant indicators</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-cyan-400">▪</span>
                  <span>Answer the investigation questions</span>
                </li>
                {/* "Automatic score synchronization with Portal" was here. It
                    described the integration rather than anything a participant
                    does, which is the same reason the telemetry and recorded-score
                    blocks are gone. */}
                <li className="flex items-center gap-2">
                  <span className="text-cyan-400">▪</span>
                  <span>Submit solutions</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Level 1 Track Overview */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 shadow-xl backdrop-blur-md sm:p-8">
          <div className="border-border/40 space-y-1 border-b pb-4">
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
              <span className="size-2 rounded-full bg-cyan-400" />
              <span>INVESTIGATION SCOPE // STRUCTURED TRACKS</span>
            </div>
            <h2 className="font-sans text-xl font-bold tracking-tight text-white sm:text-2xl">
              LEVEL 1 TRACK OVERVIEW
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-5 transition-all hover:border-cyan-500/40">
              <div className="flex items-center justify-between font-mono">
                <span className="text-[10px] font-bold tracking-wider text-cyan-400 uppercase">
                  TRACK A
                </span>
                <span className="rounded border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 text-[9px] font-bold text-cyan-300">
                  30 PTS
                </span>
              </div>
              <h3 className="font-sans text-base font-bold text-white">SOC Email Threat Hunting</h3>
              <p className="text-muted-foreground font-sans text-xs leading-relaxed">
                Triage incoming organizational telemetry, analyze suspicious mail headers, and
                uncover initial threat actor phishing vectors.
              </p>
            </div>

            <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-5 transition-all hover:border-cyan-500/40">
              <div className="flex items-center justify-between font-mono">
                <span className="text-[10px] font-bold tracking-wider text-cyan-400 uppercase">
                  TRACK B
                </span>
                <span className="rounded border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 text-[9px] font-bold text-cyan-300">
                  30 PTS
                </span>
              </div>
              <h3 className="font-sans text-base font-bold text-white">
                Application Security &amp; Session Analysis
              </h3>
              <p className="text-muted-foreground font-sans text-xs leading-relaxed">
                Examine compromised web application sessions, inspect authorization tokens, and
                unravel session manipulation techniques.
              </p>
            </div>

            <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-5 transition-all hover:border-cyan-500/40">
              <div className="flex items-center justify-between font-mono">
                <span className="text-[10px] font-bold tracking-wider text-cyan-400 uppercase">
                  TRACK C
                </span>
                <span className="rounded border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 text-[9px] font-bold text-cyan-300">
                  40 PTS
                </span>
              </div>
              <h3 className="font-sans text-base font-bold text-white">DFIR Evidence Analysis</h3>
              <p className="text-muted-foreground font-sans text-xs leading-relaxed">
                Correlate digital artifacts across the evidence board, establish intrusion
                timelines, and connect attack indicators.
              </p>
            </div>
          </div>
        </div>

        {/* Level 1 Action / Entry Control — placed after Track Overview */}
        <div className="max-w-xs">
          <Level1Launch status={status} configured={configured} variant="card" />
        </div>
      </div>
    </ParticipantShell>
  );
}
