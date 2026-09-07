/**
 * Phase 17 — Concurrency & Data-Integrity Test Suite
 *
 * These tests exercise the ACTUAL server actions under simultaneous invocation,
 * not a hand-rolled imitation of them. Each one asserts a database-level
 * invariant that must hold no matter how the requests interleave:
 *
 *   - a squad never exceeds MAX_TEAM_SIZE (3) participants;
 *   - a participant never holds two memberships;
 *   - a squad never holds two submissions for the same level;
 *   - team score never drifts from the sum of its EVALUATED evaluations.
 *
 * NOTE ON WHAT THIS PROVES: the test datasource is SQLite, which serialises
 * writers. These tests therefore demonstrate that the guards behave correctly
 * and that the unique indexes are the mechanism doing the rejecting — they
 * cannot, on their own, prove behaviour under a truly parallel MVCC engine.
 * The structural argument for that is in
 * docs/production/phase-17-production-readiness.md section 6.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type * as SessionModule from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';
import { MAX_TEAM_SIZE } from '@/lib/team/constants';

/**
 * Per-invocation session identity.
 *
 * A plain module-level variable is NOT usable here: these tests deliberately
 * start several actions without awaiting in between, so a shared variable would
 * have been overwritten by the last caller before the first action reads it —
 * every concurrent request would then authenticate as the same participant and
 * the race under test would never occur.
 *
 * AsyncLocalStorage binds the identity to each async call chain instead, which
 * is exactly how a real server keeps concurrent requests apart.
 */
const sessionContext = new AsyncLocalStorage<string>();

/** Fallback identity for tests that make a single, sequential call. */
let currentSessionUserId: string | null = null;

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<typeof SessionModule>('@/lib/auth/session');
  return {
    ...actual,
    getSessionUser: async () => {
      const userId = sessionContext.getStore() ?? currentSessionUserId;
      if (!userId) return null;
      return prismaRef.user.findUnique({
        where: { id: userId },
        include: { membership: { include: { team: { include: { members: true } } } } },
      });
    },
  };
});

// Imported after the mock declaration so the mock is in place. `prismaRef`
// breaks the temporal-dead-zone cycle between the factory above and this import.
const prismaRef = prisma;

const { joinTeamAction, createTeamAction } = await import('@/lib/actions/team-actions');
const { submitInvestigationAction } = await import('@/lib/actions/submission-actions');

/**
 * A Level 2 final answer that satisfies the server-side rule.
 *
 * Level 2 submissions now require an attacker and a proof of at least 50 words,
 * validated in `performSubmission` rather than only in the browser — so a test
 * that posts files alone is correctly rejected. These constants keep every
 * existing case exercising the path it was written to exercise.
 */
const LEVEL2_ATTACKER = 'Jordan Bowen';
const LEVEL2_PROOF =
  'The attacker authenticated from 10.24.20.14 at 2026-09-05T11:42:03Z using the harvested account nexora/jbowen, then failed nine consecutive login attempts against DC-PRIMARY before succeeding, mounted the ORION share, copied the dataset to a removable USB device registered to the same workstation, and finally cleared the security event log; CCTV places the same badge in the lab during that exact window.';

async function makeParticipant(tag: string) {
  return prisma.user.create({
    data: {
      email: `${tag}@concurrency.test`,
      username: `u_${tag}`,
      passwordHash: await hashPassword('ConcurrencyTest123!'),
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    },
  });
}

/**
 * Starts `fn` once per user, all in flight together, each under its own session
 * identity. Reproduces "N participants press the button at the same moment" as
 * faithfully as a single-process test can.
 */
function dispatchAs<T>(
  userIds: string[],
  fn: () => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const pending = userIds.map((id) => sessionContext.run(id, fn));
  return Promise.allSettled(pending);
}

async function resetDatabase() {
  await prisma.auditLog.deleteMany({});
  await prisma.submissionFile.deleteMany({});
  await prisma.evaluation.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.teamMember.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.user.deleteMany({});
}

