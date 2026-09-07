/**
 * Level 3 scoring model, hint penalties, and report replacement.
 *
 * Asserts SERVER-SIDE state — penalty rows, discovery rows, and what the
 * leaderboard aggregation returns — not UI flags. A page showing the right
 * number over a wrong database is still wrong.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import {
  LEVEL3_DIFFICULTY_POINTS,
  LEVEL3_HINT_PENALTIES,
  defaultPointsForDifficulty,
  hintPenaltyFor,
  isValidHintNumber,
  combineLevel3Score,
} from '@/lib/level3/scoring-policy';
import { getTeamAutomaticScore, getTeamLevel3Progress } from '@/lib/level3/scoring';
import { getLeaderboardStandings } from '@/lib/leaderboard/standings';
import { unlockLevel3HintAction } from '@/lib/actions/level3-hint-actions';
import { APPROVAL_STATUS } from '@/lib/evaluation/approval';

const PREFIX = 'l3hint_';

let testCookieToken: string | null = null;

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    get: vi
      .fn()
      .mockImplementation((name: string) =>
        name === 'cyber_session' && testCookieToken ? { value: testCookieToken } : undefined,
      ),
    set: vi.fn().mockImplementation((name: string, value: string) => {
      if (name === 'cyber_session') testCookieToken = value;
    }),
    delete: vi.fn().mockImplementation(() => {
      testCookieToken = null;
    }),
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

let teamAId = '';
let teamBId = '';
let userAId = '';
let bugEasyId = '';
let bugHardId = '';
let bugCriticalId = '';

async function cleanup() {
  await prisma.level3Penalty.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.level3Discovery.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.level3Hint.deleteMany({ where: { bug: { code: { startsWith: PREFIX } } } });
  await prisma.level3Bug.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.level3Station.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.evaluation.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.submission.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

async function setLevel3(status: string) {
  const now = Date.now();
  await prisma.levelState.upsert({
    where: { levelNumber: 3 },
    update: {
      status,
      startedAt: new Date(now - 60_000),
      endsAt: new Date(now + 3_600_000),
      remainingSeconds: 3600,
    },
    create: {
      levelNumber: 3,
      name: 'Level 3',
      codename: 'THE TWELVE AXES',
      status,
      startedAt: new Date(now - 60_000),
      endsAt: new Date(now + 3_600_000),
      remainingSeconds: 3600,
    },
  });
}

async function unlock(bugId: string, hintNumber: number) {
  const fd = new FormData();
  fd.append('bugId', bugId);
  fd.append('hintNumber', String(hintNumber));
  return unlockLevel3HintAction(fd);
}

beforeAll(async () => {
  await cleanup();
  const pwd = await hashPassword('Level3HintTest123!');

  const userA = await prisma.user.create({
    data: {
      email: `${PREFIX}a@example.com`,
      username: `${PREFIX}a`,
      passwordHash: pwd,
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `${PREFIX}b@example.com`,
      username: `${PREFIX}b`,
      passwordHash: pwd,
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    },
  });
  userAId = userA.id;

  const teamA = await prisma.team.create({
    data: {
      name: `${PREFIX}alpha`,
      code: `${PREFIX}A1`,
      passwordHash: pwd,
      creatorId: userA.id,
      members: { create: { userId: userA.id, slot: 1, role: 'LEADER' } },
    },
  });
  const teamB = await prisma.team.create({
    data: {
      name: `${PREFIX}bravo`,
      code: `${PREFIX}B1`,
      passwordHash: pwd,
      creatorId: userB.id,
      members: { create: { userId: userB.id, slot: 1, role: 'LEADER' } },
    },
  });
  teamAId = teamA.id;
  teamBId = teamB.id;

  const station = await prisma.level3Station.create({
    data: {
      name: `${PREFIX}Station One`,
      description: 'Test station',
      sortOrder: 1,
      challengeUrl: 'http://example.invalid/challenge',
      challengeLabel: 'Open Target',
    },
  });

  const easy = await prisma.level3Bug.create({
    data: {
      code: `${PREFIX}E1`,
      title: 'Easy bug',
      difficulty: 'EASY',
      points: LEVEL3_DIFFICULTY_POINTS.EASY,
      stationId: station.id,
      sortOrder: 1,
      hints: {
        create: [
          { hintNumber: 1, content: 'Easy hint one' },
          { hintNumber: 2, content: 'Easy hint two' },
        ],
      },
    },
  });
  const hard = await prisma.level3Bug.create({
    data: {
      code: `${PREFIX}H1`,
      title: 'Hard bug',
      difficulty: 'HARD',
      points: LEVEL3_DIFFICULTY_POINTS.HARD,
      stationId: station.id,
      sortOrder: 2,
    },
  });
  const critical = await prisma.level3Bug.create({
    data: {
      code: `${PREFIX}C1`,
      title: 'Critical bug',
      difficulty: 'CRITICAL',
      points: LEVEL3_DIFFICULTY_POINTS.CRITICAL,
      stationId: station.id,
      sortOrder: 3,
    },
  });
  bugEasyId = easy.id;
  bugHardId = hard.id;
  bugCriticalId = critical.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.levelState
    .update({ where: { levelNumber: 3 }, data: { status: 'LOCKED' } })
    .catch(() => {});
});

beforeEach(async () => {
  await prisma.level3Penalty.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  await prisma.level3Discovery.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  await setLevel3('LIVE');
  testCookieToken = await createSession(userAId);
});

describe('Scoring policy', () => {
  it('prices the four difficulty tiers at the event scale', () => {
    expect(defaultPointsForDifficulty('EASY')).toBe(100);
    expect(defaultPointsForDifficulty('MEDIUM')).toBe(200);
    expect(defaultPointsForDifficulty('HARD')).toBe(300);
    expect(defaultPointsForDifficulty('CRITICAL')).toBe(500);
  });

  it('returns 0 rather than throwing for an unknown tier', () => {
    expect(defaultPointsForDifficulty('LEGENDARY')).toBe(0);
  });

  it('prices hints at 15 and 35', () => {
    expect(hintPenaltyFor(1)).toBe(15);
    expect(hintPenaltyFor(2)).toBe(35);
    expect(LEVEL3_HINT_PENALTIES[1]).toBe(15);
    expect(LEVEL3_HINT_PENALTIES[2]).toBe(35);
  });

  it('rejects hint numbers outside 1..2', () => {
    expect(isValidHintNumber(0)).toBe(false);
    expect(isValidHintNumber(3)).toBe(false);
    expect(isValidHintNumber(1.5)).toBe(false);
    expect(isValidHintNumber(1)).toBe(true);
  });

  it('clamps a negative combined score at zero', () => {
    // A squad that bought more help than it earned finishes on 0, not on a
    // negative that would drag down its event total.
    expect(combineLevel3Score(0, 50, 0)).toBe(0);
    expect(combineLevel3Score(100, 50, 0)).toBe(50);
    expect(combineLevel3Score(100, 15, 30)).toBe(115);
  });
});

describe('Dynamic maximum score', () => {
  it('sums the active bug records rather than using a hardcoded ceiling', async () => {
    const progress = await getTeamLevel3Progress(teamAId);
    expect(progress.maxAutomaticPoints).toBe(100 + 300 + 500);
    expect(progress.totalActiveBugs).toBe(3);
  });

  it('changes when a bug is retired, with no code change', async () => {
    await prisma.level3Bug.update({ where: { id: bugCriticalId }, data: { isActive: false } });
    try {
      const progress = await getTeamLevel3Progress(teamAId);
      expect(progress.maxAutomaticPoints).toBe(400);
      expect(progress.totalActiveBugs).toBe(2);
    } finally {
      await prisma.level3Bug.update({ where: { id: bugCriticalId }, data: { isActive: true } });
    }
  });
});

describe('Hint unlocking', () => {
  it('charges the server-side price and returns the content', async () => {
    const res = await unlock(bugEasyId, 1);
    expect(res.success).toBe(true);
    expect(res.data?.chargedPoints).toBe(15);
    expect(res.data?.content).toBe('Easy hint one');
    expect(res.data?.penaltyPoints).toBe(15);

    const rows = await prisma.level3Penalty.findMany({ where: { teamId: teamAId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.points).toBe(15);
    expect(rows[0]?.hintNumber).toBe(1);
  });

  it('charges hint 2 at its own price', async () => {
    await unlock(bugEasyId, 1);
    const res = await unlock(bugEasyId, 2);
    expect(res.data?.chargedPoints).toBe(35);
    expect(res.data?.penaltyPoints).toBe(50);
  });

  it('never charges the same hint twice', async () => {
    await unlock(bugEasyId, 1);
    const second = await unlock(bugEasyId, 1);

    expect(second.success).toBe(true);
    expect(second.data?.alreadyUnlocked).toBe(true);
    expect(second.data?.chargedPoints).toBe(0);
    // Content still returned — the squad already paid for it.
    expect(second.data?.content).toBe('Easy hint one');

    expect(await prisma.level3Penalty.count({ where: { teamId: teamAId } })).toBe(1);
  });

  it('charges once when teammates unlock the same hint simultaneously', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => unlock(bugEasyId, 1)));

    const charged = results.filter((r) => r.data?.chargedPoints === 15);
    expect(charged).toHaveLength(1);
    expect(await prisma.level3Penalty.count({ where: { teamId: teamAId } })).toBe(1);

    const score = await getTeamAutomaticScore(teamAId);
    expect(score.penaltyPoints).toBe(15);
  });

  it('is enforced by the database, not only the application check', async () => {
    await prisma.level3Penalty.create({
      data: { teamId: teamAId, bugId: bugEasyId, hintNumber: 1, points: 15 },
    });
    await expect(
      prisma.level3Penalty.create({
        data: { teamId: teamAId, bugId: bugEasyId, hintNumber: 1, points: 9999 },
      }),
    ).rejects.toThrow();
  });

  it('ignores a client-supplied price', async () => {
    const fd = new FormData();
    fd.append('bugId', bugEasyId);
    fd.append('hintNumber', '1');
    fd.append('points', '0');
    fd.append('penalty', '0');

    const res = await unlockLevel3HintAction(fd);
    expect(res.data?.chargedPoints).toBe(15);

    const row = await prisma.level3Penalty.findFirst({ where: { teamId: teamAId } });
    expect(row?.points).toBe(15);
  });

  it('charges the session squad, never one named in the request', async () => {
    const fd = new FormData();
    fd.append('bugId', bugEasyId);
    fd.append('hintNumber', '1');
    fd.append('teamId', teamBId);

    await unlockLevel3HintAction(fd);

    expect(await prisma.level3Penalty.count({ where: { teamId: teamAId } })).toBe(1);
    expect(await prisma.level3Penalty.count({ where: { teamId: teamBId } })).toBe(0);
  });

  it('rejects a hint that does not exist', async () => {
    const res = await unlock(bugHardId, 1);
    expect(res.success).toBe(false);
    expect(await prisma.level3Penalty.count({ where: { teamId: teamAId } })).toBe(0);
  });

  it('rejects an invalid hint number', async () => {
    const res = await unlock(bugEasyId, 7);
    expect(res.success).toBe(false);
    expect(await prisma.level3Penalty.count({ where: { teamId: teamAId } })).toBe(0);
  });

  it('refuses to sell hints once Level 3 has closed', async () => {
    await setLevel3('COMPLETED');
    const res = await unlock(bugEasyId, 1);
    expect(res.success).toBe(false);
    expect(await prisma.level3Penalty.count({ where: { teamId: teamAId } })).toBe(0);
  });

  it('refuses to sell hints while Level 3 is paused', async () => {
    await setLevel3('PAUSED');
    const res = await unlock(bugEasyId, 1);
    expect(res.success).toBe(false);
  });

  it('never writes hint content into the audit log', async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: userAId } });
    await unlock(bugEasyId, 1);

    const entries = await prisma.auditLog.findMany({ where: { actorId: userAId } });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.details ?? '').not.toContain('Easy hint one');
    }
  });
});

describe('Penalties in the squad score', () => {
  async function giveDiscovery(bugId: string, points: number) {
    await prisma.level3Discovery.create({
      data: { teamId: teamAId, bugId, awardedPoints: points },
    });
  }

  it('subtracts penalties from discovery points', async () => {
    await giveDiscovery(bugHardId, 300);
    await unlock(bugEasyId, 1);

    const score = await getTeamAutomaticScore(teamAId);
    expect(score.discoveryPoints).toBe(300);
    expect(score.penaltyPoints).toBe(15);
    expect(score.automaticScore).toBe(285);
  });

  it('clamps at zero when hints exceed discoveries', async () => {
    await unlock(bugEasyId, 1);
    await unlock(bugEasyId, 2);

    const score = await getTeamAutomaticScore(teamAId);
    // Scored, at 0 — not null, because the squad has started.
    expect(score.automaticScore).toBe(0);
    expect(score.penaltyPoints).toBe(50);
  });

  it('leaves a squad that has done nothing unscored, not zero', async () => {
    const score = await getTeamAutomaticScore(teamAId);
    expect(score.automaticScore).toBeNull();
    expect(score.discoveryPoints).toBeNull();
  });

  it('reports unlocked hints per bug without leaking unbought content', async () => {
    await unlock(bugEasyId, 1);
    const progress = await getTeamLevel3Progress(teamAId);
    const easy = progress.stations[0]?.bugs.find((b) => b.id === bugEasyId);

    expect(easy?.unlockedHints).toEqual([1]);
    expect(easy?.availableHints).toEqual([1, 2]);
    // The progress payload carries hint NUMBERS only — never text.
    expect(JSON.stringify(progress)).not.toContain('Easy hint two');
  });
});

describe('Leaderboard integration', () => {
  async function level3Row(teamId: string) {
    const standings = await getLeaderboardStandings();
    return standings.rows.find((r) => r.id === teamId);
  }

  beforeEach(async () => {
    await prisma.evaluation.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
    await prisma.submission.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  });

  it('deducts hint penalties from the leaderboard Level 3 score', async () => {
    await prisma.level3Discovery.create({
      data: { teamId: teamAId, bugId: bugCriticalId, awardedPoints: 500 },
    });
    await unlock(bugEasyId, 1);

    const row = await level3Row(teamAId);
    expect(row?.levelScores[3]).toBe(485);
  });

  it('computes bug points − penalties + approved report', async () => {
    await prisma.level3Discovery.create({
      data: { teamId: teamAId, bugId: bugCriticalId, awardedPoints: 500 },
    });
    await unlock(bugEasyId, 1); // −15
    await unlock(bugEasyId, 2); // −35

    const submission = await prisma.submission.create({
      data: { teamId: teamAId, userId: userAId, level: 3, status: 'SUBMITTED' },
    });
    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatorId: userAId,
        teamId: teamAId,
        level: 3,
        status: 'EVALUATED',
        score: 60,
        maxScore: 100,
        approvalStatus: APPROVAL_STATUS.APPROVED,
        submittedAt: new Date(),
      },
    });

    const row = await level3Row(teamAId);
    // 500 − 50 + 60
    expect(row?.levelScores[3]).toBe(510);
  });

  it('excludes a pending report while still deducting penalties', async () => {
    await prisma.level3Discovery.create({
      data: { teamId: teamAId, bugId: bugHardId, awardedPoints: 300 },
    });
    await unlock(bugEasyId, 1);

    const submission = await prisma.submission.create({
      data: { teamId: teamAId, userId: userAId, level: 3, status: 'SUBMITTED' },
    });
    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatorId: userAId,
        teamId: teamAId,
        level: 3,
        status: 'EVALUATED',
        score: 60,
        maxScore: 100,
        approvalStatus: APPROVAL_STATUS.PENDING_APPROVAL,
        submittedAt: new Date(),
      },
    });

    const row = await level3Row(teamAId);
    expect(row?.levelScores[3]).toBe(285);
  });

  it('scores a hint-only squad at 0 rather than leaving it unscored', async () => {
    await unlock(bugEasyId, 1);
    const row = await level3Row(teamAId);
    // The squad has engaged with Level 3, so it is ranked — at zero.
    expect(row?.levelScores[3]).toBe(0);
  });

  it('leaves Level 1 and Level 2 untouched by Level 3 penalties', async () => {
    await unlock(bugEasyId, 1);
    const row = await level3Row(teamAId);
    expect(row?.levelScores[1]).toBeNull();
    expect(row?.levelScores[2]).toBeNull();
  });

  it('keeps squads isolated', async () => {
    await unlock(bugEasyId, 1);
    expect((await getTeamAutomaticScore(teamBId)).penaltyPoints).toBe(0);
    expect((await getTeamAutomaticScore(teamBId)).automaticScore).toBeNull();
  });
});
