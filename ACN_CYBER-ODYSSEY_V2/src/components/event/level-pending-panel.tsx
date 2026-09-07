import Link from 'next/link';
import { GradientButton } from '@/components/ui/gradient-button';
import { formatShortDateTime } from '@/lib/utils/date-formatter';

export interface LevelPendingPanelProps {
  levelNumber: number;
  name: string;
  codename: string;
  /** Authoritative status from LevelState. */
  status: 'LOCKED' | 'READY' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  /** Scheduled opening time from the published event schedule, if configured. */
  scheduledTime?: string | undefined;
  /** Allocated duration in minutes, from LevelState. */
  durationMinutes?: number | undefined;
  /** Authoritative start timestamp once the level has been opened. */
  startedAt?: string | null | undefined;
  /** Authoritative end timestamp once the level has been opened. */
  endsAt?: string | null | undefined;
  points?: string | undefined;
}

/**
 * Status panel for a level whose competition content is not yet implemented.
 *
 * Levels 1 and 3 have authoritative scheduling, timers and lock state, but their
 * challenge content has not been built. This panel is deliberately honest about
 * that: it presents the real state the operations desk has configured and says
 * plainly that the briefing is not released yet.
 *
 * It does NOT invent challenge content. The previous Level 1 page described a
 * compromised gateway and told squads they had "completed initial telemetry
 * triage" — narrative that no challenge backs. A participant reading it would
 * reasonably believe they had missed or already finished work that does not
 * exist, and would not know to wait for a briefing.
 *
 * Everything shown here comes from LevelState, so the panel stays correct when
 * the operations desk schedules, starts, pauses or completes the level.
 */
export function LevelPendingPanel({
  levelNumber,
  name,
  codename,
  status,
  scheduledTime,
  durationMinutes,
  startedAt,
  endsAt,
  points,
}: LevelPendingPanelProps) {
  const isLive = status === 'LIVE';
  const isPaused = status === 'PAUSED';
  const isCompleted = status === 'COMPLETED';
  const isReady = status === 'READY';

  // What the participant should understand, per authoritative state.
  const headline = isLive
    ? 'BRIEFING NOT YET RELEASED'
    : isPaused
      ? 'LEVEL PAUSED BY OPERATIONS DESK'
      : isCompleted
        ? 'LEVEL WINDOW CLOSED'
        : isReady
          ? 'SCHEDULED — NOT YET OPEN'
          : 'LOCKED — AWAITING ACTIVATION';

  const explanation = isLive
    ? `The operations desk has opened the Level ${levelNumber} window, but the challenge briefing for ` +
      `${codename} has not been published to the portal yet. Nothing is required from your squad until it appears.`
    : isPaused
      ? `Level ${levelNumber} is paused. The mission clock is held and no submissions are being accepted. ` +
        'Stand by for the operations desk to resume the session.'
      : isCompleted
        ? `The Level ${levelNumber} window has closed. No further submissions are accepted for this level.`
        : isReady
          ? `Level ${levelNumber} is scheduled and will unlock when the operations desk activates it. ` +
            'You do not need to do anything to prepare beyond keeping your squad assembled.'
          : `Level ${levelNumber} is locked. It will unlock when the operations desk activates it, and an ` +
            'announcement will be broadcast to the portal at that moment.';

  const nextStep = isCompleted
    ? 'Review the leaderboard for standings, and continue with any level that is currently open.'
    : 'Continue with Level 2 — The Boar’s Mark, which is the active investigation, and watch the ' +
      'announcements feed for the release notice.';

  return (
    <div className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 font-mono shadow-xl backdrop-blur-md sm:p-8">
      {/* Status header */}
      <div className="border-border/40 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold tracking-widest uppercase">
            <span
              className={`size-2 rounded-full ${
                isLive
                  ? 'animate-pulse bg-amber-400'
                  : isPaused
                    ? 'bg-amber-400'
                    : isCompleted
                      ? 'bg-rose-400'
                      : 'bg-cyan-400'
              }`}
              aria-hidden="true"
            />
            <span className="text-cyan-400">{`LEVEL ${levelNumber} // ${codename}`}</span>
            <span className="rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[9px] font-bold text-amber-300">
              CONTENT PENDING
            </span>
          </div>
          <h2 className="font-sans text-lg font-bold tracking-tight text-white sm:text-xl">
            {headline}
          </h2>
        </div>

        {points && (
          <span className="self-start rounded-md border border-amber-500/30 bg-amber-950/30 px-2.5 py-1 text-[10px] font-bold text-amber-300">
            {points}
          </span>
        )}
      </div>

      {/* Plain-language explanation */}
      <div className="text-muted-foreground space-y-3 font-sans text-sm leading-relaxed">
        <p>{explanation}</p>
        <p>
          <span className="font-semibold text-white">What to do next: </span>
          {nextStep}
        </p>
      </div>

      {/* Authoritative schedule facts */}
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
          <dt className="text-muted-foreground text-[10px] uppercase">Level</dt>
          <dd className="font-bold text-white">{name}</dd>
        </div>

        <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
          <dt className="text-muted-foreground text-[10px] uppercase">Current status</dt>
          <dd
            className={`font-bold ${
              isLive
                ? 'text-emerald-300'
                : isPaused
                  ? 'text-amber-300'
                  : isCompleted
                    ? 'text-rose-300'
                    : 'text-cyan-300'
            }`}
          >
            {status}
          </dd>
        </div>

        <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
          <dt className="text-muted-foreground text-[10px] uppercase">Scheduled window</dt>
          <dd className="font-bold text-amber-300">
            {startedAt && endsAt
              ? `${formatShortDateTime(startedAt)} UTC`
              : scheduledTime || 'To be announced'}
          </dd>
        </div>

        <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
          <dt className="text-muted-foreground text-[10px] uppercase">Allocated duration</dt>
          <dd className="font-bold text-amber-300">
            {durationMinutes ? `${durationMinutes} MIN` : 'To be announced'}
          </dd>
        </div>
      </dl>

      {endsAt && (
        <p className="text-muted-foreground text-[11px]">
          Level window closes at{' '}
          <time dateTime={endsAt} className="font-bold text-white">
            {formatShortDateTime(endsAt)} UTC
          </time>
          . All times shown across the portal are UTC.
        </p>
      )}

      {/* Navigation */}
      <div className="border-border/40 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-muted-foreground text-xs">
          Announcements are broadcast to the portal the moment this level opens.
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/event">
            <GradientButton variant="outline" size="sm" className="text-xs font-semibold uppercase">
              ← All Levels
            </GradientButton>
          </Link>
          <Link href="/announcements">
            <GradientButton variant="outline" size="sm" className="text-xs font-semibold uppercase">
              Announcements
            </GradientButton>
          </Link>
        </div>
      </div>
    </div>
  );
}
