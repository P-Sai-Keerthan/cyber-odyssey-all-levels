import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { recomputeTeamScore } from '@/lib/evaluation/approval';
import { computeTeamOfficialTotal } from '@/lib/leaderboard/team-total';
import { getLeaderboardStandings } from '@/lib/leaderboard/standings';
import { resetEvaluationCriteria } from './helpers/evaluation-criteria';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

/**
 * `Team.score` and the leaderboard must mean the same thing.
 *
 * THE BUG THIS PINS
 * -----------------
 * `recomputeTeamScore` summed APPROVED evaluations and nothing else, while the
 * leaderboard also counted Level 1 automatic results (minus hint penalties),
 * Level 3 discoveries (minus theirs) and approved score adjustments. `Team.score`
 * is what the participant dashboard prints as "PTS" and what its rank widget
 * counts against, so a squad with Level 1 points saw 0 on their own dashboard
 * while the leaderboard showed the real figure.
 *
 * Worse, because the recompute OVERWRITES the column, approving a Level 2
 * evaluation erased any Level 1 points already recorded there — a squad's total
 * went DOWN when their report was approved.
 */
describe('Team.score agrees with the official leaderboard total', () => {
  let teamId: string;
  let userId: string;
  let challengeIds: string[] = [];

  beforeEach(async () => {
    await resetEvaluationCriteria();
    await prisma.scoreAdjustment.deleteMany({});
    await prisma.level1Result.deleteMany({});
    await prisma.level1Penalty.deleteMany({});
    await prisma.level3Discovery.deleteMany({});
    await prisma.level3Penalty.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.user.deleteMany({});

    const tag = crypto.randomBytes(4).toString('hex');
    const passwordHash = await hashPassword('Password@1234');

    const user = await prisma.user.create({
      data: {
        email: `score_${tag}@example.com`,
        username: `score_${tag}`,
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    const team = await prisma.team.create({
      data: {
        name: `Score Squad ${tag}`,
        code: `SC-${tag.toUpperCase()}`,
        passwordHash,
        creatorId: user.id,
        externalRef: `co_score_${tag}`,
        score: 0,
      },
    });
    teamId = team.id;
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: user.id, slot: 1, role: 'HEAD' },
    });

    // Two Level 1 catalogue questions to award from.
    challengeIds = [];
    for (const [i, code] of ['TSC1', 'TSC2'].entries()) {
      const c = await prisma.level1Challenge.upsert({
        where: { code },
        update: { points: 10 * (i + 1), isActive: true },
        create: {
          code,
          externalRef: `ref_${code}`,
          title: `Test challenge ${code}`,
          track: 'A',
          points: 10 * (i + 1),
          isActive: true,
          sortOrder: 90 + i,
        },
      });
      challengeIds.push(c.id);
    }
  });

  it('counts Level 1 results in the stored score', async () => {
    await prisma.level1Result.create({
      data: { teamId, challengeId: challengeIds[0]!, awardedPoints: 10 },
    });
    await prisma.level1Result.create({
      data: { teamId, challengeId: challengeIds[1]!, awardedPoints: 20 },
    });

    const total = await prisma.$transaction((tx) => recomputeTeamScore(tx, teamId));
    expect(total).toBe(30);

    const stored = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    expect(stored.score).toBe(30);
  });

  it('subtracts Level 1 hint penalties and never goes below zero', async () => {
    await prisma.level1Result.create({
      data: { teamId, challengeId: challengeIds[0]!, awardedPoints: 10 },
    });
    await prisma.level1Penalty.create({
      data: { teamId, challengeId: challengeIds[0]!, hintNumber: 1, points: 25 },
    });

    const total = await prisma.$transaction((tx) => recomputeTeamScore(tx, teamId));
    // 10 earned, 25 charged. A squad's Level 1 contribution floors at zero rather
    // than dragging their other levels down.
    expect(total).toBe(0);
  });

  it('does not erase Level 1 points when a Level 2 evaluation is approved', async () => {
    await prisma.level1Result.create({
      data: { teamId, challengeId: challengeIds[0]!, awardedPoints: 10 },
    });
    await prisma.$transaction((tx) => recomputeTeamScore(tx, teamId));
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).score).toBe(10);

    const submission = await prisma.submission.create({
      data: { teamId, userId, level: 2, status: 'SUBMITTED' },
    });
    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatorId: userId,
        teamId,
        level: 2,
        status: 'EVALUATED',
        score: 400,
        maxScore: 1000,
        approvalStatus: 'APPROVED',
      },
    });

    const total = await prisma.$transaction((tx) => recomputeTeamScore(tx, teamId));
    // The regression: this used to be 400, silently dropping the Level 1 points.
    expect(total).toBe(410);
  });

  it('counts approved score adjustments and ignores pending ones', async () => {
    await prisma.scoreAdjustment.create({
      data: {
        teamId,
        level: 1,
        points: 15,
        reason: 'Marshal correction',
        status: 'APPROVED',
        requestedByUserId: userId,
      },
    });
    await prisma.scoreAdjustment.create({
      data: {
        teamId,
        level: 2,
        points: 500,
        reason: 'Not yet decided',
        status: 'PENDING',
        requestedByUserId: userId,
      },
    });

    const total = await prisma.$transaction((tx) => recomputeTeamScore(tx, teamId));
    expect(total).toBe(15);
  });

  it('matches the leaderboard total for the same squad', async () => {
    await prisma.level1Result.create({
      data: { teamId, challengeId: challengeIds[0]!, awardedPoints: 10 },
    });
    await prisma.level1Result.create({
      data: { teamId, challengeId: challengeIds[1]!, awardedPoints: 20 },
    });
    const submission = await prisma.submission.create({
      data: { teamId, userId, level: 2, status: 'SUBMITTED' },
    });
    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatorId: userId,
        teamId,
        level: 2,
        status: 'EVALUATED',
        score: 250,
        maxScore: 1000,
        approvalStatus: 'APPROVED',
      },
    });
    await prisma.scoreAdjustment.create({
      data: {
        teamId,
        level: 2,
        points: 5,
        reason: 'Marshal correction',
        status: 'APPROVED',
        requestedByUserId: userId,
      },
    });

    const stored = await prisma.$transaction((tx) => recomputeTeamScore(tx, teamId));
    const breakdown = await computeTeamOfficialTotal(prisma, teamId);
    const standings = await getLeaderboardStandings();
    const row = standings.rows.find((r) => r.id === teamId);

    expect(breakdown.level1).toBe(30);
    expect(breakdown.level2).toBe(255);
    expect(stored).toBe(285);
    // The whole point: one number, three surfaces.
    expect(row?.totalScore).toBe(stored);
  });
});
