import 'server-only';
import { prisma } from '@/lib/prisma';
import { combineLevel3Score } from '@/lib/level3/scoring-policy';

/**
 * Level 3 scoring.
 *
 * ---------------------------------------------------------------------------
 * THREE COMPONENTS, NEVER MERGED AT REST
 * ---------------------------------------------------------------------------
 *   DISCOVERIES  sum(Level3Discovery.awardedPoints) — server-verified bug finds,
 *                ingested from ORION. Official the moment they exist.
 *   PENALTIES    sum(Level3Penalty.points) — hints the squad chose to spend.
 *   REPORT       the evaluator's score, and ONLY once an Admin approves it.
 *
 * They are combined at READ time and are never written into a shared column.
 * A stored total would need updating by three independent writers — ORION
 * ingestion, hint unlocks, and Admin approvals — all of which can happen
 * concurrently. Deriving it means there is nothing to get out of step.
 *
 * `Team.score` is deliberately untouched: it remains the sum of APPROVED
 * evaluations only, feeding the dashboard rank widget and the db:doctor
 * invariant. Redefining it here would silently change both.
 */

export const LEVEL_3 = 3 as const;

export interface Level3TeamScore {
  /** Sum of verified discoveries. `null` when the squad has discovered nothing. */
  discoveryPoints: number | null;
  /** Sum of hint penalties charged. Always a number; 0 when none. */
  penaltyPoints: number;
  /**
   * discoveries − penalties, clamped at zero. `null` only when the squad has no
   * discoveries AND no penalties, i.e. has genuinely not started — which is what
   * lets the leaderboard show an em dash rather than a zero it did not earn.
   */
  automaticScore: number | null;
  verifiedBugCount: number;
  hintsUsed: number;
}

/**
 * Automatic Level 3 standing for one squad.
 *
 * Two aggregates, no per-bug round trips — this runs on every render of the
 * Level 3 page for every participant, so it must not scale with the bug count.
 */
export async function getTeamAutomaticScore(teamId: string): Promise<Level3TeamScore> {
  const [discoveries, penalties] = await Promise.all([
    prisma.level3Discovery.aggregate({
      where: { teamId },
      _sum: { awardedPoints: true },
      _count: { _all: true },
    }),
    prisma.level3Penalty.aggregate({
      where: { teamId },
      _sum: { points: true },
      _count: { _all: true },
    }),
  ]);

  const discoveryCount = discoveries._count._all;
  const penaltyCount = penalties._count._all;
  const discoveryPoints = discoveryCount === 0 ? null : (discoveries._sum.awardedPoints ?? 0);
  const penaltyPoints = penalties._sum.points ?? 0;

  // A squad that spent a hint has started, even with nothing found yet — so it is
  // scored (at 0 after the clamp), not unscored.
  const started = discoveryCount > 0 || penaltyCount > 0;

  return {
    discoveryPoints,
    penaltyPoints,
    automaticScore: started ? combineLevel3Score(discoveryPoints ?? 0, penaltyPoints, 0) : null,
    verifiedBugCount: discoveryCount,
    hintsUsed: penaltyCount,
  };
}

export interface Level3BugProgress {
  id: string;
  code: string;
  title: string;
  category: string;
  difficulty: string;
  points: number;
  discovered: boolean;
  discoveredAt: string | null;
  /** Hint numbers this squad has already paid for, ascending. */
  unlockedHints: number[];
  /** Hint numbers that exist for this bug at all, ascending. */
  availableHints: number[];
}

export interface Level3StationProgress {
  id: string;
  name: string;
  description: string | null;
  challengeUrl: string | null;
  challengeLabel: string | null;
  sortOrder: number;
  bugs: Level3BugProgress[];
  discoveredCount: number;
  totalPoints: number;
  earnedPoints: number;
}

export interface Level3Progress {
  stations: Level3StationProgress[];
  /** Active bugs with no station, so a mis-configured catalogue is still visible. */
  unassignedBugs: Level3BugProgress[];
  discoveryPoints: number | null;
  penaltyPoints: number;
  automaticScore: number | null;
  verifiedBugCount: number;
  totalActiveBugs: number;
  /** Summed from active bug records — never a hardcoded ceiling. */
  maxAutomaticPoints: number;
  hintsUsed: number;
}

