import type { Metadata } from 'next';
import { requireParticipant } from '@/lib/auth/guards';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { countVisibleAnnouncements } from '@/lib/event/announcements';
import { getLeaderboardStandings } from '@/lib/leaderboard/standings';
import { LeaderboardView } from '@/components/leaderboard/leaderboard-view';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'Official squad standings by investigation level.',
};

/**
 * Official leaderboard.
 *
 * Standings are derived on every request from current database state by
 * `getLeaderboardStandings` — approving an evaluation is the only thing needed
 * to move the board. Nothing is cached or manually edited.
 *
 * PRIVACY: the standings query selects only id, name and timestamps. Team.code
 * and Team.passwordHash are never read here.
 */
export default async function LeaderboardPage() {
  const user = await requireParticipant();

  const userTeam = user.membership?.team;

  const [totalAnnouncementsCount, standings] = await Promise.all([
    countVisibleAnnouncements('PARTICIPANT'),
    getLeaderboardStandings(),
  ]);

  return (
    <ParticipantShell
      username={user.username}
      teamName={userTeam?.name}
      unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
    >
      <LeaderboardView
        teams={standings.rows}
        currentUserTeamId={userTeam?.id || null}
        scoredTeamCount={standings.scoredTeamCount}
        eventPeriodLabel="SEASON 2026 // SECTOR ALPHA-09"
      />
    </ParticipantShell>
  );
}
