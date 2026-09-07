import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireParticipant } from '@/lib/auth/guards';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { LevelPendingPanel } from '@/components/event/level-pending-panel';
import { Level3Workspace } from '@/components/event/level-3-workspace';
import { checkAuthoritativeLevelAccess, getLevelConfig } from '@/lib/event/level-access';
import { countVisibleAnnouncements } from '@/lib/event/announcements';
import { getTeamLevel3Progress } from '@/lib/level3/scoring';
import { getUnlockedLevel3HintsAction } from '@/lib/actions/level3-hint-actions';
import { getLevelResources } from '@/lib/event/level-resources';
import { LEVEL3_DEFAULT_BRIEF, LEVEL3_DEFAULT_SUBMISSION_INSTRUCTIONS } from '@/lib/level3/content';
import { getLevel3ScoreSummary } from '@/lib/level3/score-summary';

export const metadata: Metadata = {
  title: 'Level 3 — The Twelve Axes',
  description: 'Level 3 web security investigation workspace, stations, and final report.',
};

/**
 * Level 3 — web security investigation.
 *
 * Everything rendered here is read on the server for ONE squad, resolved from the
 * session. A participant cannot request another squad's progress by changing
 * anything in the request, and nothing on this page can write a score: bug
 * discoveries arrive from ORION through the signed integration endpoint.
 */
export default async function Level3Page() {
  const user = await requireParticipant();

  if (!user.membership) {
    redirect('/team/onboarding');
  }

  const team = user.membership.team;

  const access = await checkAuthoritativeLevelAccess(3, Boolean(user.membership));
  const config = getLevelConfig(3)!;
  const state = access.state;
  const status = state?.status ?? 'LOCKED';

  // Locked or not yet activated: show the scheduling panel rather than a
  // workspace whose controls would all be inert.
  if (!access.allowed && !access.isCompleted) {
    const [totalAnnouncementsCount, lockedScoring] = await Promise.all([
      countVisibleAnnouncements('PARTICIPANT'),
      getLevel3ScoreSummary(),
    ]);
    return (
      <ParticipantShell
        username={user.username}
        teamName={team.name}
        unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
      >
        <LevelPendingPanel
          levelNumber={3}
          name={state?.name || config.name}
          codename={state?.codename || config.codename}
          status={status}
          scheduledTime={config.scheduledTime}
          durationMinutes={state?.durationMinutes ?? 150}
          startedAt={state?.startedAt}
          endsAt={state?.endsAt}
          points={`${lockedScoring.availableTotalPoints.toLocaleString()} PTS`}
        />
      </ParticipantShell>
    );
  }

  // Issued together rather than as a waterfall: this is the busiest page of the
  // level, and each of these is independent of the others.
  const [totalAnnouncementsCount, progress, unlockedHints, resources, scoring, existingSubmission] =
    await Promise.all([
      countVisibleAnnouncements('PARTICIPANT'),
      getTeamLevel3Progress(team.id),
      getUnlockedLevel3HintsAction(),
      getLevelResources(3),
      // Target address + the whole point ceiling, from Level3Config and the keyed
      // Level 3 evaluation criteria. The workspace renders no scoring literal.
      getLevel3ScoreSummary(),
      // Uses the (teamId, level) unique index directly rather than a scan.
      prisma.submission.findUnique({
        where: { teamId_level: { teamId: team.id, level: 3 } },
        select: {
          id: true,
          level: true,
          status: true,
          attemptCount: true,
          submittedAt: true,
          files: { select: { id: true, originalName: true, fileSize: true } },
          evaluation: {
            select: {
              score: true,
              status: true,
              approvalStatus: true,
              rejectionReason: true,
              feedback: true,
            },
          },
        },
      }),
    ]);

  const evaluation = existingSubmission?.evaluation ?? null;

  // The report score is shown to the squad only once an Admin has approved it.
  // Surfacing a pending number would contradict the leaderboard and invite "why
  // did my score drop" if the Admin then rejects it.
  const approvedReportScore =
    evaluation?.approvalStatus === 'APPROVED' ? (evaluation.score ?? null) : null;

  // Keyed for O(1) lookup in the workspace. Content is only ever hints this squad
  // has already paid for — see getUnlockedLevel3HintsAction.
  const hintMap: Record<string, string> = {};
  for (const h of unlockedHints.data ?? []) {
    hintMap[`${h.bugId}:${h.hintNumber}`] = h.content;
  }

  // getLevelResources returns a flat list; the sample report is the entry keyed
  // SAMPLE_REPORT, and only when the Creator has published it.
  const sampleReportResource = resources.find(
    (r) => r.resourceKey === 'SAMPLE_REPORT' && r.isPublished,
  );

  return (
    <ParticipantShell
      username={user.username}
      teamName={team.name}
      unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
    >
      <Level3Workspace
        teamName={team.name}
        progress={progress}
        initialUnlockedHints={hintMap}
        brief={LEVEL3_DEFAULT_BRIEF}
        submissionInstructions={LEVEL3_DEFAULT_SUBMISSION_INSTRUCTIONS}
        scoring={scoring}
        // The header badge and POINTS tile. Without this the workspace fell back
        // to its own '1000 PTS' default while the /event card, reading the same
        // configuration, said 3,900 PTS — two figures for one level, on two
        // pages one click apart.
        points={`${scoring.availableTotalPoints.toLocaleString()} PTS`}
        sampleReport={
          sampleReportResource
            ? { isAvailable: true, originalName: sampleReportResource.originalName }
            : { isAvailable: false }
        }
        initialSubmission={
          existingSubmission
            ? {
                id: existingSubmission.id,
                level: existingSubmission.level,
                status: existingSubmission.status,
                attemptCount: existingSubmission.attemptCount ?? 1,
                submittedAt: existingSubmission.submittedAt.toISOString(),
                files: existingSubmission.files,
              }
            : null
        }
        windowOpen={access.allowed}
        name={state?.name || config.name}
        codename={state?.codename || config.codename}
        status={status}
        startedAt={state?.startedAt}
        endsAt={state?.endsAt}
        pausedAt={state?.pausedAt}
        remainingSeconds={state?.remainingSeconds ?? 9000}
        durationMinutes={state?.durationMinutes ?? 150}
        evaluationScore={approvedReportScore}
        evaluationStatus={evaluation?.status ?? null}
        evaluationFeedback={evaluation?.feedback ?? null}
        approvalStatus={evaluation?.approvalStatus ?? null}
        rejectionReason={evaluation?.rejectionReason ?? null}
      />
    </ParticipantShell>
  );
}
