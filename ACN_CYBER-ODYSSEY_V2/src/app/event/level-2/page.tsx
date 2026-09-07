import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireParticipant } from '@/lib/auth/guards';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { checkAuthoritativeLevelAccess, getLevelConfig } from '@/lib/event/level-access';
import { recordThrottledAuditEvent } from '@/lib/audit/audit-log';
import { countVisibleAnnouncements } from '@/lib/event/announcements';
import { getLevelResources } from '@/lib/event/level-resources';
import { readCurrentSubmission } from '@/lib/submissions/read-current';
import { getLevelDisplayPointsLabel } from '@/lib/event/level-points';
import { Level2Workspace } from '@/components/event/level-2-workspace';

export const metadata: Metadata = {
  title: "Level 2 — The Boar's Mark | ACN Cyber Odyssey",
  description:
    'Level 2 forensic investigation workspace, evidence package extraction, sample report template, and team submission terminal.',
};

export default async function Level2WorkspacePage() {
  const user = await requireParticipant();

  if (!user.membership) {
    redirect('/team/onboarding');
  }

  const team = user.membership.team;

  // Enforce server-side authoritative level access verification
  const access = await checkAuthoritativeLevelAccess(2, Boolean(user.membership));
  if (!access.allowed && !access.isPaused && !access.isCompleted) {
    redirect('/event');
  }

  const config = getLevelConfig(2)!;
  const state = access.state;

  // Record LEVEL2_OPENED at most once per participant per 15 minutes.
  // This fires on RENDER, so an unthrottled write here multiplied by 210
  // participants refreshing during a live level was the largest single source of
  // database writes in the portal (PERF-17-04).
  void recordThrottledAuditEvent({
    actorId: user.id,
    targetId: user.id,
    action: 'LEVEL2_OPENED',
    details: `Participant @${user.username} (Squad "${team.name}") opened the Level 2 workspace.`,
  });

  // PERF-17-01: independent reads issued together instead of as a sequential
  // waterfall on the busiest page of the live event.
  //
  // The submission read goes through `readCurrentSubmission`, the same helper the
  // submission API's GET uses, so the page and the API can never describe the
  // squad's current submission differently.
  const [
    totalAnnouncementsCount,
    levelResources,
    initialSubmission,
    evaluationSummary,
    level2PointsLabel,
  ] = await Promise.all([
    // SEC-17-04: participant-visible announcements only.
    countVisibleAnnouncements('PARTICIPANT'),
    getLevelResources(2),
    readCurrentSubmission(team.id, 2),
    prisma.evaluation.findFirst({
      where: { teamId: team.id, level: 2 },
      select: { feedback: true, score: true, status: true },
    }),
    getLevelDisplayPointsLabel(2),
  ]);

  const evidenceRes = levelResources.find(
    (r) => r.resourceKey === 'EVIDENCE_PACKAGE' && r.isPublished,
  );
  const sampleReportRes = levelResources.find(
    (r) => r.resourceKey === 'SAMPLE_REPORT' && r.isPublished,
  );

  const evaluationFeedback = evaluationSummary?.feedback ?? null;
  const evaluationScore = evaluationSummary?.score ?? null;
  const evaluationStatus = evaluationSummary?.status ?? null;

  return (
    <ParticipantShell
      username={user.username}
      teamName={team.name}
      unreadAnnouncementsCount={totalAnnouncementsCount > 0 ? totalAnnouncementsCount : undefined}
    >
      <Level2Workspace
        initialSubmission={initialSubmission}
        teamName={team.name}
        levelNumber={2}
        scheduledTime={config.scheduledTime}
        duration={`${state?.durationMinutes || 120} MIN`}
        durationMinutes={state?.durationMinutes || 120}
        // LevelState(2).maxScore, not the EVENT_LEVELS literal.
        points={level2PointsLabel}
        status={state?.status || 'LOCKED'}
        startedAt={state?.startedAt}
        endsAt={state?.endsAt}
        pausedAt={state?.pausedAt}
        remainingSeconds={state?.remainingSeconds ?? 7200}
        isExpired={Boolean(state?.isExpired)}
        // The server's own verdict on whether writes are accepted. The workspace
        // uses it to decide what to disable; the API re-checks it on every write.
        windowOpen={access.allowed}
        evaluationFeedback={evaluationFeedback}
        evaluationScore={evaluationScore}
        evaluationStatus={evaluationStatus}
        evidenceResource={
          evidenceRes
            ? {
                isAvailable: true,
                originalName: evidenceRes.originalName,
                fileSize: evidenceRes.fileSize,
              }
            : { isAvailable: false }
        }
        sampleReportResource={
          sampleReportRes
            ? {
                isAvailable: true,
                originalName: sampleReportRes.originalName,
                fileSize: sampleReportRes.fileSize,
              }
            : { isAvailable: false }
        }
      />
    </ParticipantShell>
  );
}