/**
 * Everything the participant Level 3 page needs, for ONE squad.
 *
 * Four queries regardless of how many stations, bugs or squads exist. It is
 * deliberately scoped to a single team: fetching all discoveries and filtering in
 * memory would put every squad's progress into every participant's request, which
 * is both an N+1 waiting to happen and a privacy leak.
 *
 * PRIVACY: `flagHash` is never selected, and hint CONTENT is never included —
 * only which hint numbers exist and which this squad has paid for. Content is
 * served separately, after the penalty is recorded.
 */
export async function getTeamLevel3Progress(teamId: string): Promise<Level3Progress> {
  const [stations, bugs, discoveries, penalties] = await Promise.all([
    prisma.level3Station.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        challengeUrl: true,
        challengeLabel: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.level3Bug.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        title: true,
        category: true,
        difficulty: true,
        points: true,
        stationId: true,
        sortOrder: true,
        // Hint numbers only. Content is withheld until it is paid for.
        hints: { select: { hintNumber: true }, orderBy: { hintNumber: 'asc' } },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    }),
    prisma.level3Discovery.findMany({
      where: { teamId },
      select: { bugId: true, awardedPoints: true, discoveredAt: true },
    }),
    prisma.level3Penalty.findMany({
      where: { teamId },
      select: { bugId: true, hintNumber: true, points: true },
    }),
  ]);

  const discoveryByBug = new Map(discoveries.map((d) => [d.bugId, d]));
  const hintsByBug = new Map<string, number[]>();
  for (const p of penalties) {
    hintsByBug.set(p.bugId, [...(hintsByBug.get(p.bugId) ?? []), p.hintNumber].sort());
  }

  function toProgress(bug: (typeof bugs)[number]): Level3BugProgress {
    const hit = discoveryByBug.get(bug.id);
    return {
      id: bug.id,
      code: bug.code,
      title: bug.title,
      category: bug.category,
      difficulty: bug.difficulty,
      points: bug.points,
      discovered: Boolean(hit),
      discoveredAt: hit ? hit.discoveredAt.toISOString() : null,
      unlockedHints: hintsByBug.get(bug.id) ?? [],
      availableHints: bug.hints.map((h) => h.hintNumber),
    };
  }

  const stationProgress: Level3StationProgress[] = stations.map((station) => {
    const stationBugs = bugs.filter((b) => b.stationId === station.id).map(toProgress);
    return {
      id: station.id,
      name: station.name,
      description: station.description,
      challengeUrl: station.challengeUrl,
      challengeLabel: station.challengeLabel,
      sortOrder: station.sortOrder,
      bugs: stationBugs,
      discoveredCount: stationBugs.filter((b) => b.discovered).length,
      totalPoints: stationBugs.reduce((sum, b) => sum + b.points, 0),
      earnedPoints: stationBugs.reduce((sum, b) => sum + (b.discovered ? b.points : 0), 0),
    };
  });

  const unassignedBugs = bugs.filter((b) => b.stationId === null).map(toProgress);

  // Summed from the discovery rows, not the bug table: a squad keeps what it was
  // awarded even if a bug is later retired or repriced.
  const discoveryPoints = discoveries.reduce((sum, d) => sum + d.awardedPoints, 0);
  const penaltyPoints = penalties.reduce((sum, p) => sum + p.points, 0);
  const started = discoveries.length > 0 || penalties.length > 0;

  return {
    stations: stationProgress,
    unassignedBugs,
    discoveryPoints: discoveries.length === 0 ? null : discoveryPoints,
    penaltyPoints,
    automaticScore: started ? combineLevel3Score(discoveryPoints, penaltyPoints, 0) : null,
    verifiedBugCount: discoveries.length,
    totalActiveBugs: bugs.length,
    maxAutomaticPoints: bugs.reduce((sum, b) => sum + b.points, 0),
    hintsUsed: penalties.length,
  };
}
