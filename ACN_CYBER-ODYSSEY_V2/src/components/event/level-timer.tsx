'use client';

import * as React from 'react';
import Link from 'next/link';
import { GradientButton } from '@/components/ui/gradient-button';

export type LevelTimerStatus =
  'LOCKED' | 'READY' | 'NOT_STARTED' | 'LIVE' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'EXPIRED';

export interface LevelTimerProps {
  levelNumber: number;
  name: string;
  codename: string;
  status: LevelTimerStatus;
  startedAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  pausedAt?: string | null | undefined;
  remainingSeconds: number;
  durationMinutes?: number | undefined;
  points?: string | undefined;
  description?: string | undefined;
  variant?: 'card' | 'banner' | 'workspace' | 'compact' | undefined;
  showLink?: boolean | undefined;
  href?: string | undefined;
  /**
   * Replaces the card variant's built-in "Enter Level N" link button.
   *
   * Levels 2 and 3 live inside this portal, so an ordinary `next/link` is the
   * right control for them. Level 1 does not — it is a separate application
   * reached by minting a one-time ticket — so its card supplies its own action
   * (`Level1Launch`) instead of a link that would only move the participant to
   * another portal page.
   *
   * Passing a slot rather than teaching this component about Level 1 keeps the
   * cross-application concern in the one component that already owns it.
   */
  actionSlot?: React.ReactNode | undefined;
  onExpire?: (() => void) | undefined;
  className?: string | undefined;
  hideLevelNav?: boolean | undefined;
}

function formatDigits(totalSeconds: number): {
  hours: string;
  minutes: string;
  seconds: string;
  formatted: string;
} {
  const safeSec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safeSec / 3600);
  const m = Math.floor((safeSec % 3600) / 60);
  const s = safeSec % 60;

  const hours = h < 10 ? `0${h}` : `${h}`;
  const minutes = m < 10 ? `0${m}` : `${m}`;
  const seconds = s < 10 ? `0${s}` : `${s}`;

  return {
    hours,
    minutes,
    seconds,
    formatted: `${hours}:${minutes}:${seconds}`,
  };
}

