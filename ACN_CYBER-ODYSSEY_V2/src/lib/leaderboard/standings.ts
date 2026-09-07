import 'server-only';
import { prisma } from '@/lib/prisma';
import { APPROVAL_STATUS } from '@/lib/evaluation/approval';
import { LEADERBOARD_LEVELS, type LeaderboardLevel } from '@/lib/leaderboard/levels';
import { combineLevel3Score } from '@/lib/level3/scoring-policy';
import { combineLevel1Score } from '@/lib/level1/scoring-policy';

/**
 * Official leaderboard standings — per-level breakdown and ranking.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS AN "OFFICIAL" LEVEL SCORE
 * ---------------------------------------------------------------------------
 * Level 1 — every `Level1Result` the squad holds, MINUS its `Level1Penalty`
 *           rows. Automatically scored; no human ratifies it. See below.
 * Level 2 — an evaluation with `approvalStatus = 'APPROVED'`.
 * Level 3 — an evaluation with `approvalStatus = 'APPROVED'`, PLUS every
 *           `Level3Discovery` the squad holds.
 *
 * ---------------------------------------------------------------------------
 * WHY LEVEL 1 IS NOT APPROVED BY AN ADMIN (Phase 1 decision)
 * ---------------------------------------------------------------------------
 * Level 1 has no evaluation stage — `EVALUABLE_LEVELS` in lib/auth/permissions.ts
 * is `[2, 3]`, and both evaluator write paths refuse a Level 1 submission. Before
 * Phase 1 this module nevertheless read Level 1 from `Evaluation` rows with
 * `status = 'EVALUATED'`, which the application will never create: the Level 1
 * column could only ever render an em dash, and `FINAL = L1 + L2 + L3` was
 * structurally impossible.
 *
 * It now reads the rows the integration bridge writes. That is the same treatment
 * Level 3 discoveries already get, for the same reason stated there: the server
 * established the finding was real, so there is nothing for a human to ratify.
 * A Level 1 result is only ever created by an HMAC-authenticated server-to-server
 * event, priced from this portal's own catalogue — an Admin approving it would be
 * rubber-stamping arithmetic, and would delay a score the squad has already
 * demonstrably earned.
 *
 * The Level 2 approval workflow is untouched.
 *
 * Levels 1 and 3 are the composite levels. Level 3 carries two independently-earned
 * components:
 *
 *   automatic  server-verified bug discoveries. Official on creation — the
 *              server established the finding was real, so no human ratifies it.
 *   report     the evaluator's report score, and only once an Admin approves it.
 *
 * They are summed here, at read time, and nowhere else. A pending or rejected
 * report contributes nothing while the squad's bug points continue to count, so
 * a squad is never held out of the rankings waiting on an approval it does not
 * control.
 *
 * The Evaluator → Pending Approval → Admin Approval workflow is unchanged; this
 * module only READS its outcome.
 *
 * ---------------------------------------------------------------------------
 * NULL IS NOT ZERO
 * ---------------------------------------------------------------------------
 * A level score is `number | null`, and the distinction is load-bearing:
 *
 *   null → no official score yet. Renders as an em dash.
 *   0    → the squad was scored and genuinely earned zero. Renders as "0 PTS".
 *
 * Collapsing these would tell a squad that scored 0 the same thing it tells a
 * squad that has not been marked, and would let an unscored squad appear to be
 * tied with a squad that actually earned nothing. Every value in this module is
 * therefore nullable all the way to the UI — never defaulted to 0 en route.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `Team.score`
 * ---------------------------------------------------------------------------
 * `Team.score` is a single aggregate with no level breakdown, so it cannot
 * populate per-level columns and cannot distinguish "0 across the board" from
 * "nothing scored yet". The standings are therefore computed from `Evaluation`
 * rows, which are the authoritative record either way.
 *
 * `Team.score` is deliberately left untouched and continues to serve the
 * dashboard rank widget and the `db:doctor` integrity invariant.
 */

export { LEADERBOARD_LEVELS, type LeaderboardLevel };

export interface LeaderboardStandingRow {
  id: string;
  name: string;
  /** Official score per level. `null` means "not scored yet", never "zero". */
  levelScores: Record<LeaderboardLevel, number | null>;
  /** Unadjusted base score per level */
  levelBaseScores?: Record<LeaderboardLevel, number | null>;
  /** Approved additional adjustment points per level */
  levelAdjustmentScores?: Record<LeaderboardLevel, number>;
  /** Sum of the levels that have an official score; `null` when none do. */
  totalScore: number | null;
  /** True once at least one level carries an official score. */
  hasOfficialScore: boolean;
  /**
   * Competition rank, or `null` for a squad with no official score yet — such a
   * squad is listed but not ranked, so it cannot appear to be "last" on the
   * strength of having simply not been marked.
   */
  rank: number | null;
  updatedAt: string;
  createdAt: string;
}

