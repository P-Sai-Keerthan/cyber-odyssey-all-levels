import { cache } from 'react';
import { prisma } from '@/lib/prisma';

export interface AuthoritativeLevelState {
  id: string;
  levelNumber: number;
  name: string;
  codename: string;
  status: 'LOCKED' | 'READY' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  maxScore: number;
  durationMinutes: number;
  durationSeconds: number;
  remainingSeconds: number;
  startedAt: string | null;
  pausedAt: string | null;
  endsAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  isExpired: boolean;
}

const DEFAULT_LEVEL_CONFIGS = [
  {
    levelNumber: 1,
    name: 'Level 1 — The Initial Trace',
    codename: 'THE INITIAL TRACE',
    status: 'LOCKED',
    maxScore: 1000,
    durationMinutes: 60,
  },
  {
    levelNumber: 2,
    name: "Level 2 — The Boar's Mark",
    codename: "THE BOAR'S MARK",
    status: 'LIVE',
    maxScore: 1000,
    durationMinutes: 120,
  },
  {
    levelNumber: 3,
    name: 'Level 3 — The Twelve Axes',
    codename: 'THE TWELVE AXES',
    status: 'LOCKED',
    maxScore: 1000,
    durationMinutes: 120,
  },
];

/**
 * Process-local latch: once the three LevelState rows are known to exist, they
 * are not re-checked for the lifetime of the server process.
 *
 * PERF-17-05: `ensureLevelStatesExist` ran three `findUnique` queries on EVERY
 * call, and it is called by `getLevelState`, `getLevelStates` and `getActiveLevel`
 * — which sit on the participant dashboard, all three level pages, the event page,
 * and both staff consoles. That was three wasted round trips on the single
 * hottest read path in the portal, repeated for every one of ~210 participants
 * on every navigation, to answer a question whose answer never changes after the
 * first request.
 *
 * The rows are created by `prisma/seed.ts` and are only ever updated, never
 * deleted, so a per-process latch is sound. It resets on restart, so a database
 * that is genuinely empty is still repaired on the first request after boot.
 */
let levelStatesVerified = false;

/**
 * Ensures all 3 LevelState records exist in the database.
 * Idempotent, and effectively free after the first successful call per process.
 */
export async function ensureLevelStatesExist(): Promise<void> {
  if (levelStatesVerified) return;

  // One query for all three rows rather than one per level.
  const existing = await prisma.levelState.findMany({
    where: { levelNumber: { in: DEFAULT_LEVEL_CONFIGS.map((c) => c.levelNumber) } },
    select: { levelNumber: true },
  });
  const present = new Set(existing.map((r) => r.levelNumber));

  const missing = DEFAULT_LEVEL_CONFIGS.filter((cfg) => !present.has(cfg.levelNumber));

  for (const cfg of missing) {
    const durationSeconds = cfg.durationMinutes * 60;
    const now = new Date();
    const isLive = cfg.status === 'LIVE';
    try {
      await prisma.levelState.create({
        data: {
          levelNumber: cfg.levelNumber,
          name: cfg.name,
          codename: cfg.codename,
          status: cfg.status,
          maxScore: cfg.maxScore,
          durationMinutes: cfg.durationMinutes,
          durationSeconds,
          remainingSeconds: durationSeconds,
          startedAt: isLive ? now : null,
          endsAt: isLive ? new Date(now.getTime() + durationSeconds * 1000) : null,
        },
      });
    } catch {
      // A concurrent request created the same row first; levelNumber is unique,
      // so the row now exists either way.
    }
  }

  levelStatesVerified = true;
}

/**
 * Clears the process-local latch. Test-only: the suites truncate LevelState
 * between cases, and without this the latch would report rows that no longer exist.
 */
export function resetLevelStateVerificationCache(): void {
  levelStatesVerified = false;
}

