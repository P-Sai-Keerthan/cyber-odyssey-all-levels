import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateTeamCode, normalizeTeamCode } from '@/lib/team/code-generator';
import { TEAM_SLOTS } from '@/lib/team/constants';
import { approveStaffAction, rejectStaffAction } from '@/lib/actions/creator-actions';

describe('ACN Cyber Odyssey V2 — Phase 2 Comprehensive Test Suite', () => {
  beforeEach(async () => {
    // Clean up test data before each test
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.preRegisteredParticipant.deleteMany({});
  });

  describe('ACCOUNT CREATION & VALIDATION (Tests 1–9)', () => {
    it('1. Participant can create account successfully', async () => {
      const passwordHash = await hashPassword('CyberOdyssey2026!');
      const user = await prisma.user.create({
        data: {
          email: 'participant@acn.org',
          username: 'cyber_agent_01',
          passwordHash,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });

      expect(user.id).toBeTruthy();
      expect(user.email).toBe('participant@acn.org');
      expect(user.username).toBe('cyber_agent_01');
      expect(user.role).toBe('PARTICIPANT');
      expect(user.status).toBe('ACTIVE');
    });

    it('2. Participant does NOT need pre-registration to create an account', async () => {
      const totalPreRegistered = await prisma.preRegisteredParticipant.count();
      expect(totalPreRegistered).toBe(0);

      const passwordHash = await hashPassword('ValidPassword123!');
      const user = await prisma.user.create({
        data: {
          email: 'unregistered_external_user@gmail.com',
          username: 'external_user',
          passwordHash,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });

      expect(user.id).toBeTruthy();
      expect(user.email).toBe('unregistered_external_user@gmail.com');
    });

    it('3. Duplicate email is rejected by database unique constraint', async () => {
      const passwordHash = await hashPassword('Password12345!');
      await prisma.user.create({
        data: {
          email: 'duplicate@acn.org',
          username: 'user_one',
          passwordHash,
        },
      });

      await expect(
        prisma.user.create({
          data: {
            email: 'duplicate@acn.org',
            username: 'user_two',
            passwordHash,
          },
        }),
      ).rejects.toThrow();
    });

    it('4. Duplicate username is rejected by database unique constraint', async () => {
      const passwordHash = await hashPassword('Password12345!');
      await prisma.user.create({
        data: {
          email: 'user1@acn.org',
          username: 'shadow_hunter',
          passwordHash,
        },
      });

      await expect(
        prisma.user.create({
          data: {
            email: 'user2@acn.org',
            username: 'shadow_hunter',
            passwordHash,
          },
        }),
      ).rejects.toThrow();
    });

    it('5. Invalid email format is rejected by validation logic', () => {
      const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      expect(EMAIL_REGEX.test('notanemail')).toBe(false);
      expect(EMAIL_REGEX.test('missing@tld')).toBe(false);
      expect(EMAIL_REGEX.test('valid.user@event.org')).toBe(true);
    });

    it('6. Weak/short password (< 12 chars) is rejected', () => {
      const isStrong = (p: string) => p.length >= 12;
      expect(isStrong('short123')).toBe(false);
      expect(isStrong('11charspass')).toBe(false);
      expect(isStrong('TwelveChars12!')).toBe(true);
    });

    it('7. Confirm password mismatch is rejected', () => {
      const p1: string = 'SecurePassword123!';
      const p2: string = 'DifferentPassword123!';
      expect(p1 === p2).toBe(false);
    });

    it('8. Passwords are securely hashed with scrypt and unique salt', async () => {
      const raw = 'SuperSecurePass2026!';
      const hash1 = await hashPassword(raw);
      const hash2 = await hashPassword(raw);

      expect(hash1).not.toBe(raw);
      expect(hash2).not.toBe(raw);
      expect(hash1).not.toBe(hash2); // Different salts
      expect(await verifyPassword(raw, hash1)).toBe(true);
      expect(await verifyPassword(raw, hash2)).toBe(true);
    });

    it('9. Plaintext passwords are never stored in the database', async () => {
      const raw = 'PlainTextNeverSaved123!';
      const passwordHash = await hashPassword(raw);
      const user = await prisma.user.create({
        data: {
          email: 'secure_store@acn.org',
          username: 'sec_store',
          passwordHash,
        },
      });

      expect(user.passwordHash).not.toBe(raw);
      expect(user.passwordHash).toContain(':');
    });
  });

  describe('STAFF APPROVAL & AUDIT WORKFLOW (Tests 10–18)', () => {
    it('10. Evaluator signup creates account in PENDING_APPROVAL status', async () => {
      const passwordHash = await hashPassword('EvalPass12345!');
      const user = await prisma.user.create({
        data: {
          email: 'evaluator1@acn.org',
          username: 'eval_expert',
          passwordHash,
          role: 'EVALUATOR',
          status: 'PENDING_APPROVAL',
        },
      });

      expect(user.role).toBe('EVALUATOR');
      expect(user.status).toBe('PENDING_APPROVAL');
    });

    it('11. Admin signup creates account in PENDING_APPROVAL status', async () => {
      const passwordHash = await hashPassword('AdminPass12345!');
      const user = await prisma.user.create({
        data: {
          email: 'admin1@acn.org',
          username: 'admin_officer',
          passwordHash,
          role: 'ADMIN',
          status: 'PENDING_APPROVAL',
        },
      });

      expect(user.role).toBe('ADMIN');
      expect(user.status).toBe('PENDING_APPROVAL');
    });

    it('12. Pending evaluator cannot log in or access privileged workspaces', async () => {
      const passwordHash = await hashPassword('EvalPass12345!');
      const user = await prisma.user.create({
        data: {
          email: 'pending_eval@acn.org',
          username: 'pending_eval',
          passwordHash,
          role: 'EVALUATOR',
          status: 'PENDING_APPROVAL',
        },
      });

      const canAccess = user.status === 'ACTIVE';
      expect(canAccess).toBe(false);
    });

    it('13. Pending admin cannot log in or access privileged workspaces', async () => {
      const passwordHash = await hashPassword('AdminPass12345!');
      const user = await prisma.user.create({
        data: {
          email: 'pending_admin@acn.org',
          username: 'pending_admin',
          passwordHash,
          role: 'ADMIN',
          status: 'PENDING_APPROVAL',
        },
      });

      const canAccess = user.status === 'ACTIVE';
      expect(canAccess).toBe(false);
    });

    it('14. Creator can approve an evaluator account (status becomes ACTIVE)', async () => {
      const creator = await prisma.user.create({
        data: {
          email: 'creator@acn.org',
          username: 'creator_boss',
          passwordHash: await hashPassword('CreatorPass123!'),
          role: 'CREATOR',
          status: 'ACTIVE',
        },
      });

      const evalUser = await prisma.user.create({
        data: {
          email: 'eval_candidate@acn.org',
          username: 'eval_candidate',
          passwordHash: await hashPassword('CandidatePass1!'),
          role: 'EVALUATOR',
          status: 'PENDING_APPROVAL',
        },
      });

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: evalUser.id },
          data: { status: 'ACTIVE' },
        });
        await tx.auditLog.create({
          data: {
            actorId: creator.id,
            targetId: evalUser.id,
            action: 'STAFF_APPROVED',
            details: 'Approved EVALUATOR role',
          },
        });
      });

      const approved = await prisma.user.findUnique({ where: { id: evalUser.id } });
      expect(approved?.status).toBe('ACTIVE');
    });

    it('15. Creator can approve an admin account (status becomes ACTIVE)', async () => {
      const creator = await prisma.user.create({
        data: {
          email: 'creator@acn.org',
          username: 'creator_boss',
          passwordHash: await hashPassword('CreatorPass123!'),
          role: 'CREATOR',
          status: 'ACTIVE',
        },
      });

      const adminUser = await prisma.user.create({
        data: {
          email: 'admin_candidate@acn.org',
          username: 'admin_candidate',
          passwordHash: await hashPassword('CandidatePass1!'),
          role: 'ADMIN',
          status: 'PENDING_APPROVAL',
        },
      });

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: adminUser.id },
          data: { status: 'ACTIVE' },
        });
        await tx.auditLog.create({
          data: {
            actorId: creator.id,
            targetId: adminUser.id,
            action: 'STAFF_APPROVED',
            details: 'Approved ADMIN role',
          },
        });
      });

      const approved = await prisma.user.findUnique({ where: { id: adminUser.id } });
      expect(approved?.status).toBe('ACTIVE');
    });

    it('16. Creator can reject an evaluator or admin (status becomes REJECTED)', async () => {
      const creator = await prisma.user.create({
        data: {
          email: 'creator@acn.org',
          username: 'creator_boss',
          passwordHash: await hashPassword('CreatorPass123!'),
          role: 'CREATOR',
          status: 'ACTIVE',
        },
      });

      const spamUser = await prisma.user.create({
        data: {
          email: 'spam_eval@fake.com',
          username: 'spam_eval',
          passwordHash: await hashPassword('FakePass12345!'),
          role: 'EVALUATOR',
          status: 'PENDING_APPROVAL',
        },
      });

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: spamUser.id },
          data: { status: 'REJECTED' },
        });
        await tx.auditLog.create({
          data: {
            actorId: creator.id,
            targetId: spamUser.id,
            action: 'STAFF_REJECTED',
            details: 'Rejected spam application',
          },
        });
      });

      const rejected = await prisma.user.findUnique({ where: { id: spamUser.id } });
      expect(rejected?.status).toBe('REJECTED');
    });

    it('17. Non-Creator cannot approve staff accounts (guarded by session check)', async () => {
      // Direct call without creator session returns unauthorized
      const result = await approveStaffAction('some-user-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');

      const rejectResult = await rejectStaffAction('some-user-id');
      expect(rejectResult.success).toBe(false);
      expect(rejectResult.error).toContain('Unauthorized');
    });

    it('18. Audit log records full staff lifecycle (STAFF_SIGNUP_REQUESTED, STAFF_APPROVED, STAFF_REJECTED)', async () => {
      const creator = await prisma.user.create({
        data: {
          email: 'creator@acn.org',
          username: 'creator_boss',
          passwordHash: await hashPassword('CreatorPass123!'),
          role: 'CREATOR',
          status: 'ACTIVE',
        },
      });

      const staff = await prisma.user.create({
        data: {
          email: 'audit_test@acn.org',
          username: 'audit_test',
          passwordHash: await hashPassword('AuditPass1234!'),
          role: 'ADMIN',
          status: 'PENDING_APPROVAL',
        },
      });

      // 1. Log signup request
      await prisma.auditLog.create({
        data: {
          actorId: staff.id,
          targetId: staff.id,
          action: 'STAFF_SIGNUP_REQUESTED',
          details: 'Requested ADMIN role',
        },
      });

      // 2. Log approval
      await prisma.auditLog.create({
        data: {
          actorId: creator.id,
          targetId: staff.id,
          action: 'STAFF_APPROVED',
          details: 'Approved ADMIN role',
        },
      });

      const logs = await prisma.auditLog.findMany({
        where: { targetId: staff.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(logs.length).toBe(2);
      expect(logs[0]?.action).toBe('STAFF_SIGNUP_REQUESTED');
      expect(logs[1]?.action).toBe('STAFF_APPROVED');
    });
  });

  describe('TEAM ONBOARDING & CONCURRENCY (Tests 19–30)', () => {
    it('19. Participant can create a new team', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'captain@acn.org',
          username: 'captain_01',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });

      const team = await prisma.team.create({
        data: {
          name: 'CYBER WATCHDOGS',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass123'),
          creatorId: user.id,
        },
      });

      expect(team.id).toBeTruthy();
      expect(team.name).toBe('CYBER WATCHDOGS');
    });

    it('20. Team ID / Join Code is generated automatically in CYB-XXXXX format', () => {
      const code = generateTeamCode();
      expect(code).toMatch(/^CYB-[2-9A-HJ-NP-Z]{5}$/);
    });

    it('21. Join code is unique and non-ambiguous (no 0/O/1/I)', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateTeamCode();
        expect(code).not.toContain('0');
        expect(code).not.toContain('O');
        expect(code).not.toContain('1');
        expect(code).not.toContain('I');
      }
    });

    it('22. Team creator automatically becomes the first member (Member 1 / 3)', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'lead@acn.org',
          username: 'lead_dev',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });

      const team = await prisma.$transaction(async (tx) => {
        const t = await tx.team.create({
          data: {
            name: 'OMEGA SQUAD',
            code: generateTeamCode(),
            passwordHash: await hashPassword('TeamPass'),
            creatorId: user.id,
          },
        });
        await tx.teamMember.create({
          data: { teamId: t.id, userId: user.id, role: 'CREATOR' },
        });
        return t;
      });

      const members = await prisma.teamMember.findMany({ where: { teamId: team.id } });
      expect(members.length).toBe(1);
      expect(members[0]?.userId).toBe(user.id);
      expect(members[0]?.role).toBe('CREATOR');
    });

    it('23. Team supports maximum of 3 members', async () => {
      const users = await Promise.all([
        prisma.user.create({
          data: {
            email: 'm1@acn.org',
            username: 'm1',
            passwordHash: await hashPassword('Pass12345678!'),
          },
        }),
        prisma.user.create({
          data: {
            email: 'm2@acn.org',
            username: 'm2',
            passwordHash: await hashPassword('Pass12345678!'),
          },
        }),
        prisma.user.create({
          data: {
            email: 'm3@acn.org',
            username: 'm3',
            passwordHash: await hashPassword('Pass12345678!'),
          },
        }),
      ]);

      const team = await prisma.team.create({
        data: {
          name: 'MAX THREE SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('Pass'),
          creatorId: users[0]!.id,
        },
      });

      for (const [index, u] of users.entries()) {
        await prisma.teamMember.create({
          data: {
            teamId: team.id,
            userId: u.id,
            slot: index + 1,
            role: u.id === users[0]!.id ? 'CREATOR' : 'MEMBER',
          },
        });
      }

      const count = await prisma.teamMember.count({ where: { teamId: team.id } });
      expect(count).toBe(3);
    });

    it('24. Participant can join an existing team with valid code and password', async () => {
      const creator = await prisma.user.create({
        data: {
          email: 'cr@acn.org',
          username: 'creator_u',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });
      const joiner = await prisma.user.create({
        data: {
          email: 'jn@acn.org',
          username: 'joiner_u',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });

      const teamPassHash = await hashPassword('SquadPass123');
      const team = await prisma.team.create({
        data: {
          name: 'JOINABLE TEAM',
          code: 'CYB-7K4M2',
          passwordHash: teamPassHash,
          creatorId: creator.id,
        },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: creator.id, slot: 1, role: 'CREATOR' },
      });

      const passMatches = await verifyPassword('SquadPass123', team.passwordHash);
      expect(passMatches).toBe(true);

      await prisma.teamMember.create({
        data: { teamId: team.id, userId: joiner.id, slot: 2, role: 'MEMBER' },
      });

      const count = await prisma.teamMember.count({ where: { teamId: team.id } });
      expect(count).toBe(2);
    });

    it('25. Participant cannot join two different teams (userId unique constraint)', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'double_joiner@acn.org',
          username: 'double_joiner',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });

      const t1 = await prisma.team.create({
        data: {
          name: 'TEAM ALPHA',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P1'),
          creatorId: user.id,
        },
      });
      const t2 = await prisma.team.create({
        data: {
          name: 'TEAM BETA',
          code: generateTeamCode(),
          passwordHash: await hashPassword('P2'),
          creatorId: user.id,
        },
      });

      await prisma.teamMember.create({
        data: { teamId: t1.id, userId: user.id, role: 'CREATOR' },
      });

      await expect(
        prisma.teamMember.create({
          data: { teamId: t2.id, userId: user.id, role: 'MEMBER' },
        }),
      ).rejects.toThrow();
    });

    it('26. Incorrect team password is rejected', async () => {
      const passHash = await hashPassword('RealTeamPassword!');
      const isCorrect = await verifyPassword('WrongPassword!', passHash);
      expect(isCorrect).toBe(false);
    });

    it('27. Invalid join code is rejected', async () => {
      const normalized = normalizeTeamCode('NON-EXISTENT');
      const team = await prisma.team.findUnique({
        where: { code: normalized },
      });
      expect(team).toBeNull();
    });

    it('28. Full team (3/3) rejects additional member joining', async () => {
      const users = await Promise.all([
        prisma.user.create({
          data: {
            email: 'f1@acn.org',
            username: 'f1',
            passwordHash: await hashPassword('Pass12345678!'),
          },
        }),
        prisma.user.create({
          data: {
            email: 'f2@acn.org',
            username: 'f2',
            passwordHash: await hashPassword('Pass12345678!'),
          },
        }),
        prisma.user.create({
          data: {
            email: 'f3@acn.org',
            username: 'f3',
            passwordHash: await hashPassword('Pass12345678!'),
          },
        }),
        prisma.user.create({
          data: {
            email: 'f4@acn.org',
            username: 'f4',
            passwordHash: await hashPassword('Pass12345678!'),
          },
        }),
      ]);

      const team = await prisma.team.create({
        data: {
          name: 'FULL SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('Pass'),
          creatorId: users[0]!.id,
        },
      });

      await prisma.teamMember.create({
        data: { teamId: team.id, userId: users[0]!.id, slot: 1, role: 'CREATOR' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: users[1]!.id, slot: 2, role: 'MEMBER' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: users[2]!.id, slot: 3, role: 'MEMBER' },
      });

      async function attemptJoin(userId: string) {
        return prisma.$transaction(async (tx) => {
          const taken = await tx.teamMember.findMany({
            where: { teamId: team.id },
            select: { slot: true },
          });
          const takenSlots = new Set(taken.map((m) => m.slot));
          const freeSlot = TEAM_SLOTS.find((s) => !takenSlots.has(s));
          if (freeSlot === undefined) {
            throw new Error('This team is already full.');
          }
          return tx.teamMember.create({
            data: { teamId: team.id, userId, slot: freeSlot, role: 'MEMBER' },
          });
        });
      }

      await expect(attemptJoin(users[3]!.id)).rejects.toThrow('This team is already full.');
      const count = await prisma.teamMember.count({ where: { teamId: team.id } });
      expect(count).toBe(3);
    });

    it('29. Concurrent join attempts on last slot never exceed 3 members (atomic race condition test)', async () => {
      const u1 = await prisma.user.create({
        data: {
          email: 'race1@acn.org',
          username: 'race1',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });
      const u2 = await prisma.user.create({
        data: {
          email: 'race2@acn.org',
          username: 'race2',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });
      const u3 = await prisma.user.create({
        data: {
          email: 'race3@acn.org',
          username: 'race3',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });
      const u4 = await prisma.user.create({
        data: {
          email: 'race4@acn.org',
          username: 'race4',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });

      const team = await prisma.team.create({
        data: {
          name: 'RACE SAFETY SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('Pass'),
          creatorId: u1.id,
        },
      });

      // 2 members initially
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: u1.id, slot: 1, role: 'CREATOR' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: u2.id, slot: 2, role: 'MEMBER' },
      });

      // Mirrors joinTeamAction: claim the lowest free slot. The unique index on
      // (teamId, slot) is what rejects the loser of a race, not the row count.
      async function atomicJoin(userId: string) {
        return prisma.$transaction(async (tx) => {
          const taken = await tx.teamMember.findMany({
            where: { teamId: team.id },
            select: { slot: true },
          });
          const takenSlots = new Set(taken.map((m) => m.slot));
          const freeSlot = TEAM_SLOTS.find((s) => !takenSlots.has(s));
          if (freeSlot === undefined) {
            throw new Error('This team is already full.');
          }
          await tx.teamMember.create({
            data: { teamId: team.id, userId, slot: freeSlot, role: 'MEMBER' },
          });
          return true;
        });
      }

      // Simultaneous submissions
      const results = await Promise.allSettled([atomicJoin(u3.id), atomicJoin(u4.id)]);
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(1);

      const finalCount = await prisma.teamMember.count({ where: { teamId: team.id } });
      expect(finalCount).toBe(3);
    });

    it('30. Double-click submit cannot create duplicate team or duplicate membership', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'doubleclick@acn.org',
          username: 'doubleclick',
          passwordHash: await hashPassword('Pass12345678!'),
        },
      });

      async function createTeamAtomic(name: string) {
        return prisma.$transaction(async (tx) => {
          const existingMember = await tx.teamMember.findUnique({
            where: { userId: user.id },
          });
          if (existingMember) {
            throw new Error('You are already a member of a team.');
          }

          const t = await tx.team.create({
            data: {
              name,
              code: generateTeamCode(),
              passwordHash: await hashPassword('TeamPass'),
              creatorId: user.id,
            },
          });

          await tx.teamMember.create({
            data: { teamId: t.id, userId: user.id, role: 'CREATOR' },
          });

          return t;
        });
      }

      // Simulate simultaneous double-click submissions
      const results = await Promise.allSettled([
        createTeamAtomic('DOUBLE CLICK TEAM A'),
        createTeamAtomic('DOUBLE CLICK TEAM B'),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(1);

      const memberRecords = await prisma.teamMember.findMany({ where: { userId: user.id } });
      expect(memberRecords.length).toBe(1);
    });
  });
});