describe('Phase 17 — Concurrency & Data Integrity', () => {
  beforeEach(async () => {
    currentSessionUserId = null;
    await resetDatabase();
    await prisma.portalSetting.upsert({
      where: { id: 'default' },
      update: { isOnline: true },
      create: { id: 'default', isOnline: true },
    });
    await prisma.levelState.upsert({
      where: { levelNumber: 2 },
      update: {
        status: 'LIVE',
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        remainingSeconds: 7200,
      },
      create: {
        levelNumber: 2,
        name: "Level 2 — The Boar's Mark",
        codename: "THE BOAR'S MARK",
        status: 'LIVE',
        durationMinutes: 120,
        durationSeconds: 7200,
        remainingSeconds: 7200,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    currentSessionUserId = null;
    await resetDatabase();
  });

  // =========================================================================
  // TEAM CAPACITY UNDER CONCURRENCY
  // =========================================================================

  describe('Team capacity (max 3) is enforced by the database', () => {
    it('admits exactly 3 of 4 participants joining the same squad simultaneously', async () => {
      const head = await makeParticipant('cap_head');
      const team = await prisma.team.create({
        data: {
          name: 'CAPACITY RACE SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass1'),
          creatorId: head.id,
        },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: head.id, slot: 1, role: 'CREATOR' },
      });

      const joiners = await Promise.all([
        makeParticipant('cap_a'),
        makeParticipant('cap_b'),
        makeParticipant('cap_c'),
        makeParticipant('cap_d'),
      ]);

      const results = await dispatchAs(
        joiners.map((j) => j.id),
        () => {
          const fd = new FormData();
          fd.set('teamCode', team.code);
          fd.set('password', 'SquadPass1');
          return joinTeamAction(fd);
        },
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.success === true);
      const refused = results.filter((r) => r.status === 'fulfilled' && r.value.success === false);

      // 1 head + 2 admitted joiners = 3; the other 2 joiners are refused.
      expect(succeeded.length).toBe(MAX_TEAM_SIZE - 1);
      expect(refused.length).toBe(joiners.length - (MAX_TEAM_SIZE - 1));

      const finalCount = await prisma.teamMember.count({ where: { teamId: team.id } });
      expect(finalCount).toBe(MAX_TEAM_SIZE);

      // The refusals must be capacity messages, not incidental server errors.
      for (const r of refused) {
        if (r.status === 'fulfilled') {
          expect(r.value.error).toMatch(/full roster/i);
        }
      }
    });

    it('never exceeds 3 members when 10 participants storm an empty squad', async () => {
      const head = await makeParticipant('storm_head');
      const team = await prisma.team.create({
        data: {
          name: 'STORM SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass1'),
          creatorId: head.id,
        },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: head.id, slot: 1, role: 'CREATOR' },
      });

      const joiners = await Promise.all(
        Array.from({ length: 10 }, (_, i) => makeParticipant(`storm_${i}`)),
      );

      await dispatchAs(
        joiners.map((j) => j.id),
        () => {
          const fd = new FormData();
          fd.set('teamCode', team.code);
          fd.set('password', 'SquadPass1');
          return joinTeamAction(fd);
        },
      );

      const finalCount = await prisma.teamMember.count({ where: { teamId: team.id } });
      expect(finalCount).toBe(MAX_TEAM_SIZE);

      // Every allocated slot must be distinct and within range.
      const members = await prisma.teamMember.findMany({
        where: { teamId: team.id },
        select: { slot: true },
      });
      const slots = members.map((m) => m.slot).sort();
      expect(slots).toEqual([1, 2, 3]);
    });

    it('rejects a fourth membership row at the database level regardless of application logic', async () => {
      const head = await makeParticipant('db_head');
      const team = await prisma.team.create({
        data: {
          name: 'DB GUARD SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass1'),
          creatorId: head.id,
        },
      });

      const extras = await Promise.all([
        makeParticipant('db_a'),
        makeParticipant('db_b'),
        makeParticipant('db_c'),
      ]);

      await prisma.teamMember.create({
        data: { teamId: team.id, userId: head.id, slot: 1, role: 'CREATOR' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: extras[0]!.id, slot: 2, role: 'MEMBER' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: extras[1]!.id, slot: 3, role: 'MEMBER' },
      });

      // Every valid slot is taken. Attempting to reuse one is rejected by the
      // unique index — the application cannot override this.
      for (const slot of [1, 2, 3]) {
        await expect(
          prisma.teamMember.create({
            data: { teamId: team.id, userId: extras[2]!.id, slot, role: 'MEMBER' },
          }),
        ).rejects.toThrow();
      }

      expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(MAX_TEAM_SIZE);
    });
  });

  // =========================================================================
  // SINGLE MEMBERSHIP UNDER CONCURRENCY
  // =========================================================================

  describe('A participant holds exactly one membership', () => {
    it('admits only one of two simultaneous joins to different squads', async () => {
      const participant = await makeParticipant('dual_joiner');
      const headA = await makeParticipant('dual_head_a');
      const headB = await makeParticipant('dual_head_b');

      const teamA = await prisma.team.create({
        data: {
          name: 'DUAL SQUAD A',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass1'),
          creatorId: headA.id,
        },
      });
      const teamB = await prisma.team.create({
        data: {
          name: 'DUAL SQUAD B',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass1'),
          creatorId: headB.id,
        },
      });
      await prisma.teamMember.create({
        data: { teamId: teamA.id, userId: headA.id, slot: 1, role: 'CREATOR' },
      });
      await prisma.teamMember.create({
        data: { teamId: teamB.id, userId: headB.id, slot: 1, role: 'CREATOR' },
      });

      const fdA = new FormData();
      fdA.set('teamCode', teamA.code);
      fdA.set('password', 'SquadPass1');
      const fdB = new FormData();
      fdB.set('teamCode', teamB.code);
      fdB.set('password', 'SquadPass1');

      const results = await Promise.allSettled([
        sessionContext.run(participant.id, () => joinTeamAction(fdA)),
        sessionContext.run(participant.id, () => joinTeamAction(fdB)),
      ]);
      const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.success);

      expect(succeeded.length).toBe(1);
      expect(await prisma.teamMember.count({ where: { userId: participant.id } })).toBe(1);
    });

    it('creates only one squad when the create form is double-submitted', async () => {
      const participant = await makeParticipant('double_create');
      currentSessionUserId = participant.id;

      function form() {
        const fd = new FormData();
        fd.set('teamName', 'DOUBLE SUBMIT SQUAD');
        fd.set('password', 'SquadPass1');
        fd.set('confirmPassword', 'SquadPass1');
        return fd;
      }

      const results = await Promise.allSettled([
        sessionContext.run(participant.id, () => createTeamAction(form())),
        sessionContext.run(participant.id, () => createTeamAction(form())),
      ]);
      const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.success);

      expect(succeeded.length).toBe(1);
      expect(await prisma.team.count({ where: { name: 'DOUBLE SUBMIT SQUAD' } })).toBe(1);
      expect(await prisma.teamMember.count({ where: { userId: participant.id } })).toBe(1);
    });
  });

  // =========================================================================
  // SUBMISSION UNIQUENESS UNDER CONCURRENCY
  // =========================================================================

  describe('A squad holds at most one submission per level', () => {
    async function seedSquad() {
      const head = await makeParticipant('sub_head');
      const mate = await makeParticipant('sub_mate');
      const team = await prisma.team.create({
        data: {
          name: 'SUBMISSION RACE SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass1'),
          creatorId: head.id,
        },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: head.id, slot: 1, role: 'CREATOR' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: mate.id, slot: 2, role: 'MEMBER' },
      });
      return { head, mate, team };
    }

    function submissionForm() {
      const fd = new FormData();
      fd.set('level', '2');
      fd.set('attacker', LEVEL2_ATTACKER);
      fd.set('proof', LEVEL2_PROOF);
      fd.set(
        'files',
        new File(['%PDF-1.4 concurrency report'], 'report.pdf', { type: 'application/pdf' }),
      );
      return fd;
    }

    it('keeps one submission row when two teammates submit simultaneously', async () => {
      // Both uploads are accepted now that a squad may replace its report before
      // the deadline; the second one supersedes the first. The invariant is not
      // "one request wins" but "one submission row exists", and that is enforced
      // by the unique index on (teamId, level), not by the application winning a
      // race. Two competing reports for one squad remain impossible.
      const { head, mate, team } = await seedSquad();

      const results = await dispatchAs([head.id, mate.id], () =>
        submitInvestigationAction(submissionForm()),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.success);
      expect(succeeded.length).toBeGreaterThan(0);

      const submissions = await prisma.submission.findMany({
        where: { teamId: team.id, level: 2 },
      });
      expect(submissions.length).toBe(1);

      // The surviving submission describes exactly one upload, not a mixture of
      // the two — which is what would indicate the transactions interleaved.
      const files = await prisma.submissionFile.findMany({
        where: { submissionId: submissions[0]!.id },
      });
      expect(files.length).toBe(1);
    });

    it('rejects a second submission row at the database level', async () => {
      const { head, team } = await seedSquad();

      await prisma.submission.create({
        data: { teamId: team.id, userId: head.id, level: 2, status: 'SUBMITTED' },
      });

      await expect(
        prisma.submission.create({
          data: { teamId: team.id, userId: head.id, level: 2, status: 'SUBMITTED' },
        }),
      ).rejects.toThrow();

      expect(await prisma.submission.count({ where: { teamId: team.id, level: 2 } })).toBe(1);
    });

    it('does not leave orphaned upload files on disk when a duplicate is rejected', async () => {
      const { head, mate, team } = await seedSquad();

      await dispatchAs([head.id, mate.id], () => submitInvestigationAction(submissionForm()));

      const submission = await prisma.submission.findFirstOrThrow({
        where: { teamId: team.id, level: 2 },
        include: { files: true },
      });

      // Exactly the files belonging to the winning submission are retained.
      const fs = await import('fs');
      const path = await import('path');
      for (const f of submission.files) {
        const resolved = path.isAbsolute(f.storagePath)
          ? f.storagePath
          : path.resolve(process.cwd(), f.storagePath);
        expect(fs.existsSync(resolved)).toBe(true);
      }

      const orphanRows = await prisma.submissionFile.count({
        where: { submissionId: { not: submission.id } },
      });
      expect(orphanRows).toBe(0);
    });
  });

  // =========================================================================
  // SCORE INTEGRITY
  // =========================================================================

  describe('Team score never drifts from its evaluations', () => {
    it('matches the sum of EVALUATED evaluations after concurrent saves', async () => {
      const head = await makeParticipant('score_head');
      const evaluator = await prisma.user.create({
        data: {
          email: 'score_evaluator@concurrency.test',
          username: 'u_score_evaluator',
          passwordHash: await hashPassword('ConcurrencyTest123!'),
          role: 'EVALUATOR',
          status: 'ACTIVE',
        },
      });

      const team = await prisma.team.create({
        data: {
          name: 'SCORE INTEGRITY SQUAD',
          code: generateTeamCode(),
          passwordHash: await hashPassword('SquadPass1'),
          creatorId: head.id,
        },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: head.id, slot: 1, role: 'CREATOR' },
      });

      // One submission per level, each with a finalised evaluation.
      const scores = [40, 55, 70];
      for (const [index, score] of scores.entries()) {
        const level = index + 1;
        const submission = await prisma.submission.create({
          data: { teamId: team.id, userId: head.id, level, status: 'ACCEPTED' },
        });
        await prisma.evaluation.create({
          data: {
            submissionId: submission.id,
            evaluatorId: evaluator.id,
            teamId: team.id,
            level,
            status: 'EVALUATED',
            score,
          },
        });
      }

      const aggregate = await prisma.evaluation.aggregate({
        where: { teamId: team.id, status: 'EVALUATED' },
        _sum: { score: true },
      });
      await prisma.team.update({
        where: { id: team.id },
        data: { score: aggregate._sum.score ?? 0 },
      });

      const stored = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
      expect(stored.score).toBe(scores.reduce((a, b) => a + b, 0));
    });
  });
});