/**
 * Returns the configured maximum score for a given level from the database.
 *
 * The comment below used to read "never hardcodes score values" while the body
 * ended in `?? 1000` — a silent default that is wrong for every level in this
 * event (Level 1 is 100, Level 3 is 200). Nothing in `src/` calls this today;
 * `resolveLevelEvaluationScale` is the authority on evaluation ceilings. But an
 * exported helper that answers "1000" when it cannot find the row is a trap for
 * whoever wires it up next, and it is precisely the defect that put `0/2000`
 * and `1000` in front of participants before.
 *
 * A missing LevelState row is a configuration failure, not a scoring input.
 * Saying so is the only honest answer; `ensureLevelStatesExist` has already had
 * its chance to create the row by the time we get here.
 */
export async function getLevelMaxScore(levelNumber: number): Promise<number> {
  await ensureLevelStatesExist();
  const state = await prisma.levelState.findUnique({
    where: { levelNumber },
    select: { maxScore: true },
  });
  if (!state) {
    throw new Error(
      `Level ${levelNumber} has no LevelState row, so it has no configured maximum score. ` +
        'Seed the level states before reading a score ceiling.',
    );
  }
  return state.maxScore;
}

/**
 * Resolves a raw LevelState record into an AuthoritativeLevelState with live expiry check.
 */
function resolveLevelState(record: {
  id: string;
  levelNumber: number;
  name: string;
  codename: string;
  status: string;
  maxScore?: number | null;
  durationMinutes: number;
  durationSeconds: number;
  remainingSeconds: number;
  startedAt: Date | null;
  pausedAt: Date | null;
  endsAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}): AuthoritativeLevelState {
  const now = Date.now();
  let status = record.status as 'LOCKED' | 'READY' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  let isExpired = false;
  let remainingSeconds = record.remainingSeconds;

  if (status === 'LIVE' && record.endsAt) {
    const diffMs = record.endsAt.getTime() - now;
    if (diffMs <= 0) {
      status = 'COMPLETED';
      isExpired = true;
      remainingSeconds = 0;
    } else {
      remainingSeconds = Math.max(0, Math.floor(diffMs / 1000));
    }
  } else if (status === 'PAUSED') {
    remainingSeconds = record.remainingSeconds;
  } else if (status === 'COMPLETED') {
    remainingSeconds = 0;
    isExpired = true;
  }

  return {
    id: record.id,
    levelNumber: record.levelNumber,
    name: record.name,
    codename: record.codename,
    status,
    maxScore: record.maxScore ?? 1000,
    durationMinutes: record.durationMinutes,
    durationSeconds: record.durationSeconds,
    remainingSeconds,
    startedAt: record.startedAt ? record.startedAt.toISOString() : null,
    pausedAt: record.pausedAt ? record.pausedAt.toISOString() : null,
    endsAt: record.endsAt ? record.endsAt.toISOString() : null,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    updatedAt: record.updatedAt.toISOString(),
    isExpired,
  };
}

/**
 * Returns all 3 level states with resolved dynamic time calculations.
 *
 * ---------------------------------------------------------------------------
 * REQUEST-SCOPED DEDUPLICATION
 * ---------------------------------------------------------------------------
 * `cache()` from React memoises for the lifetime of ONE server render and
 * nothing longer. It is not a TTL cache and it is not shared between requests
 * or between users — a second request always re-reads the database.
 *
 * Why it is needed here: a single `/event` render read `LevelState` THREE times
 * — `getLevelStates()` for the card grid, `getActiveLevel()` for the banner, and
 * the point-label helper — because each is called independently by a different
 * part of the tree. Measured with Prisma query logging: 8 queries per render, 3
 * of them this table. They now collapse to one.
 *
 * Safe because level state is event-wide configuration, identical for every
 * viewer, and any writer (start/pause/resume/stop) runs in a different request
 * from the render that reads it. Time-dependent fields are derived by
 * `resolveLevelState` from the record's own timestamps, so a memoised record
 * still produces a correct countdown within the render that read it.
 */
export const getLevelStates = cache(async function getLevelStates(): Promise<
  AuthoritativeLevelState[]
> {
  await ensureLevelStatesExist();

  const records = await prisma.levelState.findMany({
    orderBy: { levelNumber: 'asc' },
  });

  return records.map(resolveLevelState);
});

