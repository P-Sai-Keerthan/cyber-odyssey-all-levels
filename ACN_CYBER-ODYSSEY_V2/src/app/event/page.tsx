import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireParticipant } from '@/lib/auth/guards';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { GradientButton } from '@/components/ui/gradient-button';
import { LevelTimer } from '@/components/event/level-timer';
import { getLevelStates, getActiveLevel } from '@/lib/event/level-state';
import { getLevelConfig } from '@/lib/event/level-access';
import { getLevel3ScoreSummary } from '@/lib/level3/score-summary';
import { getAllLevelDisplayPointLabels } from '@/lib/event/level-points';
import { countVisibleAnnouncements } from '@/lib/event/announcements';

export const metadata: Metadata = {
  title: 'Event Operations & Level Navigation',
  description: 'Cyber Odyssey live event operational briefings and investigation level navigation.',
};

export default async function EventPage() {
  const user = await requireParticipant();

  if (!user.membership) {
    redirect('/team/onboarding');
  }

  const team = user.membership.team;

  // SEC-17-04: participant-visible announcements only.
  // PERF-17-01: single round trip instead of a sequential waterfall.
  const [totalAnnouncementsCount, levelStates, activeLevel, level3Scoring] = await Promise.all([
    countVisibleAnnouncements('PARTICIPANT'),
    getLevelStates(),
    getActiveLevel(),
    // Level 3's ceiling is CONFIGURED, not fixed: it moves when the Creator
    // releases Track 2. The static label in EVENT_LEVELS said 1200 PTS, which had
    // stopped being true — the card now reads the same figure the Level 3 page does.
    getLevel3ScoreSummary(),
  ]);

  // Every level's participant-facing figure, derived from configuration. The
  // literals that used to sit in EVENT_LEVELS disagreed with the database.
  const pointLabels = await getAllLevelDisplayPointLabels();

  // Point labels come from EVENT_LEVELS, not from a second list written out here.
  // The card and the level's own page previously each carried their own copy, so
  // changing Level 2's points in one place left the other showing the old figure.
  const levelMeta = [
    {
      number: 1,
      name: 'Level 1 — The Initial Trace',
      codename: 'THE INITIAL TRACE',
      route: '/event/level-1',
      points: pointLabels[1] ?? getLevelConfig(1)?.points ?? '100 PTS',
      description:
        'Analyze compromised edge gateways, inspect authentication logs, and extract initial adversary intrusion signatures.',
    },
    {
      number: 2,
      name: "Level 2 — The Boar's Mark",
      codename: "THE BOAR'S MARK",
      route: '/event/level-2',
      points: pointLabels[2] ?? getLevelConfig(2)?.points ?? '1000 PTS',
      description:
        'Physical and digital forensic investigation. Trace adversary movement through internal VLAN subnets, inspect memory artifacts, and reconstruct the attack chain.',
    },
    {
      number: 3,
      name: 'Level 3 — The Twelve Axes',
      codename: 'THE TWELVE AXES',
      route: '/event/level-3',
      points: pointLabels[3] ?? `${level3Scoring.availableTotalPoints.toLocaleString()} PTS`,
      description:
        'Reverse engineering advanced adversary malware implants, neutralizing exfiltration channels, and final evidence submission.',
    },
  ];

  const isLive = activeLevel?.status === 'LIVE';

  return (
    <ParticipantShell
      username={user.username}
      teamName={team.name}
      unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
    >
      <div className="space-y-8">
        {/* Event Header Banner */}
        <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 font-mono shadow-2xl backdrop-blur-md sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
                <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                <span>EVENT OPERATIONS // SECTOR ALPHA-09</span>
              </div>
              <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Cyber Odyssey — Level Operations
              </h1>
              <p className="text-muted-foreground font-sans text-sm">
                Access active investigation levels, download forensic telemetry packages, and submit
                evidence.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/announcements">
                <GradientButton
                  variant="outline"
                  size="sm"
                  className="text-xs font-semibold tracking-wider uppercase"
                >
                  Announcements →
                </GradientButton>
              </Link>
            </div>
          </div>

          {/* Quick Operational Telemetry Bar */}
          <div className="grid grid-cols-2 gap-3 pt-2 text-xs sm:grid-cols-4">
            <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
              <span className="text-muted-foreground text-[10px] uppercase">EVENT STATUS</span>
              <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {isLive ? 'LIVE COMPETITION' : 'EVENT STANDBY'}
              </div>
            </div>

            <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
              <span className="text-muted-foreground text-[10px] uppercase">ACTIVE LEVEL</span>
              <div className="font-bold text-cyan-300">
                {activeLevel ? `LEVEL ${activeLevel.levelNumber} ACTIVE` : 'NO ACTIVE LEVEL'}
              </div>
            </div>

            <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
              <span className="text-muted-foreground text-[10px] uppercase">SQUAD STATUS</span>
              <div className="text-foreground truncate font-bold">TEAM: {team.name}</div>
            </div>

            <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
              <span className="text-muted-foreground text-[10px] uppercase">MARSHAL DESK</span>
              <div className="font-bold text-amber-300">SUPERVISION ACTIVE</div>
            </div>
          </div>
        </div>

        {/* Interactive Level Navigation Grid */}
        <section className="space-y-4 font-mono" aria-labelledby="mission-roadmap-title">
          <div className="flex items-center justify-between">
            <h2
              id="mission-roadmap-title"
              className="text-xs font-bold tracking-wider text-cyan-400 uppercase"
            >
              Investigation Level Navigation
            </h2>
            <span className="text-muted-foreground text-[10px]">3 INVESTIGATION TIERS</span>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {levelMeta.map((meta) => {
              const state = levelStates.find((s) => s.levelNumber === meta.number);
              const status = state?.status || 'LOCKED';
              const remainingSeconds = state?.remainingSeconds ?? meta.number * 3600;
              const durationMinutes = state?.durationMinutes ?? (meta.number === 1 ? 60 : 120);

              return (
                <LevelTimer
                  key={meta.number}
                  levelNumber={meta.number}
                  name={state?.name || meta.name}
                  codename={state?.codename || meta.codename}
                  status={status}
                  startedAt={state?.startedAt}
                  endsAt={state?.endsAt}
                  pausedAt={state?.pausedAt}
                  remainingSeconds={remainingSeconds}
                  durationMinutes={durationMinutes}
                  points={meta.points}
                  description={meta.description}
                  variant="card"
                  // EVERY card links to its own portal page, Level 1 included.
                  //
                  // Level 1's card used to launch the external application
                  // directly. That skipped /event/level-1 — the briefing, the
                  // recorded score, the track breakdown — and gave a participant
                  // no way to read what Level 1 involves before being thrown into
                  // it. The card is navigation; the entry control belongs on the
                  // level's own page, next to the brief that explains it.
                  //
                  // A locked level gets inert "Locked" text and no control at
                  // all. Nothing here hardcodes which levels are open; it all
                  // follows LevelState.
                  showLink
                  href={meta.route}
                />
              );
            })}
          </div>
        </section>
      </div>
    </ParticipantShell>
  );
}
