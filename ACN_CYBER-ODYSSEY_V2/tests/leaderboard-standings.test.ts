/**
 * Leaderboard standings — per-level scores, ranking, and the null-vs-zero rule.
 *
 * The distinction this suite exists to protect:
 *
 *   null → the level has no official score yet   (renders as an em dash)
 *   0    → the squad was scored and earned zero  (renders as "0 PTS")
 *
 * Collapsing those two would misreport an unmarked squad as having scored
 * nothing, and would let it appear tied with a squad that genuinely did.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';
import { APPROVAL_STATUS } from '@/lib/evaluation/approval';
import {
  getLeaderboardStandings,
  assignRanks,
  type LeaderboardStandingRow,
} from '@/lib/leaderboard/standings';

let seq = 0;

async function makeParticipant(tag: string) {
  seq++;
  return prisma.user.create({
    data: {
      email: `lb_${tag}_${seq}@leaderboard.test`,
      username: `lb_${tag}_${seq}`,
      passwordHash: await hashPassword('LeaderboardTest!2026'),
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    },
  });
}

async function makeEvaluator() {
  seq++;
  return prisma.user.create({
    data: {
      email: `lb_eval_${seq}@leaderboard.test`,
      username: `lb_eval_${seq}`,
      passwordHash: await hashPassword('LeaderboardTest!2026'),
      role: 'EVALUATOR',
      status: 'ACTIVE',
    },
  });
}

async function makeSquad(name: string) {
  const head = await makeParticipant('head');
  const team = await prisma.team.create({
    data: {
      name,
      code: generateTeamCode(),
      passwordHash: await hashPassword('SquadPass1'),
      creatorId: head.id,
    },
    select: { id: true, name: true },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: head.id, slot: 1, role: 'CREATOR' },
  });
  return { ...team, head };
}

/** Records an evaluation directly, so each test controls the exact official state. */
async function recordEvaluation(opts: {
  teamId: string;
  userId: string;
  evaluatorId: string;
  level: number;
  score: number;
  approvalStatus: string;
  status?: string;
}) {
  const submission = await prisma.submission.create({
    data: {
      teamId: opts.teamId,
      userId: opts.userId,
      level: opts.level,
      status: 'SUBMITTED',
    },
  });
  return prisma.evaluation.create({
    data: {
      submissionId: submission.id,
      evaluatorId: opts.evaluatorId,
      teamId: opts.teamId,
      level: opts.level,
      score: opts.score,
      status: opts.status ?? 'EVALUATED',
      approvalStatus: opts.approvalStatus,
    },
  });
}

/**
 * Records an official Level 1 result directly.
 *
 * Level 1 does NOT go through the evaluation pipeline — `EVALUABLE_LEVELS` is
 * `[2, 3]` and both evaluator write paths refuse a Level 1 submission. Its score
 * comes from `Level1Result` rows written by the HMAC-authenticated integration
 * bridge, priced from the portal's own `Level1Challenge` catalogue.
 *
 * These tests previously recorded a Level 1 `Evaluation` with
 * `status = 'EVALUATED'`, which the leaderboard used to read. That path could
 * never occur in production — nothing in the application creates such a row —
 * so the tests were asserting against a state only a test could produce. The
 * INTENT they encoded is unchanged and still asserted below: a Level 1 score is
 * official without Admin approval. Only the mechanism has moved.
 */
async function recordLevel1Result(opts: { teamId: string; points: number; tag: string }) {
  const challenge = await prisma.level1Challenge.create({
    data: {
      code: `LBT_${opts.tag}`,
      externalRef: `lbt_${opts.tag}`,
      title: `Leaderboard fixture ${opts.tag}`,
      track: 'A',
      points: opts.points,
    },
  });
  return prisma.level1Result.create({
    data: { teamId: opts.teamId, challengeId: challenge.id, awardedPoints: opts.points },
  });
}

async function reset() {
  await prisma.auditLog.deleteMany({});
  await prisma.level1Result.deleteMany({});
  await prisma.level1Penalty.deleteMany({});
  await prisma.level1Challenge.deleteMany({ where: { externalRef: { startsWith: 'lbt_' } } });
  await prisma.evaluation.deleteMany({});
  await prisma.submissionFile.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.teamMember.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.user.deleteMany({});
}