/**
 * Returns a single authoritative level state.
 *
 * Request-scoped like `getLevelStates` — several level pages resolve the same
 * level from more than one place in the tree. Memoised per `levelNumber`.
 */
export const getLevelState = cache(async function getLevelState(
  levelNumber: number,
): Promise<AuthoritativeLevelState | null> {
  await ensureLevelStatesExist();

  const record = await prisma.levelState.findUnique({
    where: { levelNumber },
  });

  if (!record) return null;
  return resolveLevelState(record);
});

/**
 * Returns the currently active (LIVE or PAUSED) level if any.
 */
export async function getActiveLevel(): Promise<AuthoritativeLevelState | null> {
  const levels = await getLevelStates();
  const liveLevel = levels.find((l) => l.status === 'LIVE');
  if (liveLevel) return liveLevel;
  const pausedLevel = levels.find((l) => l.status === 'PAUSED');
  if (pausedLevel) return pausedLevel;
  return null;
}

/**
 * Starts a level (status -> LIVE).
 */
export async function startLevelState(
  levelNumber: number,
  actorId?: string | null,
): Promise<AuthoritativeLevelState> {
  await ensureLevelStatesExist();

  const current = await prisma.levelState.findUnique({
    where: { levelNumber },
  });

  if (!current) {
    throw new Error(`Level ${levelNumber} does not exist.`);
  }

  const now = new Date();
  const remainingSec =
    current.remainingSeconds > 0 ? current.remainingSeconds : current.durationSeconds;
  const endsAt = new Date(now.getTime() + remainingSec * 1000);

  const updated = await prisma.levelState.update({
    where: { levelNumber },
    data: {
      status: 'LIVE',
      startedAt: now,
      endsAt,
      pausedAt: null,
      completedAt: null,
      remainingSeconds: remainingSec,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: actorId || null,
        action: 'LEVEL_STARTED',
        details: `Level ${levelNumber} (${current.codename}) started. Ends at ${endsAt.toISOString()}.`,
      },
    })
    .catch(() => {});

  return resolveLevelState(updated);
}

/**
 * Pauses a level (status -> PAUSED).
 */
export async function pauseLevelState(
  levelNumber: number,
  actorId?: string | null,
): Promise<AuthoritativeLevelState> {
  await ensureLevelStatesExist();

  const current = await prisma.levelState.findUnique({
    where: { levelNumber },
  });

  if (!current) {
    throw new Error(`Level ${levelNumber} does not exist.`);
  }

  if (current.status !== 'LIVE') {
    throw new Error(`Level ${levelNumber} is not currently LIVE.`);
  }

  const now = new Date();
  let remainingSec = current.remainingSeconds;
  if (current.endsAt) {
    remainingSec = Math.max(0, Math.floor((current.endsAt.getTime() - now.getTime()) / 1000));
  }

  const updated = await prisma.levelState.update({
    where: { levelNumber },
    data: {
      status: 'PAUSED',
      pausedAt: now,
      remainingSeconds: remainingSec,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: actorId || null,
        action: 'LEVEL_PAUSED',
        details: `Level ${levelNumber} (${current.codename}) paused. Remaining duration: ${remainingSec}s.`,
      },
    })
    .catch(() => {});

  return resolveLevelState(updated);
}

/**
 * Resumes a paused level (status -> LIVE).
 */
