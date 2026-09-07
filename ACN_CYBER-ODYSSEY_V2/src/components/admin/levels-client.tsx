'use client';

import * as React from 'react';
import {
  startLevelAction,
  pauseLevelAction,
  resumeLevelAction,
  stopLevelAction,
  resetLevelAction,
  configureLevelDurationAction,
} from '@/lib/actions/admin-actions';
import { ConfirmationModal } from '@/components/creator/confirmation-modal';
import type { AuthoritativeLevelState } from '@/lib/event/level-state';
import { formatTime } from '@/lib/utils/date-formatter';

export interface EnrichedLevelState extends AuthoritativeLevelState {
  participatingTeams: number;
  submissionCount: number;
  evaluationCount: number;
}

export interface LevelsClientProps {
  initialLevels: EnrichedLevelState[];
}

export function LevelsClient({ initialLevels }: LevelsClientProps) {
  const [levels, setLevels] = React.useState<EnrichedLevelState[]>(initialLevels);
  const [durationInputs, setDurationInputs] = React.useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    for (const lvl of initialLevels) {
      initial[lvl.levelNumber] = lvl.durationMinutes;
    }
    return initial;
  });

  // Modal State
  const [modalState, setModalState] = React.useState<{
    isOpen: boolean;
    levelNumber: number;
    action: 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'RESET' | 'DURATION';
    title: string;
    description: string;
    variant: 'danger' | 'warning' | 'primary';
    confirmLabel: string;
  }>({
    isOpen: false,
    levelNumber: 1,
    action: 'START',
    title: '',
    description: '',
    variant: 'primary',
    confirmLabel: '',
  });

  const [isPending, setIsPending] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Client-side ticking timer for live visualization
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  function promptAction(
    levelNumber: number,
    action: 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'RESET' | 'DURATION',
  ) {
    setErrorMsg(null);
    const lvl = levels.find((l) => l.levelNumber === levelNumber);
    if (!lvl) return;

    if (action === 'START') {
      setModalState({
        isOpen: true,
        levelNumber,
        action: 'START',
        title: `Start Level ${levelNumber} (${lvl.codename})?`,
        description: `This will mark Level ${levelNumber} as LIVE across the entire competition portal and start the authoritative server countdown timer. Eligible participants will gain access immediately.`,
        variant: 'primary',
        confirmLabel: 'Start Level Now',
      });
    } else if (action === 'PAUSE') {
      setModalState({
        isOpen: true,
        levelNumber,
        action: 'PAUSE',
        title: `Pause Level ${levelNumber} (${lvl.codename})?`,
        description: `This will freeze the countdown timer and temporarily suspend participant actions. The remaining duration will be preserved until resumed.`,
        variant: 'warning',
        confirmLabel: 'Pause Level',
      });
    } else if (action === 'RESUME') {
      setModalState({
        isOpen: true,
        levelNumber,
        action: 'RESUME',
        title: `Resume Level ${levelNumber} (${lvl.codename})?`,
        description: `This will unfreeze the timer and calculate a new authoritative end timestamp based on the remaining preserved duration.`,
        variant: 'primary',
        confirmLabel: 'Resume Level',
      });
    } else if (action === 'STOP') {
      setModalState({
        isOpen: true,
        levelNumber,
        action: 'STOP',
        title: `Stop & Complete Level ${levelNumber}?`,
        description: `This will close Level ${levelNumber} immediately. Further participant submissions will be locked. All existing deliverables will remain intact for evaluation.`,
        variant: 'danger',
        confirmLabel: 'Stop Level',
      });
    } else if (action === 'RESET') {
      setModalState({
        isOpen: true,
        levelNumber,
        action: 'RESET',
        title: `Reset Level ${levelNumber} to Locked?`,
        description: `This will reset Level ${levelNumber} status to LOCKED and clear current timer timestamps. Submitted deliverables will not be deleted.`,
        variant: 'danger',
        confirmLabel: 'Reset Level',
      });
    } else if (action === 'DURATION') {
      const mins = durationInputs[levelNumber] || lvl.durationMinutes;
      setModalState({
        isOpen: true,
        levelNumber,
        action: 'DURATION',
        title: `Set Level ${levelNumber} Duration to ${mins} Minutes?`,
        description: `This will update the authoritative duration for Level ${levelNumber}. If the level is currently LIVE, the end timestamp will be recalculated.`,
        variant: 'warning',
        confirmLabel: 'Save Duration',
      });
    }
  }

  async function handleConfirmModal() {
    try {
      setIsPending(true);
      setErrorMsg(null);
      const { levelNumber, action } = modalState;

      let result;
      if (action === 'START') {
        result = await startLevelAction(levelNumber);
      } else if (action === 'PAUSE') {
        result = await pauseLevelAction(levelNumber);
      } else if (action === 'RESUME') {
        result = await resumeLevelAction(levelNumber);
      } else if (action === 'STOP') {
        result = await stopLevelAction(levelNumber);
      } else if (action === 'RESET') {
        result = await resetLevelAction(levelNumber);
      } else if (action === 'DURATION') {
        const mins = durationInputs[levelNumber] || 60;
        result = await configureLevelDurationAction(levelNumber, mins);
      }

      if (result && !result.success) {
        setErrorMsg(result.error || 'Failed to update level state.');
        return;
      }

      if (result && result.data) {
        const updated = result.data;
        setLevels((prev) =>
          prev.map((l) =>
            l.levelNumber === levelNumber
              ? {
                  ...l,
                  ...updated,
                }
              : l,
          ),
        );
      }

      setModalState((prev) => ({ ...prev, isOpen: false }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
              <span className="size-2 animate-pulse rounded-full bg-cyan-400" />
              <span>MARSHAL DESK // LEVEL OPERATIONS</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Level Lifecycle & Timers
            </h1>
            <p className="text-muted-foreground font-sans text-sm">
              Server-authoritative level operations. Start, pause, resume, and configure durations
              for all competition tiers.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Levels Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {levels.map((lvl) => {
          const isLive = lvl.status === 'LIVE';
          const isPaused = lvl.status === 'PAUSED';
          const isCompleted = lvl.status === 'COMPLETED';
          const isLocked = lvl.status === 'LOCKED' || lvl.status === 'READY';

          // Live countdown calculation
          let remainingSec = lvl.remainingSeconds;
          if (isLive && lvl.endsAt && now > 0) {
            const endsAtMs = new Date(lvl.endsAt).getTime();
            remainingSec = Math.max(0, Math.floor((endsAtMs - now) / 1000));
          }

          const hours = Math.floor(remainingSec / 3600);
          const minutes = Math.floor((remainingSec % 3600) / 60);
          const seconds = remainingSec % 60;
          const formattedTimer = `${hours.toString().padStart(2, '0')}:${minutes
            .toString()
            .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

          const statusBadgeClass = isLive
            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
            : isPaused
              ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
              : isCompleted
                ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                : 'border-border bg-background/60 text-muted-foreground';

          return (
            <div
              key={lvl.levelNumber}
              className="border-border/80 bg-card/60 flex flex-col justify-between space-y-6 rounded-2xl border p-6 shadow-2xl backdrop-blur-md"
            >
              <div className="space-y-4">
                {/* Level Tag & Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-cyan-400 uppercase">
                    <span className="size-2 rounded-full bg-cyan-400" />
                    <span>LEVEL {lvl.levelNumber}</span>
                  </div>
                  <span
                    className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass}`}
                  >
                    {lvl.status}
                  </span>
                </div>

                {/* Level Title */}
                <div>
                  <h2 className="font-sans text-lg font-bold text-white">{lvl.name}</h2>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">{lvl.codename}</p>
                </div>

                {/* Prominent Authoritative Clock */}
                <div className="border-border/60 bg-background/60 space-y-1 rounded-xl border p-4 text-center">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    {isLive
                      ? 'AUTHORITATIVE RUNTIME'
                      : isPaused
                        ? 'TIMER PAUSED'
                        : isCompleted
                          ? 'LEVEL CLOSED'
                          : 'STANDBY'}
                  </span>
                  <div
                    className={`text-3xl font-black ${
                      isLive
                        ? 'animate-pulse text-emerald-300'
                        : isPaused
                          ? 'text-amber-300'
                          : isCompleted
                            ? 'text-muted-foreground'
                            : 'text-cyan-300'
                    }`}
                  >
                    {formattedTimer}
                  </div>
                </div>

                {/* Telemetry Breakdown */}
                <div className="border-border/40 grid grid-cols-2 gap-2 border-t pt-4 text-[11px]">
                  <div>
                    <span className="text-muted-foreground text-[10px] uppercase">START TIME</span>
                    <div className="font-bold text-white">
                      {lvl.startedAt ? formatTime(lvl.startedAt) : '—'}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] uppercase">END TIME</span>
                    <div className="font-bold text-white">
                      {lvl.endsAt ? formatTime(lvl.endsAt) : '—'}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] uppercase">SUBMISSIONS</span>
                    <div className="font-bold text-cyan-300">{lvl.submissionCount}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] uppercase">EVALUATED</span>
                    <div className="font-bold text-amber-300">{lvl.evaluationCount}</div>
                  </div>
                </div>

                {/* Duration Configurator */}
                <div className="border-border/40 space-y-2 border-t pt-4">
                  <label className="text-muted-foreground block text-[10px] font-semibold uppercase">
                    Configure Duration (Minutes)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={durationInputs[lvl.levelNumber] ?? lvl.durationMinutes}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 1;
                        setDurationInputs((prev) => ({ ...prev, [lvl.levelNumber]: val }));
                      }}
                      className="border-border/80 bg-background/60 w-24 rounded-lg border px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => promptAction(lvl.levelNumber, 'DURATION')}
                      className="border-border text-muted-foreground hover:bg-card rounded-lg border px-3 py-1.5 text-xs transition-all hover:text-white"
                    >
                      Update
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Controls */}
              <div className="border-border/40 space-y-2 border-t pt-4">
                {isLocked && (
                  <button
                    type="button"
                    onClick={() => promptAction(lvl.levelNumber, 'START')}
                    className="w-full rounded-xl border border-emerald-500/50 bg-emerald-950/50 py-2.5 text-xs font-bold text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)] transition-all hover:bg-emerald-900/60 hover:text-white"
                  >
                    START LEVEL →
                  </button>
                )}

                {isLive && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => promptAction(lvl.levelNumber, 'PAUSE')}
                      className="rounded-xl border border-amber-500/50 bg-amber-950/40 py-2 text-xs font-bold text-amber-300 transition-all hover:bg-amber-900/50 hover:text-white"
                    >
                      PAUSE
                    </button>
                    <button
                      type="button"
                      onClick={() => promptAction(lvl.levelNumber, 'STOP')}
                      className="rounded-xl border border-rose-500/50 bg-rose-950/40 py-2 text-xs font-bold text-rose-300 transition-all hover:bg-rose-900/50 hover:text-white"
                    >
                      STOP
                    </button>
                  </div>
                )}

                {isPaused && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => promptAction(lvl.levelNumber, 'RESUME')}
                      className="rounded-xl border border-emerald-500/50 bg-emerald-950/40 py-2 text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-900/50 hover:text-white"
                    >
                      RESUME
                    </button>
                    <button
                      type="button"
                      onClick={() => promptAction(lvl.levelNumber, 'STOP')}
                      className="rounded-xl border border-rose-500/50 bg-rose-950/40 py-2 text-xs font-bold text-rose-300 transition-all hover:bg-rose-900/50 hover:text-white"
                    >
                      STOP
                    </button>
                  </div>
                )}

                {isCompleted && (
                  <button
                    type="button"
                    onClick={() => promptAction(lvl.levelNumber, 'RESET')}
                    className="border-border bg-background/50 text-muted-foreground hover:bg-card w-full rounded-xl border py-2 text-xs font-bold transition-all hover:text-white"
                  >
                    RESET LEVEL
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={modalState.isOpen}
        title={modalState.title}
        description={modalState.description}
        confirmLabel={modalState.confirmLabel}
        variant={modalState.variant}
        isPending={isPending}
        onConfirm={handleConfirmModal}
        onCancel={() => !isPending && setModalState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
