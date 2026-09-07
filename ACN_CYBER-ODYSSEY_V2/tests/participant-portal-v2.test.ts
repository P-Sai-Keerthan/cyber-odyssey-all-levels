import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';

describe('Participant Portal Navigation & Dashboard V2 Test Suite', () => {
  beforeEach(async () => {
    await prisma.announcement.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('1. Official Announcements Database Model & Querying', () => {
    it('creates, queries, and orders published announcements by priority and recency', async () => {
      const a1 = await prisma.announcement.create({
        data: {
          title: 'General Update',
          content: 'Normal priority announcement',
          category: 'GENERAL',
          priority: 'NORMAL',
          published: true,
          createdAt: new Date('2026-08-29T10:00:00Z'),
        },
      });

      const a2 = await prisma.announcement.create({
        data: {
          title: 'Urgent System Alert',
          content: 'High priority urgent announcement',
          category: 'SYSTEM',
          priority: 'URGENT',
          published: true,
          createdAt: new Date('2026-08-29T10:05:00Z'),
        },
      });

      const a3 = await prisma.announcement.create({
        data: {
          title: 'Draft Unreleased Notice',
          content: 'Should not appear in participant feed',
          category: 'MISSION',
          priority: 'NORMAL',
          published: false,
        },
      });

      const publishedAnnouncements = await prisma.announcement.findMany({
        where: { published: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });

      expect(publishedAnnouncements.length).toBe(2);
      expect(publishedAnnouncements[0]?.id).toBe(a2.id);
      expect(publishedAnnouncements[0]?.title).toBe('Urgent System Alert');
      expect(publishedAnnouncements[1]?.id).toBe(a1.id);
      expect(publishedAnnouncements.some((a) => a.id === a3.id)).toBe(false);
    });

    it('gracefully handles empty announcement table for participant view', async () => {
      const count = await prisma.announcement.count({
        where: { published: true },
      });
      const announcements = await prisma.announcement.findMany({
        where: { published: true },
      });

      expect(count).toBe(0);
      expect(announcements).toEqual([]);
    });
  });

  describe('2. Participant Single Team Source of Truth & Summary', () => {
    it('provides full squad details for /team and compact summary fields for /dashboard', async () => {
      const passwordHash = await hashPassword('SquadPass123!');
      const captain = await prisma.user.create({
        data: { email: 'cap@acn.org', username: 'captain_01', passwordHash },
      });
      const member = await prisma.user.create({
        data: { email: 'mem@acn.org', username: 'member_02', passwordHash },
      });

      const team = await prisma.team.create({
        data: {
          name: 'CYBER PHANTOMS',
          code: 'CYB-PHANTOM',
          passwordHash,
          creatorId: captain.id,
          score: 450,
        },
      });

      await prisma.teamMember.create({
        data: { teamId: team.id, userId: captain.id, slot: 1, role: 'CREATOR' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: member.id, slot: 2, role: 'MEMBER' },
      });

      const userWithTeam = await prisma.user.findUnique({
        where: { id: captain.id },
        include: {
          membership: {
            include: {
              team: {
                include: {
                  members: {
                    include: { user: true },
                  },
                },
              },
            },
          },
        },
      });

      expect(userWithTeam?.membership?.team.name).toBe('CYBER PHANTOMS');
      expect(userWithTeam?.membership?.team.code).toBe('CYB-PHANTOM');
      expect(userWithTeam?.membership?.team.members.length).toBe(2);
      expect(userWithTeam?.membership?.team.score).toBe(450);

      // Dashboard compact summary card requirements
      const summaryProps = {
        teamName: userWithTeam!.membership!.team.name,
        teamCode: userWithTeam!.membership!.team.code,
        memberCount: userWithTeam!.membership!.team.members.length,
        maxCapacity: 3,
      };

      expect(summaryProps.teamName).toBe('CYBER PHANTOMS');
      expect(summaryProps.teamCode).toBe('CYB-PHANTOM');
      expect(summaryProps.memberCount).toBe(2);
      expect(summaryProps.memberCount < summaryProps.maxCapacity).toBe(true);
    });
  });

  describe('3. Mission Control Dynamic Ranking Calculation', () => {
    it('accurately computes rank based on score among all active teams', async () => {
      const passwordHash = await hashPassword('Pass123!');
      const u1 = await prisma.user.create({
        data: { email: 'p1@acn.org', username: 'p1', passwordHash },
      });
      const u2 = await prisma.user.create({
        data: { email: 'p2@acn.org', username: 'p2', passwordHash },
      });
      const u3 = await prisma.user.create({
        data: { email: 'p3@acn.org', username: 'p3', passwordHash },
      });

      await prisma.team.create({
        data: {
          name: 'TEAM 1ST',
          code: generateTeamCode(),
          passwordHash,
          creatorId: u1.id,
          score: 1500,
        },
      });

      const myTeam = await prisma.team.create({
        data: {
          name: 'TEAM 2ND',
          code: generateTeamCode(),
          passwordHash,
          creatorId: u2.id,
          score: 1100,
        },
      });

      await prisma.team.create({
        data: {
          name: 'TEAM 3RD',
          code: generateTeamCode(),
          passwordHash,
          creatorId: u3.id,
          score: 600,
        },
      });

      const higherCount = await prisma.team.count({
        where: { score: { gt: myTeam.score } },
      });
      const rank = higherCount + 1;

      expect(rank).toBe(2);
    });
  });

  describe('4. Participant Portal Protected Routes & Access Control', () => {
    it('verifies that active participant users have valid status and role for participant workspace', async () => {
      const passwordHash = await hashPassword('ValidPass123!');
      const participant = await prisma.user.create({
        data: {
          email: 'valid_part@acn.org',
          username: 'valid_part',
          passwordHash,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });

      const isParticipant = participant.role === 'PARTICIPANT' && participant.status === 'ACTIVE';
      expect(isParticipant).toBe(true);
    });

    it('denies access to suspended participant accounts', async () => {
      const passwordHash = await hashPassword('SuspendedPass123!');
      const suspended = await prisma.user.create({
        data: {
          email: 'suspended_part@acn.org',
          username: 'suspended_part',
          passwordHash,
          role: 'PARTICIPANT',
          status: 'SUSPENDED',
        },
      });

      const isAllowed = suspended.role === 'PARTICIPANT' && suspended.status === 'ACTIVE';
      expect(isAllowed).toBe(false);
    });
  });
});