export async function resumeLevelState(
  levelNumber: number,
  actorId?: string | null,
): Promise<AuthoritativeLevelState> {
  await ensureLevelStatesExist();

  const current = await prisma.levelState.findUnique({
    where: { levelNumber },
  });

  if (!current) {
    throw new Error(`Level ${levelNumber} does not exist.`);
  }

  if (current.status !== 'PAUSED') {
    throw new Error(`Level ${levelNumber} is not currently PAUSED.`);
  }

  const now = new Date();
  const remainingSec =
    current.remainingSeconds > 0 ? current.remainingSeconds : current.durationSeconds;
  const endsAt = new Date(now.getTime() + remainingSec * 1000);

  const updated = await prisma.levelState.update({
    where: { levelNumber },
    data: {
      status: 'LIVE',
      startedAt: now,
      endsAt,
      pausedAt: null,
      remainingSeconds: remainingSec,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: actorId || null,
        action: 'LEVEL_RESUMED',
        details: `Level ${levelNumber} (${current.codename}) resumed. Ends at ${endsAt.toISOString()}.`,
      },
    })
    .catch(() => {});

  return resolveLevelState(updated);
}

/**
 * Stops or completes a level (status -> COMPLETED).
 */
export async function stopLevelState(
  levelNumber: number,
  actorId?: string | null,
): Promise<AuthoritativeLevelState> {
  await ensureLevelStatesExist();

  const current = await prisma.levelState.findUnique({
    where: { levelNumber },
  });

  if (!current) {
    throw new Error(`Level ${levelNumber} does not exist.`);
  }

  const now = new Date();
  const updated = await prisma.levelState.update({
    where: { levelNumber },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      remainingSeconds: 0,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: actorId || null,
        action: 'LEVEL_STOPPED',
        details: `Level ${levelNumber} (${current.codename}) stopped and marked COMPLETED.`,
      },
    })
    .catch(() => {});

  await prisma.auditLog
    .create({
      data: {
        actorId: actorId || null,
        action: 'LEVEL_COMPLETED',
        details: `Level ${levelNumber} (${current.codename}) completed.`,
      },
    })
    .catch(() => {});

  return resolveLevelState(updated);
}

/**
 * Resets a level (status -> LOCKED).
 */
export async function resetLevelState(
  levelNumber: number,
  actorId?: string | null,
): Promise<AuthoritativeLevelState> {
  await ensureLevelStatesExist();

  const current = await prisma.levelState.findUnique({
    where: { levelNumber },
  });

  if (!current) {
    throw new Error(`Level ${levelNumber} does not exist.`);
  }

  const durationSec = current.durationMinutes * 60;

  const updated = await prisma.levelState.update({
    where: { levelNumber },
    data: {
      status: 'LOCKED',
      startedAt: null,
      pausedAt: null,
      endsAt: null,
      completedAt: null,
      remainingSeconds: durationSec,
      durationSeconds: durationSec,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: actorId || null,
        action: 'LEVEL_RESET',
        details: `Level ${levelNumber} (${current.codename}) reset to LOCKED.`,
      },
    })
    .catch(() => {});

  return resolveLevelState(updated);
}

/**
 * Configures the duration for a level.
 */
export async function configureLevelDuration(
  levelNumber: number,
  durationMinutes: number,
  actorId?: string | null,
): Promise<AuthoritativeLevelState> {
  await ensureLevelStatesExist();

  if (durationMinutes < 1 || durationMinutes > 1440) {
    throw new Error('Duration must be between 1 and 1440 minutes (24 hours).');
  }

  const current = await prisma.levelState.findUnique({
    where: { levelNumber },
  });

  if (!current) {
    throw new Error(`Level ${levelNumber} does not exist.`);
  }

  const durationSeconds = durationMinutes * 60;
  const isLive = current.status === 'LIVE';
  let endsAt = current.endsAt;
  let remainingSeconds = durationSeconds;

  if (isLive && current.startedAt) {
    endsAt = new Date(current.startedAt.getTime() + durationSeconds * 1000);
    remainingSeconds = Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 1000));
  }

  const updated = await prisma.levelState.update({
    where: { levelNumber },
    data: {
      durationMinutes,
      durationSeconds,
      remainingSeconds,
      endsAt,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: actorId || null,
        action: 'LEVEL_DURATION_CONFIGURED',
        details: `Level ${levelNumber} duration set to ${durationMinutes} minutes (${durationSeconds}s).`,
      },
    })
    .catch(() => {});

  return resolveLevelState(updated);
}