export interface LeaderboardStandings {
  rows: LeaderboardStandingRow[];
  /** How many squads currently hold at least one official score. */
  scoredTeamCount: number;
  totalTeamCount: number;
}

/**
 * Prisma filter describing an evaluation whose score is officially publishable
 * for a given level.
 *
 * Level 1 is absent from this rule entirely: it has no evaluation stage, and its
 * score is derived from `Level1Result` / `Level1Penalty` instead. See the module
 * note above. Passing level 1 here would silently match nothing.
 */
function officialScoreFilter(level: number) {
  return { level, approvalStatus: APPROVAL_STATUS.APPROVED };
}

/**
 * Builds the official standings straight from current database state.
 *
 * No score is cached, hardcoded, or manually editable: approving an evaluation
 * changes what this returns on the next read, which is what makes the board
 * update by itself.
 */
export async function getLeaderboardStandings(): Promise<LeaderboardStandings> {
  // One query for the squads, one grouped aggregate per evaluated level, plus one
  // per automatic component, plus approved score adjustments.
  const [
    teams,
    perLevel,
    level1Results,
    level1Penalties,
    level3Automatic,
    level3Penalties,
    approvedAdjustments,
  ] = await Promise.all([
    prisma.team.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, updatedAt: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }],
    }),
    Promise.all(
      LEADERBOARD_LEVELS.map((level) =>
        // Level 1 has no evaluation stage, so there is nothing to aggregate for
        // it here. Issuing the query anyway would be a guaranteed-empty round
        // trip on the hottest read path in the portal.
        level === 1
          ? Promise.resolve([])
          : prisma.evaluation.groupBy({
              by: ['teamId'],
              where: officialScoreFilter(level),
              _sum: { score: true },
            }),
      ),
    ),
    // Level 1 automatic points. Every result row is official the moment it
    // exists — the bridge verified and priced it — so, as with Level 3
    // discoveries, there is no approval state to filter on.
    prisma.level1Result.groupBy({
      by: ['teamId'],
      _sum: { awardedPoints: true },
    }),
    // Level 1 hint deductions, grouped so the cost stays one query regardless
    // of squad count.
    prisma.level1Penalty.groupBy({
      by: ['teamId'],
      _sum: { points: true },
    }),
    // Level 3 automatic bug points. Every discovery row is official the moment it
    // exists — ORION verified it — so unlike the report score there is no approval
    // state to filter on here.
    prisma.level3Discovery.groupBy({
      by: ['teamId'],
      _sum: { awardedPoints: true },
    }),
    // Hint penalties. Grouped rather than joined so the cost stays one query
    // regardless of squad count.
    prisma.level3Penalty.groupBy({
      by: ['teamId'],
      _sum: { points: true },
    }),
    // Approved additional points adjustments (Levels 1, 2, 3)
    prisma.scoreAdjustment.groupBy({
      by: ['teamId', 'level'],
      where: { status: 'APPROVED' },
      _sum: { points: true },
    }),
  ]);

  // teamId -> score, one map per level. A missing key means "not scored yet";
  // a present key with 0 means "scored zero".
  const scoreByLevel = new Map<LeaderboardLevel, Map<string, number>>();
  LEADERBOARD_LEVELS.forEach((level, index) => {
    const grouped = perLevel[index] ?? [];
    scoreByLevel.set(level, new Map(grouped.map((g) => [g.teamId, g._sum.score ?? 0])));
  });

  // Approved adjustments grouped by level
  const adjustmentsByLevel = new Map<LeaderboardLevel, Map<string, number>>();
  for (const lvl of LEADERBOARD_LEVELS) {
    adjustmentsByLevel.set(lvl, new Map());
  }
  for (const adj of approvedAdjustments) {
    const lvl = adj.level as LeaderboardLevel;
    if (adjustmentsByLevel.has(lvl)) {
      adjustmentsByLevel.get(lvl)!.set(adj.teamId, adj._sum.points ?? 0);
    }
  }

  // Fold the automatic components into Level 1.
  //
  //     Level 1 = max(0, results − hint penalties)
  //
  // Presence is a UNION of the two: a squad with results is scored, and so is a
  // squad that has only spent hints (scored, at 0). Level 1 reads `—` only when a
  // squad has neither, which keeps the null-vs-zero rule intact for a squad that
  // entered Level 1 and genuinely earned nothing.
  const level1 = scoreByLevel.get(1);
  if (level1) {
    const resultByTeam = new Map(level1Results.map((r) => [r.teamId, r._sum.awardedPoints ?? 0]));
    const penaltyByTeam = new Map(level1Penalties.map((p) => [p.teamId, p._sum.points ?? 0]));

    for (const teamId of new Set<string>([...resultByTeam.keys(), ...penaltyByTeam.keys()])) {
      level1.set(
        teamId,
        combineLevel1Score(resultByTeam.get(teamId) ?? 0, penaltyByTeam.get(teamId) ?? 0),
      );
    }
  }

  // Fold the automatic components into Level 3.
  //
  // The three parts are combined only here, at read time — see
  // lib/level3/scoring.ts for why they are never merged at rest:
  //
  //     Level 3 = max(0, discoveries − hint penalties + approved report)
  //
  // Presence is a UNION across all three. A squad with bug points but no approved
  // report is scored; so is a squad with an approved report and no bug points; so
  // is a squad that has only spent hints (it is scored, at 0). Level 3 reads `—`
  // only when a squad has done none of the three, which keeps the null-vs-zero
  // rule intact for a squad that genuinely earned nothing.
  const level3 = scoreByLevel.get(3);
  if (level3) {
    const penaltyByTeam = new Map(level3Penalties.map((p) => [p.teamId, p._sum.points ?? 0]));
    const automaticByTeam = new Map(
      level3Automatic.map((d) => [d.teamId, d._sum.awardedPoints ?? 0]),
    );

    const touched = new Set<string>([
      ...automaticByTeam.keys(),
      ...penaltyByTeam.keys(),
      ...level3.keys(),
    ]);

    for (const teamId of touched) {
      const discoveries = automaticByTeam.get(teamId) ?? 0;
      const penalties = penaltyByTeam.get(teamId) ?? 0;
      const approvedReport = level3.get(teamId) ?? 0;
      level3.set(teamId, combineLevel3Score(discoveries, penalties, approvedReport));
    }
  }

  const unranked: LeaderboardStandingRow[] = teams.map((team) => {
    const levelScores = {} as Record<LeaderboardLevel, number | null>;
    const levelBaseScores = {} as Record<LeaderboardLevel, number | null>;
    const levelAdjustmentScores = {} as Record<LeaderboardLevel, number>;
    let total: number | null = null;

    for (const level of LEADERBOARD_LEVELS) {
      const map = scoreByLevel.get(level);
      // `has` before `get`: a stored 0 must survive as 0, not become null.
      const scored = map?.has(team.id) ?? false;
      const baseValue = scored ? (map?.get(team.id) ?? 0) : null;
      levelBaseScores[level] = baseValue;

      const adjPoints = adjustmentsByLevel.get(level)?.get(team.id) ?? 0;
      levelAdjustmentScores[level] = adjPoints;

      if (baseValue !== null || adjPoints > 0) {
        const finalLevelVal = (baseValue ?? 0) + adjPoints;
        levelScores[level] = finalLevelVal;
        total = (total ?? 0) + finalLevelVal;
      } else {
        levelScores[level] = null;
      }
    }

    return {
      id: team.id,
      name: team.name,
      levelScores,
      levelBaseScores,
      levelAdjustmentScores,
      totalScore: total,
      hasOfficialScore: total !== null,
      rank: null,
      updatedAt: team.updatedAt.toISOString(),
      createdAt: team.createdAt.toISOString(),
    };
  });

  return {
    rows: assignRanks(unranked),
    scoredTeamCount: unranked.filter((r) => r.hasOfficialScore).length,
    totalTeamCount: unranked.length,
  };
}