export function LevelTimer({
  levelNumber,
  name,
  codename,
  status: initialStatus,
  startedAt: _startedAt,
  endsAt,
  pausedAt: _pausedAt,
  remainingSeconds = 0,
  durationMinutes = 60,
  points,
  description,
  variant = 'card',
  showLink = false,
  href,
  actionSlot,
  onExpire,
  className = '',
  hideLevelNav = false,
}: LevelTimerProps) {
  // Normalize status
  const normalizedInitialStatus: LevelTimerStatus =
    initialStatus === 'ACTIVE' ? 'LIVE' : initialStatus === 'NOT_STARTED' ? 'READY' : initialStatus;

  // Deterministic initial time calculation based on server props
  const [timeLeft, setTimeLeft] = React.useState<{
    hours: string;
    minutes: string;
    seconds: string;
    formatted: string;
    isExpired: boolean;
    currentStatus: LevelTimerStatus;
  }>(() => {
    const isInitiallyCompleted =
      normalizedInitialStatus === 'COMPLETED' || normalizedInitialStatus === 'EXPIRED';
    const isLive = normalizedInitialStatus === 'LIVE';

    let displaySeconds = remainingSeconds;
    if (!isLive && !isInitiallyCompleted && remainingSeconds === 0) {
      displaySeconds = durationMinutes * 60;
    } else if (isInitiallyCompleted) {
      displaySeconds = 0;
    }

    const digits = formatDigits(displaySeconds);
    return {
      ...digits,
      isExpired: isInitiallyCompleted || (isLive && displaySeconds <= 0 && Boolean(endsAt)),
      currentStatus: normalizedInitialStatus,
    };
  });

  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;

  React.useEffect(() => {
    const isLive = normalizedInitialStatus === 'LIVE';
    const isPaused = normalizedInitialStatus === 'PAUSED';
    const isCompleted =
      normalizedInitialStatus === 'COMPLETED' || normalizedInitialStatus === 'EXPIRED';

    if (isCompleted) {
      setTimeLeft({
        hours: '00',
        minutes: '00',
        seconds: '00',
        formatted: '00:00:00',
        isExpired: true,
        currentStatus: 'COMPLETED',
      });
      return;
    }

    if (isPaused) {
      const digits = formatDigits(remainingSeconds);
      setTimeLeft({
        ...digits,
        isExpired: false,
        currentStatus: 'PAUSED',
      });
      return;
    }

    if (!isLive || !endsAt) {
      const displaySeconds = remainingSeconds > 0 ? remainingSeconds : durationMinutes * 60;
      const digits = formatDigits(displaySeconds);
      setTimeLeft({
        ...digits,
        isExpired: false,
        currentStatus: normalizedInitialStatus,
      });
      return;
    }

    const targetTimeMs = new Date(endsAt).getTime();

    function updateTick() {
      const now = Date.now();
      const diffMs = targetTimeMs - now;

      if (diffMs <= 0) {
        setTimeLeft({
          hours: '00',
          minutes: '00',
          seconds: '00',
          formatted: '00:00:00',
          isExpired: true,
          currentStatus: 'COMPLETED',
        });
        if (onExpireRef.current) {
          onExpireRef.current();
        }
        return;
      }

      const diffSec = Math.floor(diffMs / 1000);
      const digits = formatDigits(diffSec);
      setTimeLeft({
        ...digits,
        isExpired: false,
        currentStatus: 'LIVE',
      });
    }

    updateTick();
    const interval = setInterval(updateTick, 1000);
    return () => clearInterval(interval);
  }, [normalizedInitialStatus, endsAt, remainingSeconds, durationMinutes]);

  const isLive = timeLeft.currentStatus === 'LIVE' && !timeLeft.isExpired;
  const isPaused = timeLeft.currentStatus === 'PAUSED';
  const isCompleted = timeLeft.currentStatus === 'COMPLETED' || timeLeft.isExpired;
  const isLocked = timeLeft.currentStatus === 'LOCKED';
  const isReady = timeLeft.currentStatus === 'READY';

  const defaultHref = href || `/event/level-${levelNumber}`;

  // =========================================================================
  // 1. COMPACT VARIANT (For telemetry bars and inline headers)
  // =========================================================================
  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 font-mono text-xs ${className}`}>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-bold uppercase ${
            isLive
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
              : isPaused
                ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                : isCompleted
                  ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                  : 'border-border/60 bg-background/40 text-muted-foreground'
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              isLive
                ? 'animate-pulse bg-emerald-400'
                : isPaused
                  ? 'bg-amber-400'
                  : isCompleted
                    ? 'bg-rose-400'
                    : 'bg-muted-foreground'
            }`}
          />
          {isLive ? 'LIVE' : isPaused ? 'PAUSED' : isCompleted ? 'EXPIRED' : 'LOCKED'}
        </span>

        <span
          className={`font-mono font-bold tracking-wider ${
            isLive
              ? 'text-cyan-300'
              : isPaused
                ? 'text-amber-300'
                : isCompleted
                  ? 'text-rose-400'
                  : 'text-muted-foreground'
          }`}
        >
          {isLocked
            ? 'LOCKED'
            : isReady
              ? 'NOT STARTED'
              : isCompleted
                ? '00:00:00 (EXPIRED)'
                : timeLeft.formatted}
        </span>
      </div>
    );
  }

  // =========================================================================
  // 2. BANNER VARIANT (For prominent Top Dashboard Mission Clock)
  // =========================================================================
  if (variant === 'banner') {
    return (
      <div
        className={`border-border/80 bg-card/60 relative overflow-hidden rounded-2xl border p-6 shadow-2xl backdrop-blur-md sm:p-7 ${className}`}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-fuchsia-500/5 to-cyan-500/5"
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
              <span
                className={`size-2 rounded-full ${
                  isLive
                    ? 'animate-ping bg-cyan-400'
                    : isPaused
                      ? 'bg-amber-400'
                      : isCompleted
                        ? 'bg-rose-400'
                        : 'bg-muted-foreground'
                }`}
              />
              <span>
                MISSION CLOCK //{' '}
                {isLive
                  ? 'ACTIVE RUNTIME'
                  : isPaused
                    ? 'TIMER PAUSED'
                    : isCompleted
                      ? 'LEVEL COMPLETED'
                      : 'STANDBY'}
              </span>
            </div>
            <h2 className="font-sans text-xl font-bold tracking-tight text-white sm:text-2xl">
              {`${name.toUpperCase()} // ${codename}`}
            </h2>
            <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-bold ${
                  isLive
                    ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-400'
                    : isPaused
                      ? 'border-amber-500/30 bg-amber-950/30 text-amber-400'
                      : isCompleted
                        ? 'border-rose-500/30 bg-rose-950/30 text-rose-400'
                        : 'border-border/60 bg-background/40 text-muted-foreground'
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    isLive
                      ? 'animate-pulse bg-emerald-400'
                      : isPaused
                        ? 'bg-amber-400'
                        : isCompleted
                          ? 'bg-rose-400'
                          : 'bg-muted-foreground'
                  }`}
                />
                {isLive
                  ? 'LIVE COMPETITION'
                  : isPaused
                    ? 'LEVEL PAUSED'
                    : isCompleted
                      ? 'TIME EXPIRED'
                      : 'STANDBY'}
              </span>
              <span>•</span>
              <span>Sector ALPHA-09 Synchronization Active</span>
            </div>
          </div>

          <div className="flex flex-col items-start lg:items-end">
            <span className="text-muted-foreground pb-1.5 font-mono text-[11px] font-semibold tracking-widest uppercase">
              {isPaused
                ? 'PRESERVED TIME'
                : isCompleted
                  ? 'FINAL STATUS'
                  : isLive
                    ? 'TIME REMAINING'
                    : 'SCHEDULED DURATION'}
            </span>

            <div className="flex items-center gap-2 font-mono">
              {/* Hours */}
              <div className="flex flex-col items-center">
                <div
                  className={`border-border/80 bg-background/80 flex min-w-[56px] items-center justify-center rounded-xl border px-3 py-2 text-2xl font-black tracking-tight shadow-[0_0_12px_rgba(6,182,212,0.15)] sm:min-w-[70px] sm:text-4xl ${
                    isCompleted ? 'text-rose-400' : isPaused ? 'text-amber-300' : 'text-cyan-300'
                  }`}
                >
                  {timeLeft.hours}
                </div>
                <span className="text-muted-foreground pt-1 text-[9px] font-bold uppercase">
                  HRS
                </span>
              </div>

              <span
                className={`-mt-4 text-2xl font-black sm:text-4xl ${
                  isLive
                    ? 'animate-pulse text-cyan-500'
                    : isCompleted
                      ? 'text-rose-500'
                      : 'text-muted-foreground'
                }`}
              >
                :
              </span>

              {/* Minutes */}
              <div className="flex flex-col items-center">
                <div
                  className={`border-border/80 bg-background/80 flex min-w-[56px] items-center justify-center rounded-xl border px-3 py-2 text-2xl font-black tracking-tight shadow-[0_0_12px_rgba(6,182,212,0.15)] sm:min-w-[70px] sm:text-4xl ${
                    isCompleted ? 'text-rose-400' : isPaused ? 'text-amber-300' : 'text-cyan-300'
                  }`}
                >
                  {timeLeft.minutes}
                </div>
                <span className="text-muted-foreground pt-1 text-[9px] font-bold uppercase">
                  MIN
                </span>
              </div>

              <span
                className={`-mt-4 text-2xl font-black sm:text-4xl ${
                  isLive
                    ? 'animate-pulse text-cyan-500'
                    : isCompleted
                      ? 'text-rose-500'
                      : 'text-muted-foreground'
                }`}
              >
                :
              </span>

              {/* Seconds */}
              <div className="flex flex-col items-center">
                <div
                  className={`border-border/80 bg-background/80 flex min-w-[56px] items-center justify-center rounded-xl border px-3 py-2 text-2xl font-black tracking-tight shadow-[0_0_12px_rgba(245,158,11,0.15)] sm:min-w-[70px] sm:text-4xl ${
                    isCompleted ? 'text-rose-400' : isPaused ? 'text-amber-300' : 'text-amber-300'
                  }`}
                >
                  {timeLeft.seconds}
                </div>
                <span className="text-muted-foreground pt-1 text-[9px] font-bold uppercase">
                  SEC
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. WORKSPACE VARIANT (For in-level headers: /event/level-1, /event/level-2, /event/level-3)
  // =========================================================================
  if (variant === 'workspace') {
    return (
      <div
        className={`border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 font-mono shadow-2xl backdrop-blur-md sm:p-8 ${className}`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
              <span
                className={`size-2 rounded-full ${
                  isLive
                    ? 'animate-pulse bg-emerald-400'
                    : isPaused
                      ? 'bg-amber-400'
                      : isCompleted
                        ? 'bg-rose-400'
                        : 'bg-muted-foreground'
                }`}
              />
              <span>{`LEVEL ${levelNumber} // ${codename}`}</span>
              {points && (
                <span className="rounded border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                  {points}
                </span>
              )}
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {name}
            </h1>
            {description && (
              <p className="text-muted-foreground font-sans text-sm">{description}</p>
            )}
          </div>

          {!hideLevelNav && (
            <div className="flex items-center gap-3">
              <Link href="/event">
                <GradientButton variant="outline" size="sm" className="text-xs uppercase">
                  ← All Levels
                </GradientButton>
              </Link>
            </div>
          )}
        </div>

        {/* Authoritative Level Telemetry Bar */}
        <div className="grid grid-cols-2 gap-3 pt-2 text-xs sm:grid-cols-4">
          <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
            <span className="text-muted-foreground text-[10px] uppercase">LEVEL STATUS</span>
            <div
              className={`flex items-center gap-1.5 font-bold ${
                isLive
                  ? 'text-emerald-300'
                  : isPaused
                    ? 'text-amber-300'
                    : isCompleted
                      ? 'text-rose-300'
                      : 'text-muted-foreground'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  isLive
                    ? 'animate-pulse bg-emerald-400'
                    : isPaused
                      ? 'bg-amber-400'
                      : isCompleted
                        ? 'bg-rose-400'
                        : 'bg-muted-foreground'
                }`}
              />
              {isLive
                ? 'ACTIVE // IN PROGRESS'
                : isPaused
                  ? 'PAUSED'
                  : isCompleted
                    ? 'EXPIRED'
                    : isLocked
                      ? 'LOCKED'
                      : 'READY'}
            </div>
          </div>

          <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
            <span className="text-muted-foreground text-[10px] uppercase">
              {isPaused
                ? 'PRESERVED TIME'
                : isCompleted
                  ? 'TIME EXPIRED'
                  : isLive
                    ? 'TIME REMAINING'
                    : 'DURATION'}
            </span>
            <div
              className={`font-mono text-sm font-black ${
                isCompleted
                  ? 'text-rose-400'
                  : isPaused
                    ? 'text-amber-300'
                    : isLive
                      ? 'text-cyan-300'
                      : 'text-muted-foreground'
              }`}
            >
              {isLocked
                ? 'LOCKED'
                : isReady
                  ? `${durationMinutes} MIN`
                  : isCompleted
                    ? '00:00:00 (EXPIRED)'
                    : timeLeft.formatted}
            </div>
          </div>

          <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
            <span className="text-muted-foreground text-[10px] uppercase">DURATION WINDOW</span>
            <div className="font-bold text-amber-300">{durationMinutes} MIN ALLOCATED</div>
          </div>

          <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3">
            <span className="text-muted-foreground text-[10px] uppercase">POINTS</span>
            <div className="font-bold text-amber-300">
              {points || (levelNumber === 1 ? '100 PTS' : '500 PTS')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 4. CARD VARIANT (Default: Dashboard Level Card / Level Navigation Card)
  // =========================================================================
  const isAccessible = isLive || isCompleted;

  const cardInner = (
    <div
      className={`group flex h-full flex-col justify-between rounded-2xl border p-6 font-mono backdrop-blur-md transition-all ${
        isLive
          ? 'border-emerald-500/50 bg-emerald-950/20 shadow-[0_0_24px_rgba(16,185,129,0.15)] hover:border-emerald-400'
          : isPaused
            ? 'border-amber-500/50 bg-amber-950/20'
            : isCompleted
              ? 'bg-card/60 border-cyan-500/40 hover:border-cyan-500/60'
              : 'border-border/40 bg-card/30 opacity-65'
      } ${className}`}
    >
      <div className="space-y-4">
        {/* Top Level Number & Status Pill */}
        <div className="border-border/40 flex items-center justify-between border-b pb-3">
          <span className="text-xs font-extrabold tracking-wider text-white">
            LEVEL {levelNumber}
          </span>
          <span
            className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase ${
              isLive
                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.3)]'
                : isPaused
                  ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                  : isCompleted
                    ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                    : isReady
                      ? 'border-cyan-500/30 bg-cyan-950/20 text-cyan-400'
                      : 'border-border/60 bg-background/40 text-muted-foreground'
            }`}
          >
            {isLive
              ? 'LIVE'
              : isPaused
                ? 'PAUSED'
                : isCompleted
                  ? 'COMPLETED'
                  : isReady
                    ? 'READY'
                    : 'LOCKED'}
          </span>
        </div>

        {/* Level Name & Codename */}
        <div className="space-y-1">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            {codename}
          </div>
          <h3 className="font-sans text-base font-bold tracking-tight text-white group-hover:text-cyan-300">
            {name}
          </h3>
          {description && (
            <p className="text-muted-foreground line-clamp-2 font-sans text-xs leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Timer & Meta Footer */}
      <div className="border-border/40 space-y-4 border-t pt-4">
        {/* Digital Countdown Box */}
        <div className="border-border/60 bg-background/60 space-y-1 rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              {isLive
                ? 'TIME REMAINING'
                : isPaused
                  ? 'PRESERVED TIME'
                  : isCompleted
                    ? 'STATUS'
                    : 'DURATION'}
            </span>
            {points && (
              <span className="rounded border border-amber-500/30 bg-amber-950/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                {points}
              </span>
            )}
          </div>

          <div
            className={`font-mono text-lg font-black tracking-tight ${
              isLive
                ? 'text-cyan-300'
                : isPaused
                  ? 'text-amber-300'
                  : isCompleted
                    ? 'text-cyan-400'
                    : 'text-muted-foreground'
            }`}
          >
            {isLocked
              ? 'LOCKED / NOT STARTED'
              : isReady
                ? `READY (${durationMinutes} MIN)`
                : isCompleted
                  ? '00:00:00 (COMPLETED)'
                  : timeLeft.formatted}
          </div>
        </div>

        {/* Action Button
            ------------------------------------------------------------------
            The BUTTON is the control, not the card. Wrapping the whole card in
            a link (as this did before) makes the entire tile one giant target
            with no visible affordance, and it cannot contain a nested button —
            which Level 1 needs, because its action runs a ticket exchange
            rather than a navigation.

            A locked level renders inert text, never a disabled-looking control
            that still responds. There is nothing to focus and nothing to press. */}
        {(showLink || actionSlot) && (
          <div>
            {actionSlot ? (
              actionSlot
            ) : isAccessible ? (
              <Link
                href={defaultHref}
                aria-label={`Enter Level ${levelNumber}`}
                className="focus-visible:ring-cyan-accent block rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none"
              >
                <GradientButton
                  variant={isLive ? 'cyan' : 'outline'}
                  size="sm"
                  tabIndex={-1}
                  className="pointer-events-none w-full text-xs font-semibold tracking-wider uppercase"
                >
                  Enter Level {levelNumber} →
                </GradientButton>
              </Link>
            ) : isPaused ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 py-2 text-center text-xs font-bold text-amber-300">
                ⏸ Level Paused
              </div>
            ) : (
              <div
                className="border-border/40 bg-background/40 text-muted-foreground rounded-xl border py-2 text-center text-xs font-bold"
                aria-label={`Level ${levelNumber} is locked`}
              >
                🔒 Locked
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // The card is a container, never a control. Its action lives in the button
  // above, so an inaccessible level simply has no control to press — rather than
  // a whole-card link that looks identical whether or not it does anything.
  return <div className="h-full">{cardInner}</div>;
}