function row(partial: Partial<LeaderboardStandingRow>): LeaderboardStandingRow {
  // Resolve the total FIRST, then derive `hasOfficialScore` from the resolved
  // value. Deriving it from `partial.totalScore` would read `undefined` when the
  // caller omits the field, and `undefined !== null` is true — which would mark
  // an unscored fixture as scored.
  const totalScore = partial.totalScore ?? null;

  return {
    id: partial.id ?? 'id',
    name: partial.name ?? 'SQUAD',
    levelScores: partial.levelScores ?? { 1: null, 2: null, 3: null },
    totalScore,
    hasOfficialScore: partial.hasOfficialScore ?? totalScore !== null,
    rank: null,
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('Leaderboard standings', () => {
  beforeEach(async () => {
    seq = 0;
    await reset();
  });

  afterAll(async () => {
    await reset();
  });

  // =========================================================================
  // NULL IS NOT ZERO
  // =========================================================================
  describe('An unscored level is distinct from a scored zero', () => {
    it('reports null for every level when a squad has no evaluations', async () => {
      const team = await makeSquad('UNSCORED SQUAD');

      const { rows } = await getLeaderboardStandings();
      const entry = rows.find((r) => r.id === team.id)!;

      expect(entry.levelScores[1]).toBeNull();
      expect(entry.levelScores[2]).toBeNull();
      expect(entry.levelScores[3]).toBeNull();
      expect(entry.totalScore).toBeNull();
      expect(entry.hasOfficialScore).toBe(false);
      // Listed, but not ranked.
      expect(entry.rank).toBeNull();
    });

    it('reports 0 — not null — for a squad genuinely scored zero', async () => {
      const evaluator = await makeEvaluator();
      const team = await makeSquad('ZERO SQUAD');

      await recordEvaluation({
        teamId: team.id,
        userId: team.head.id,
        evaluatorId: evaluator.id,
        level: 2,
        score: 0,
        approvalStatus: APPROVAL_STATUS.APPROVED,
      });

      const { rows } = await getLeaderboardStandings();
      const entry = rows.find((r) => r.id === team.id)!;

      expect(entry.levelScores[2]).toBe(0);
      expect(entry.levelScores[2]).not.toBeNull();
      expect(entry.totalScore).toBe(0);
      // A scored zero IS an official result, so the squad is ranked.
      expect(entry.hasOfficialScore).toBe(true);
      expect(entry.rank).toBe(1);
    });

    it('ranks a squad scored zero above a squad that has not been scored', async () => {
      const evaluator = await makeEvaluator();
      const zeroTeam = await makeSquad('SCORED ZERO');
      const unscoredTeam = await makeSquad('NOT SCORED');

      await recordEvaluation({
        teamId: zeroTeam.id,
        userId: zeroTeam.head.id,
        evaluatorId: evaluator.id,
        level: 2,
        score: 0,
        approvalStatus: APPROVAL_STATUS.APPROVED,
      });

      const { rows } = await getLeaderboardStandings();

      const zero = rows.find((r) => r.id === zeroTeam.id)!;
      const unscored = rows.find((r) => r.id === unscoredTeam.id)!;

      expect(zero.rank).toBe(1);
      expect(unscored.rank).toBeNull();
      // The ranked squad is ordered ahead of the unranked one.
      expect(rows.indexOf(zero)).toBeLessThan(rows.indexOf(unscored));
    });
  });

  // =========================================================================
  // THE APPROVAL GATE GOVERNS WHAT APPEARS
  // =========================================================================
  describe('Only officially available scores appear', () => {
    it('excludes a pending Level 2 evaluation', async () => {
      const evaluator = await makeEvaluator();
      const team = await makeSquad('PENDING SQUAD');

      await recordEvaluation({
        teamId: team.id,
        userId: team.head.id,
        evaluatorId: evaluator.id,
        level: 2,
        score: 82,
        approvalStatus: APPROVAL_STATUS.PENDING_APPROVAL,
      });

      const { rows } = await getLeaderboardStandings();
      const entry = rows.find((r) => r.id === team.id)!;

      expect(entry.levelScores[2]).toBeNull();
      expect(entry.totalScore).toBeNull();
      expect(entry.rank).toBeNull();
    });

    it('excludes a rejected Level 2 evaluation', async () => {
      const evaluator = await makeEvaluator();
      const team = await makeSquad('REJECTED SQUAD');

      await recordEvaluation({
        teamId: team.id,
        userId: team.head.id,
        evaluatorId: evaluator.id,
        level: 2,
        score: 91,
        approvalStatus: APPROVAL_STATUS.REJECTED,
      });

      const { rows } = await getLeaderboardStandings();
      const entry = rows.find((r) => r.id === team.id)!;

      expect(entry.levelScores[2]).toBeNull();
      expect(entry.totalScore).toBeNull();
    });

    it('includes an approved Level 2 evaluation', async () => {
      const evaluator = await makeEvaluator();
      const team = await makeSquad('APPROVED SQUAD');

      await recordEvaluation({
        teamId: team.id,
        userId: team.head.id,
        evaluatorId: evaluator.id,
        level: 2,
        score: 82,
        approvalStatus: APPROVAL_STATUS.APPROVED,
      });

      const { rows } = await getLeaderboardStandings();
      const entry = rows.find((r) => r.id === team.id)!;

      expect(entry.levelScores[2]).toBe(82);
      expect(entry.totalScore).toBe(82);
      expect(entry.rank).toBe(1);
    });

    it('includes a completed Level 1 score without requiring Admin approval', async () => {
      const team = await makeSquad('LEVEL ONE SQUAD');

      // Level 1 does not go through the approval gate: the integration bridge
      // verified and priced the result, so there is nothing for a human to ratify.
      await recordLevel1Result({ teamId: team.id, points: 45, tag: 'noapproval' });

      const { rows } = await getLeaderboardStandings();
      const entry = rows.find((r) => r.id === team.id)!;

      expect(entry.levelScores[1]).toBe(45);
      expect(entry.levelScores[2]).toBeNull();
      expect(entry.totalScore).toBe(45);
      expect(entry.rank).toBe(1);
    });

    it('totals only the levels that are officially available', async () => {
      const evaluator = await makeEvaluator();
      const team = await makeSquad('PARTIAL SQUAD');

      // L1 official (bridge-verified), L2 approved, L3 pending.
      await recordLevel1Result({ teamId: team.id, points: 40, tag: 'partial' });
      await recordEvaluation({
        teamId: team.id,
        userId: team.head.id,
        evaluatorId: evaluator.id,
        level: 2,
        score: 82,
        approvalStatus: APPROVAL_STATUS.APPROVED,
      });
      await recordEvaluation({
        teamId: team.id,
        userId: team.head.id,
        evaluatorId: evaluator.id,
        level: 3,
        score: 70,
        approvalStatus: APPROVAL_STATUS.PENDING_APPROVAL,
      });

      const { rows } = await getLeaderboardStandings();
      const entry = rows.find((r) => r.id === team.id)!;

      expect(entry.levelScores[1]).toBe(40);
      expect(entry.levelScores[2]).toBe(82);
      expect(entry.levelScores[3]).toBeNull();
      expect(entry.totalScore).toBe(122);
    });
  });

  // =========================================================================
  // RANKING
  // =========================================================================
  describe('Ranking', () => {
    it('orders by total score descending', () => {
      const ranked = assignRanks([
        row({ id: 'a', name: 'A', totalScore: 50 }),
        row({ id: 'b', name: 'B', totalScore: 90 }),
        row({ id: 'c', name: 'C', totalScore: 70 }),
      ]);

      expect(ranked.map((r) => r.id)).toEqual(['b', 'c', 'a']);
      expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    });

    it('gives tied squads the same rank and skips the next (1, 2, 2, 4)', () => {
      const ranked = assignRanks([
        row({ id: 'a', name: 'A', totalScore: 90, updatedAt: '2026-01-01T00:00:01.000Z' }),
        row({ id: 'b', name: 'B', totalScore: 70, updatedAt: '2026-01-01T00:00:02.000Z' }),
        row({ id: 'c', name: 'C', totalScore: 70, updatedAt: '2026-01-01T00:00:03.000Z' }),
        row({ id: 'd', name: 'D', totalScore: 50, updatedAt: '2026-01-01T00:00:04.000Z' }),
      ]);

      expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    });

    it('places every unscored squad after every ranked squad, unranked', () => {
      const ranked = assignRanks([
        row({ id: 'unscored1', name: 'U1' }),
        row({ id: 'scored', name: 'S', totalScore: 10 }),
        row({ id: 'unscored2', name: 'U2' }),
      ]);

      expect(ranked[0]!.id).toBe('scored');
      expect(ranked[0]!.rank).toBe(1);
      expect(ranked[1]!.rank).toBeNull();
      expect(ranked[2]!.rank).toBeNull();
    });

    it('is deterministic for identical totals', () => {
      const input = [
        row({ id: 'a', name: 'A', totalScore: 70, updatedAt: '2026-01-01T00:00:02.000Z' }),
        row({ id: 'b', name: 'B', totalScore: 70, updatedAt: '2026-01-01T00:00:01.000Z' }),
      ];

      const first = assignRanks(input).map((r) => r.id);
      const second = assignRanks(input).map((r) => r.id);

      expect(first).toEqual(second);
      // The squad that reached the total first is listed first.
      expect(first[0]).toBe('b');
    });

    it('leaves the podium entirely open when no squad has been scored', async () => {
      await makeSquad('OPEN A');
      await makeSquad('OPEN B');

      const { rows, scoredTeamCount, totalTeamCount } = await getLeaderboardStandings();

      expect(totalTeamCount).toBe(2);
      expect(scoredTeamCount).toBe(0);
      // No ranked squads means the UI renders three OPEN podium slots.
      expect(rows.filter((r) => r.rank !== null)).toHaveLength(0);
    });

    it('recalculates ranking as each level becomes official', async () => {
      const evaluator = await makeEvaluator();
      const alpha = await makeSquad('ALPHA');
      const bravo = await makeSquad('BRAVO');

      // Bravo leads on Level 1.
      await recordLevel1Result({ teamId: bravo.id, points: 60, tag: 'rank_bravo' });
      await recordLevel1Result({ teamId: alpha.id, points: 40, tag: 'rank_alpha' });

      let standings = await getLeaderboardStandings();
      expect(standings.rows.find((r) => r.id === bravo.id)!.rank).toBe(1);
      expect(standings.rows.find((r) => r.id === alpha.id)!.rank).toBe(2);

      // Alpha's Level 2 is approved and overtakes.
      await recordEvaluation({
        teamId: alpha.id,
        userId: alpha.head.id,
        evaluatorId: evaluator.id,
        level: 2,
        score: 90,
        approvalStatus: APPROVAL_STATUS.APPROVED,
      });

      standings = await getLeaderboardStandings();
      const alphaRow = standings.rows.find((r) => r.id === alpha.id)!;
      const bravoRow = standings.rows.find((r) => r.id === bravo.id)!;

      expect(alphaRow.totalScore).toBe(130);
      expect(alphaRow.rank).toBe(1);
      expect(bravoRow.rank).toBe(2);
      // Bravo's Level 2 remains unscored, not zero.
      expect(bravoRow.levelScores[2]).toBeNull();
    });
  });

  // =========================================================================
  // PRIVACY
  // =========================================================================
  describe('Privacy', () => {
    it('never exposes the squad join code or password hash', async () => {
      const team = await makeSquad('PRIVACY SQUAD');
      const stored = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });

      const { rows } = await getLeaderboardStandings();
      const serialised = JSON.stringify(rows);

      expect(serialised).not.toContain(stored.code);
      expect(serialised).not.toContain(stored.passwordHash);
      // And the row shape carries no membership or status fields at all.
      const entry = rows.find((r) => r.id === team.id)!;
      expect(entry).not.toHaveProperty('membersCount');
      expect(entry).not.toHaveProperty('status');
    });
  });
});
