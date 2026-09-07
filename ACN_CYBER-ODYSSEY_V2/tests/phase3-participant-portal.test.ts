import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';

describe('Phase 3 — Participant Portal (Dashboard, My Team, Leaderboard)', () => {
  beforeEach(async () => {
    // Clean database before each test
    await prisma.announcement.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('1. Access Control & Authorization', () => {
    it('allows an authenticated participant to have proper user session data', async () => {
      const passwordHash = await hashPassword('ParticipantPass123!');
      const user = await prisma.user.create({
        data: {
          email: 'participant_p3@acn.org',
          username: 'p3_agent',
          passwordHash,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });

      expect(user.id).toBeTruthy();
      expect(user.role).toBe('PARTICIPANT');
      expect(user.status).toBe('ACTIVE');
    });

    it('rejects non-participant roles from participant-specific logic if status is not ACTIVE', async () => {
      const passwordHash = await hashPassword('PendingPass123!');
      const pendingUser = await prisma.user.create({
        data: {
          email: 'pending_eval@acn.org',
          username: 'pending_eval',
          passwordHash,
          role: 'EVALUATOR',
          status: 'PENDING_APPROVAL',
        },
      });

      const isAllowed = pendingUser.role === 'PARTICIPANT' && pendingUser.status === 'ACTIVE';
      expect(isAllowed).toBe(false);
    });

    it('prohibits ordinary participants from holding CREATOR authority', async () => {
      const passwordHash = await hashPassword('UserPass123!');
      const user = await prisma.user.create({
        data: {
          email: 'regular_user@acn.org',
          username: 'regular_user',
          passwordHash,
          role: 'PARTICIPANT',
        },
      });

      const isCreator = user.role === 'CREATOR';
      expect(isCreator).toBe(false);
    });
  });

  describe('2. Participant Dashboard & Team Data Association', () => {
    it('detects when a participant has NO team and requires onboarding', async () => {
      const passwordHash = await hashPassword('Pass12345678!');
      const user = await prisma.user.create({
        data: {
          email: 'teamless@acn.org',
          username: 'teamless_user',
          passwordHash,
          role: 'PARTICIPANT',
        },
        include: { membership: true },
      });

      expect(user.membership).toBeNull();
    });

    it('loads squad details and calculates dynamic rank accurately on dashboard', async () => {
      const passwordHash = await hashPassword('Pass12345678!');

      // Create 3 teams with different scores
      const u1 = await prisma.user.create({
        data: { email: 'lead1@acn.org', username: 'lead1', passwordHash },
      });
      const u2 = await prisma.user.create({
        data: { email: 'lead2@acn.org', username: 'lead2', passwordHash },
      });
      const u3 = await prisma.user.create({
        data: { email: 'lead3@acn.org', username: 'lead3', passwordHash },
      });

      const teamAlpha = await prisma.team.create({
        data: {
          name: 'TEAM ALPHA',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P1'),
          creatorId: u1.id,
          score: 1200,
        },
      });
      const teamBeta = await prisma.team.create({
        data: {
          name: 'TEAM BETA',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P2'),
          creatorId: u2.id,
          score: 850,
        },
      });
      const teamGamma = await prisma.team.create({
        data: {
          name: 'TEAM GAMMA',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P3'),
          creatorId: u3.id,
          score: 400,
        },
      });

      await prisma.teamMember.create({
        data: { teamId: teamBeta.id, userId: u2.id, role: 'CREATOR' },
      });

      // Calculate rank for Team Beta (should be Rank 2)
      const higherCount = await prisma.team.count({
        where: { score: { gt: teamBeta.score } },
      });
      const rank = higherCount + 1;

      expect(rank).toBe(2);
      expect(teamAlpha.score > teamBeta.score).toBe(true);
      expect(teamBeta.score > teamGamma.score).toBe(true);
    });
  });

  describe('3. Deterministic Leaderboard Ranking', () => {
    it('sorts active teams in descending score order', async () => {
      const passwordHash = await hashPassword('Pass12345678!');
      const u1 = await prisma.user.create({
        data: { email: 'u1@acn.org', username: 'u1', passwordHash },
      });
      const u2 = await prisma.user.create({
        data: { email: 'u2@acn.org', username: 'u2', passwordHash },
      });
      const u3 = await prisma.user.create({
        data: { email: 'u3@acn.org', username: 'u3', passwordHash },
      });

      await prisma.team.create({
        data: {
          name: 'LOW SCORE SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P1'),
          creatorId: u1.id,
          score: 300,
        },
      });

      await prisma.team.create({
        data: {
          name: 'TOP SCORE SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P2'),
          creatorId: u2.id,
          score: 1500,
        },
      });

      await prisma.team.create({
        data: {
          name: 'MID SCORE SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P3'),
          creatorId: u3.id,
          score: 900,
        },
      });

      const leaderboard = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: { name: true, score: true },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      });

      expect(leaderboard.length).toBe(3);
      expect(leaderboard[0]?.name).toBe('TOP SCORE SQUAD');
      expect(leaderboard[1]?.name).toBe('MID SCORE SQUAD');
      expect(leaderboard[2]?.name).toBe('LOW SCORE SQUAD');
    });

    it('resolves score ties deterministically by earlier updatedAt timestamp', async () => {
      const passwordHash = await hashPassword('Pass12345678!');
      const u1 = await prisma.user.create({
        data: { email: 't1@acn.org', username: 't1', passwordHash },
      });
      const u2 = await prisma.user.create({
        data: { email: 't2@acn.org', username: 't2', passwordHash },
      });

      const earlierTime = new Date('2026-08-29T10:00:00Z');
      const laterTime = new Date('2026-08-29T10:15:00Z');

      await prisma.team.create({
        data: {
          name: 'SECOND TO REACH 1000',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P1'),
          creatorId: u1.id,
          score: 1000,
          updatedAt: laterTime,
        },
      });

      await prisma.team.create({
        data: {
          name: 'FIRST TO REACH 1000',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P2'),
          creatorId: u2.id,
          score: 1000,
          updatedAt: earlierTime,
        },
      });

      const tiedLeaderboard = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: { name: true, score: true, updatedAt: true },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      });

      expect(tiedLeaderboard.length).toBe(2);
      expect(tiedLeaderboard[0]?.name).toBe('FIRST TO REACH 1000');
      expect(tiedLeaderboard[1]?.name).toBe('SECOND TO REACH 1000');
    });

    it('correctly handles empty leaderboard without errors', async () => {
      const leaderboard = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, score: true },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      });

      expect(leaderboard).toEqual([]);
      expect(leaderboard.length).toBe(0);
    });

    it('identifies participant own team in the leaderboard query list', async () => {
      const passwordHash = await hashPassword('Pass12345678!');
      const u1 = await prisma.user.create({
        data: { email: 'my_lead@acn.org', username: 'my_lead', passwordHash },
      });
      const u2 = await prisma.user.create({
        data: { email: 'other_lead@acn.org', username: 'other_lead', passwordHash },
      });

      const myTeam = await prisma.team.create({
        data: {
          name: 'MY SQUAD',
          code: 'CYB-MYTEAM',
          passwordHash: await hashPassword('Pass'),
          creatorId: u1.id,
          score: 750,
        },
      });

      const otherTeam = await prisma.team.create({
        data: {
          name: 'OTHER SQUAD',
          code: 'CYB-OTHER',
          passwordHash: await hashPassword('Pass'),
          creatorId: u2.id,
          score: 950,
        },
      });

      await prisma.teamMember.create({
        data: { teamId: myTeam.id, userId: u1.id, role: 'CREATOR' },
      });

      const allTeams = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, code: true, score: true },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      });

      const highlighted = allTeams.map((t, idx) => ({
        rank: idx + 1,
        name: t.name,
        isUserTeam: t.id === myTeam.id,
      }));

      expect(highlighted[0]?.name).toBe(otherTeam.name);
      expect(highlighted[0]?.isUserTeam).toBe(false);

      expect(highlighted[1]?.name).toBe(myTeam.name);
      expect(highlighted[1]?.isUserTeam).toBe(true);
      expect(highlighted[1]?.rank).toBe(2);
    });
  });
});
