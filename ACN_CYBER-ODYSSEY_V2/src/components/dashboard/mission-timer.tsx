'use client';

import * as React from 'react';

export interface MissionTimerProps {
  /**
   * Authoritative event end timestamp from server-side LevelState.
   */
  targetTimestamp?: string | number | Date | null;
  status?: string;
  phaseLabel?: string;
  isPaused?: boolean;
  remainingSeconds?: number;
}

export function MissionTimer({
  targetTimestamp,
  status = 'LIVE COMPETITION',
  phaseLabel = "LEVEL 2 — THE BOAR'S MARK",
  isPaused = false,
  remainingSeconds = 7200,
}: MissionTimerProps) {
  const [timeLeft, setTimeLeft] = React.useState<{
    hours: string;
    minutes: string;
    seconds: string;
    isExpired: boolean;
  }>(() => {
    const sec = remainingSeconds;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return {
      hours: h < 10 ? `0${h}` : `${h}`,
      minutes: m < 10 ? `0${m}` : `${m}`,
      seconds: s < 10 ? `0${s}` : `${s}`,
      isExpired: sec <= 0 && !isPaused && Boolean(targetTimestamp),
    };
  });

  React.useEffect(() => {
    if (isPaused) {
      const h = Math.floor(remainingSeconds / 3600);
      const m = Math.floor((remainingSeconds % 3600) / 60);
      const s = remainingSeconds % 60;
      setTimeLeft({
        hours: h < 10 ? `0${h}` : `${h}`,
        minutes: m < 10 ? `0${m}` : `${m}`,
        seconds: s < 10 ? `0${s}` : `${s}`,
        isExpired: false,
      });
      return;
    }

    if (!targetTimestamp) {
      return;
    }

    const endTime = new Date(targetTimestamp).getTime();

    function calculateRemaining() {
      const diff = Math.max(0, endTime - Date.now());
      if (diff <= 0) {
        setTimeLeft({
          hours: '00',
          minutes: '00',
          seconds: '00',
          isExpired: true,
        });
        return;
      }

      const totalSeconds = Math.floor(diff / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;

      setTimeLeft({
        hours: h < 10 ? `0${h}` : `${h}`,
        minutes: m < 10 ? `0${m}` : `${m}`,
        seconds: s < 10 ? `0${s}` : `${s}`,
        isExpired: false,
      });
    }

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);
    return () => clearInterval(interval);
  }, [targetTimestamp, isPaused, remainingSeconds]);

  return (
    <div className="border-border/80 bg-card/60 relative overflow-hidden rounded-2xl border p-6 shadow-2xl backdrop-blur-md sm:p-7">
      {/* Ambient background glow behind digits */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-fuchsia-500/5 to-cyan-500/5"
        aria-hidden="true"
      />

      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Left Side: Status & Phase Identifier */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
            <span
              className={`size-2 rounded-full ${
                isPaused ? 'bg-amber-400' : 'animate-ping bg-cyan-400'
              }`}
            />
            <span>MISSION CLOCK // {isPaused ? 'TIMER PAUSED' : 'ACTIVE RUNTIME'}</span>
          </div>
          <h2 className="font-sans text-xl font-bold tracking-tight text-white sm:text-2xl">
            {phaseLabel}
          </h2>
          <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-bold ${
                isPaused
                  ? 'border-amber-500/30 bg-amber-950/30 text-amber-400'
                  : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-400'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-emerald-400'}`}
              />
              {status}
            </span>
            <span>•</span>
            <span>Sector ALPHA-09 Synchronization Active</span>
          </div>
        </div>

        {/* Right Side: Prominent Mission Countdown Display */}
        <div className="flex flex-col items-start lg:items-end">
          <span className="text-muted-foreground pb-1.5 font-mono text-[11px] font-semibold tracking-widest uppercase">
            {isPaused ? 'PRESERVED TIME' : 'TIME REMAINING'}
          </span>

          <div className="flex items-center gap-2 font-mono">
            {/* Hours */}
            <div className="flex flex-col items-center">
              <div className="border-border/80 bg-background/80 flex min-w-[56px] items-center justify-center rounded-xl border px-3 py-2 text-2xl font-black tracking-tight text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)] sm:min-w-[70px] sm:text-4xl">
                {timeLeft.hours}
              </div>
              <span className="text-muted-foreground pt-1 text-[9px] font-bold uppercase">HRS</span>
            </div>

            <span className="-mt-4 animate-pulse text-2xl font-black text-cyan-500 sm:text-4xl">
              :
            </span>

            {/* Minutes */}
            <div className="flex flex-col items-center">
              <div className="border-border/80 bg-background/80 flex min-w-[56px] items-center justify-center rounded-xl border px-3 py-2 text-2xl font-black tracking-tight text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)] sm:min-w-[70px] sm:text-4xl">
                {timeLeft.minutes}
              </div>
              <span className="text-muted-foreground pt-1 text-[9px] font-bold uppercase">MIN</span>
            </div>

            <span className="-mt-4 animate-pulse text-2xl font-black text-cyan-500 sm:text-4xl">
              :
            </span>

            {/* Seconds */}
            <div className="flex flex-col items-center">
              <div className="border-border/80 bg-background/80 flex min-w-[56px] items-center justify-center rounded-xl border px-3 py-2 text-2xl font-black tracking-tight text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)] sm:min-w-[70px] sm:text-4xl">
                {timeLeft.seconds}
              </div>
              <span className="text-muted-foreground pt-1 text-[9px] font-bold uppercase">SEC</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
