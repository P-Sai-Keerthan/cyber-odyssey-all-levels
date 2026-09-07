'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { GradientButton } from '@/components/ui/gradient-button';
import { startLevel1SessionAction } from '@/lib/actions/level1-actions';

/**
 * How long to wait for the browser to actually leave this page before deciding
 * the Level 1 application is not answering.
 *
 * `window.location.assign` returns immediately and reports nothing: if the target
 * origin is down, misconfigured, or on a port nobody is listening to, the browser
 * simply sits there. Without a bound, "Opening Level 1…" is a spinner that never
 * resolves — which is exactly the failure this control must not produce.
 *
 * Twelve seconds is longer than any healthy redirect (the entry route does one
 * signed round trip to this portal and then a 302) and short enough that a
 * participant is not left guessing.
 */
const NAVIGATION_TIMEOUT_MS = 12_000;

export interface Level1LaunchProps {
  /** Authoritative LevelState status. Only LIVE offers entry. */
  status: 'LOCKED' | 'READY' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  /** False when LEVEL1_CHALLENGE_URL is unset, so the panel can say so plainly. */
  configured: boolean;
  /**
   * `panel` — the standalone block on /event/level-1, with its explanatory copy.
   * `card`  — just the control and its errors, for the Level 1 tile on /event,
   *           where the surrounding card already supplies the heading, status
   *           pill, description and timer.
   *
   * One component either way. The Level 1 entry sequence is a ticket exchange
   * with a watchdog and four failure paths; having a second copy of it behind
   * the card button is how the two drift apart.
   */
  variant?: 'panel' | 'card' | undefined;
}

/**
 * Entry control for the external Level 1 application.
 *
 * The button asks the server for a one-time ticket and then navigates. It never
 * receives, holds, or sends a squad identifier — the server reads the squad from
 * the session, which is what stops a participant entering Level 1 as somebody
 * else by editing a form value.
 *
 * `window.location.assign` rather than an anchor: the destination does not exist
 * until the action returns, and a full navigation (not `router.push`) is correct
 * because Level 1 is a different origin entirely.
 */
export function Level1Launch({ status, configured, variant = 'panel' }: Level1LaunchProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** Kept so a manual retry link can be offered when navigation stalls. */
  const [entryUrl, setEntryUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLive = status === 'LIVE';

  // Clear the watchdog if the component unmounts before it fires, so it cannot
  // call setState on an unmounted component during a successful navigation.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleEnter() {
    setError(null);
    setEntryUrl(null);
    startTransition(async () => {
      try {
        setLeaving(true);
        const result = await startLevel1SessionAction();

        if (!result.success || !result.data) {
          setLeaving(false);
          setError(result.error ?? 'Unable to enter Level 1. Please try again.');
          return;
        }

        const url = result.data.entryUrl;
        setEntryUrl(url);

        // The watchdog. If the browser has not left this page by the time it
        // fires, the Level 1 origin did not answer — say so, and hand back a
        // usable control. Without this the button sits on "Opening Level 1…"
        // for as long as the participant is willing to stare at it.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setLeaving(false);
          setError(
            'Level 1 did not respond. It may not be running yet. ' +
              'Try again, or use the direct link below and tell an event marshal if it keeps failing.',
          );
        }, NAVIGATION_TIMEOUT_MS);

        window.location.assign(url);
      } catch (err: unknown) {
        // A failed Server Action (network drop, server restart mid-request)
        // lands here. Previously an unhandled rejection here left the button
        // disabled and spinning with nothing to click.
        if (timerRef.current) clearTimeout(timerRef.current);
        setLeaving(false);
        setError(
          err instanceof Error && err.message
            ? `Could not start a Level 1 session: ${err.message}`
            : 'Could not start a Level 1 session. Please try again.',
        );
      }
    });
  }

  /**
   * Shared by both variants: the button, plus the error and the direct-link
   * escape hatch. The card variant is exactly this and nothing else — the tile
   * around it already says which level this is and what state it is in.
   */
  const control = (
    <>
      <GradientButton
        variant="cyan"
        size={variant === 'card' ? 'sm' : 'default'}
        onClick={handleEnter}
        disabled={!configured || !isLive || pending || leaving}
        isLoading={pending || leaving}
        className={
          variant === 'card' ? 'w-full text-xs font-semibold tracking-wider uppercase' : undefined
        }
      >
        {leaving ? 'Opening Level 1…' : 'ENTER LEVEL 1 →'}
      </GradientButton>

      {error && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-destructive font-mono text-xs">{error}</p>
          {/* A ticket was issued but the browser never left. It is single-use and
              still valid for its two-minute window, so offering it directly costs
              nothing and rescues the common case: Level 1 was slow to start. */}
          {entryUrl && (
            <a
              href={entryUrl}
              className="text-cyan-accent font-mono text-xs underline underline-offset-2"
            >
              Open Level 1 directly →
            </a>
          )}
        </div>
      )}
    </>
  );

  if (variant === 'card') {
    return (
      <div className="flex flex-col gap-2">
        {/* Locked, paused and unconfigured states are already spelled out by the
            card's status pill and countdown, so the tile only needs the reason
            the button will not respond when that reason is NOT the status. */}
        {!configured && isLive && (
          <p className="text-[10px] leading-snug text-amber-300">
            Level 1 address not configured on this portal.
          </p>
        )}
        {control}
      </div>
    );
  }

  return (
    <div className="border-border/70 bg-card/40 flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-mono text-xs font-semibold tracking-wider uppercase">
          Level 1 Workspace
        </h3>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Level 1 runs in a separate application. Entering signs your squad in there automatically —
          you will not be asked for a password, and nothing you score is entered by hand. Results
          reach this portal on their own.
        </p>
      </div>

      {!configured && (
        <p className="text-sm text-amber-300">
          The Level 1 application address has not been configured on this portal yet. Tell an event
          marshal — your squad does not need to do anything.
        </p>
      )}

      {configured && !isLive && (
        <p className="text-muted-foreground text-sm">
          {status === 'PAUSED'
            ? 'Level 1 is paused. Entry reopens when the operations desk resumes it.'
            : status === 'COMPLETED'
              ? 'Level 1 has closed. Your recorded score stands on the leaderboard.'
              : 'Level 1 has not opened yet. The entry control activates the moment it does.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {control}
        {isLive && configured && (
          <span className="text-muted-foreground font-mono text-xs">
            One-time entry link · valid for 2 minutes
          </span>
        )}
      </div>
    </div>
  );
}