/**
 * Orders squads and assigns competition ranks.
 *
 * Only squads with an official score are ranked. Unscored squads keep
 * `rank: null` and are listed afterwards in registration order — being unmarked
 * is not a competitive result and should not read as one.
 *
 * Ties share a rank and the following rank skips accordingly (1, 2, 2, 4), which
 * is standard competition ranking: two squads genuinely level on points are
 * jointly second, and nobody is third.
 *
 * Exported for direct unit testing of the ordering rules.
 */
export function assignRanks(rows: LeaderboardStandingRow[]): LeaderboardStandingRow[] {
  const scored = rows
    .filter((r) => r.hasOfficialScore)
    .sort((a, b) => {
      const diff = (b.totalScore ?? 0) - (a.totalScore ?? 0);
      if (diff !== 0) return diff;
      // Deterministic tie-break so the order is stable between renders: the
      // squad that reached its total first is listed first.
      const byTime = a.updatedAt.localeCompare(b.updatedAt);
      if (byTime !== 0) return byTime;
      return a.name.localeCompare(b.name);
    });

  let lastScore: number | null = null;
  let lastRank = 0;

  const ranked = scored.map((row, index) => {
    if (lastScore !== null && row.totalScore === lastScore) {
      // Equal totals share the previous rank.
      return { ...row, rank: lastRank };
    }
    lastScore = row.totalScore;
    lastRank = index + 1;
    return { ...row, rank: lastRank };
  });

  const unscored = rows
    .filter((r) => !r.hasOfficialScore)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));

  return [...ranked, ...unscored];
}
