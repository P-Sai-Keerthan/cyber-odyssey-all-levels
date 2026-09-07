import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireParticipantWithRoster } from '@/lib/auth/guards';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { TeamCard, type TeamMemberDisplay } from '@/components/dashboard/team-card';
import { GradientButton } from '@/components/ui/gradient-button';
import { countVisibleAnnouncements } from '@/lib/event/announcements';
import { MAX_TEAM_SIZE } from '@/lib/team/constants';

export const metadata: Metadata = {
  title: 'My Team',
  description: 'Manage squad credentials, roster, and operational readiness.',
};

export default async function MyTeamPage() {
  // The only participant route that renders the squad roster, so the only one
  // that pays for the roster join (PERF-17-03).
  const user = await requireParticipantWithRoster();

  // If user does not belong to a team yet, route to team onboarding
  if (!user.membership) {
    redirect('/team/onboarding');
  }

  const team = user.membership.team;

  // SEC-17-04: participant-visible announcements only.
  const totalAnnouncementsCount = await countVisibleAnnouncements('PARTICIPANT');

  const memberDisplays: TeamMemberDisplay[] = team.members.map((m) => ({
    id: m.id,
    userId: m.userId,
    username: m.user.username,
    role: m.role,
    joinedAt: m.joinedAt,
  }));

  const isFull = team.members.length >= MAX_TEAM_SIZE;

  return (
    <ParticipantShell
      username={user.username}
      teamName={team.name}
      unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
    >
      {/* Header Briefing */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <span className="font-mono text-xs font-semibold tracking-widest text-cyan-400 uppercase">
            Operational Squad // Level 0
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            My Team Control Center
          </h1>
          <p className="text-muted-foreground text-sm">
            Review squad composition, operational credentials, and team joining codes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <GradientButton
              variant="outline"
              size="sm"
              className="font-mono text-xs font-semibold uppercase"
            >
              ← Dashboard
            </GradientButton>
          </Link>
          <Link href="/leaderboard">
            <GradientButton
              variant="cyan"
              size="sm"
              className="font-mono text-xs font-semibold uppercase"
            >
              Leaderboard →
            </GradientButton>
          </Link>
        </div>
      </div>

      {/* Team Card with Live Roster */}
      <TeamCard
        teamName={team.name}
        teamCode={team.code}
        members={memberDisplays}
        currentUserId={user.id}
      />

      {/* Squad Joining & Teammate Invite Guide */}
      <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 shadow-xl backdrop-blur-md">
        <div className="border-border/50 flex items-center justify-between border-b pb-3">
          <div className="space-y-0.5">
            <h3 className="text-foreground font-mono text-xs font-bold tracking-wider uppercase">
              Teammate Invitation Instructions
            </h3>
            <p className="text-muted-foreground text-xs">
              How to bring other registered participants into this squad.
            </p>
          </div>
          <span className="rounded-md border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
            {isFull ? 'SQUAD COMPLETE' : `${MAX_TEAM_SIZE - team.members.length} SLOTS REMAINING`}
          </span>
        </div>

        {isFull ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 font-mono text-xs text-emerald-300">
            ✓ Your squad has reached the maximum capacity of 3 participants. Your unit is locked and
            ready for event start.
          </div>
        ) : (
          <div className="text-muted-foreground space-y-3 font-mono text-xs leading-relaxed">
            <p>
              To invite a teammate to join <strong className="text-foreground">{team.name}</strong>:
            </p>
            <ol className="list-inside list-decimal space-y-1.5 pl-2">
              <li>Instruct your teammate to create an account on the Cyber Odyssey portal.</li>
              <li>
                On the Team Onboarding screen, they should select{' '}
                <strong className="text-cyan-300">JOIN TEAM</strong>.
              </li>
              <li>
                Provide them with your Team Code (
                <span className="font-bold text-white">{team.code}</span>) and the team password set
                during creation.
              </li>
            </ol>
          </div>
        )}
      </div>
    </ParticipantShell>
  );
}
