import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireParticipant } from '@/lib/auth/guards';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { LevelTimer } from '@/components/event/level-timer';
import { TeamSummaryCard } from '@/components/dashboard/team-summary-card';
import { AnnouncementSummaryCard } from '@/components/dashboard/announcement-summary-card';
import { getActiveLevel } from '@/lib/event/level-state';
import { countVisibleAnnouncements, latestVisibleAnnouncement } from '@/lib/event/announcements';

export const metadata: Metadata = {
  title: 'Mission Control Dashboard',
  description: 'Cyber Odyssey investigation terminal and participant mission control.',
};

export default async function ParticipantDashboardPage() {
  const user = await requireParticipant();

  // If user does not belong to a team yet, route to team onboarding
  if (!user.membership) {
    redirect('/team/onboarding');
  }

  const team = user.membership.team;

  // PERF-17-01: these four reads are independent, so they are issued together.
  // Previously they ran as a four-step sequential waterfall on the single hottest
  // page in the portal — with ~210 participants that is ~630 avoidable round trips
  // of added latency per dashboard refresh.
  const [
    higherTeamsCount,
    activeLevel,
    totalMembersCount,
    totalAnnouncementsCount,
    latestAnnouncement,
  ] = await Promise.all([
    prisma.team.count({ where: { score: { gt: team.score } } }),
    getActiveLevel(),
    prisma.teamMember.count({ where: { teamId: team.id } }),
    countVisibleAnnouncements('PARTICIPANT'),
    latestVisibleAnnouncement('PARTICIPANT'),
  ]);

  const currentRank = higherTeamsCount + 1;

  const isLive = activeLevel?.status === 'LIVE';
  const isPaused = activeLevel?.status === 'PAUSED';

  const eventStatusText = isLive ? 'LIVE COMPETITION' : isPaused ? 'LEVEL PAUSED' : 'STANDBY';

  return (
    <ParticipantShell
      username={user.username}
      teamName={team.name}
      unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
    >
      <div className="space-y-8">
        {/* ===================================================================== */}
        {/* 1. TOP MISSION CONTROL HEADER                                         */}
        {/* ===================================================================== */}
        <div className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
          <div className="border-border/50 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
                <span
                  className={`size-2 rounded-full ${
                    isLive
                      ? 'animate-pulse bg-emerald-400'
                      : isPaused
                        ? 'bg-amber-400'
                        : 'bg-cyan-400'
                  }`}
                />
                <span>MISSION CONTROL // LIVE TERMINAL</span>
              </div>
              <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Cyber Odyssey Command Center
              </h1>
              <p className="text-muted-foreground font-sans text-sm">
                Follow digital footprints, inspect forensic telemetry, and solve cyber investigation
                challenges.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex flex-col rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3.5 py-2 text-right font-mono text-xs">
                <span className="text-muted-foreground text-[10px] uppercase">EVENT STATUS</span>
                <span
                  className={`flex items-center justify-end gap-1.5 font-bold ${
                    isLive ? 'text-emerald-300' : isPaused ? 'text-amber-300' : 'text-cyan-300'
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      isLive
                        ? 'animate-pulse bg-emerald-400'
                        : isPaused
                          ? 'bg-amber-400'
                          : 'bg-cyan-400'
                    }`}
                  />
                  {eventStatusText}
                </span>
              </div>

              <div className="flex flex-col rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-3.5 py-2 text-right font-mono text-xs">
                <span className="text-muted-foreground text-[10px] uppercase">ACTIVE LEVEL</span>
                <span className="font-bold text-cyan-300">
                  {activeLevel ? `LEVEL ${activeLevel.levelNumber} ACTIVE` : 'STANDBY'}
                </span>
              </div>
            </div>
          </div>

          {/* Prominent Active Level Timer / Mission Banner */}
          {activeLevel ? (
            <LevelTimer
              levelNumber={activeLevel.levelNumber}
              name={activeLevel.name}
              codename={activeLevel.codename}
              status={activeLevel.status}
              startedAt={activeLevel.startedAt}
              endsAt={activeLevel.endsAt}
              pausedAt={activeLevel.pausedAt}
              remainingSeconds={activeLevel.remainingSeconds}
              durationMinutes={activeLevel.durationMinutes}
              variant="banner"
            />
          ) : (
            <div className="border-border/60 bg-background/50 flex flex-col items-center justify-center rounded-2xl border p-8 text-center font-mono text-xs">
              <div className="text-muted-foreground mb-2 text-sm font-bold tracking-wider text-cyan-400 uppercase">
                ⏱ EVENT STANDBY // AWAITING LEVEL LAUNCH
              </div>
              <p className="text-muted-foreground max-w-md font-sans text-xs">
                The operations desk will activate competition levels according to the official
                investigation schedule.
              </p>
            </div>
          )}

          {/* Verified Score & Rank Metrics */}
          <div className="grid grid-cols-1 gap-4 font-mono sm:grid-cols-2">
            <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-4">
              <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                CURRENT RANK
              </span>
              <div className="text-2xl font-black text-cyan-300">#{currentRank}</div>
              <span className="text-muted-foreground text-[10px]">Live standings position</span>
            </div>

            <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-4">
              <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                CURRENT SCORE
              </span>
              <div className="text-2xl font-black text-amber-300">{team.score} PTS</div>
              <span className="text-muted-foreground text-[10px]">Verified points earned</span>
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* 2. SQUAD INTEL & ANNOUNCEMENTS WIDGETS                                */}
        {/* ===================================================================== */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TeamSummaryCard
            teamName={team.name}
            teamCode={team.code}
            memberCount={totalMembersCount}
            maxCapacity={3}
          />

          <AnnouncementSummaryCard
            latestAnnouncement={
              latestAnnouncement
                ? {
                    id: latestAnnouncement.id,
                    title: latestAnnouncement.title,
                    content: latestAnnouncement.content,
                    category: latestAnnouncement.category,
                    priority: latestAnnouncement.priority,
                    createdAt: latestAnnouncement.createdAt,
                  }
                : null
            }
            unreadCount={totalAnnouncementsCount}
          />
        </div>
      </div>
    </ParticipantShell>
  );
}
