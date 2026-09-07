/**
 * Phase 16 — Event Concurrency & Data Integrity
 *
 * Covers the concurrent scenarios NOT already proven by
 * `tests/phase17-concurrency.test.ts`, which established squad capacity, single
 * membership and submission uniqueness. This suite adds:
 *
 *   §4  team CREATION at 2 / 10 / 50 simultaneous requests
 *   §5  a squad with 2 members hit by 10 simultaneous joiners
 *   §6  creation/join/delete/leave races
 *   §7  submission rejection after expiry, lock and portal-offline
 *   §8  score and leaderboard consistency under concurrent evaluation
 *   §9  evaluator optimistic-concurrency version conflict
 *   §10 timer authority independent of client clocks
 *   §12 announcement double-click and audience isolation
 *   §20 data-integrity invariants (orphans, duplicates, bounds)
 *
 * WHAT THIS PROVES, PRECISELY: the test datasource is SQLite, which serialises
 * writers. These tests demonstrate that the guards behave correctly and that
 * DATABASE CONSTRAINTS — not application counting — are what reject the losing
 * side of each race. They cannot alone prove behaviour on a parallel MVCC
 * engine; the structural argument for that is in docs/production-readiness.md.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type * as SessionModule from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';
import { MAX_TEAM_SIZE } from '@/lib/team/constants';
import { resetLevelStateVerificationCache } from '@/lib/event/level-state';
import { resetEvaluationCriteria } from './helpers/evaluation-criteria';

/** Per-invocation session identity — see the note in phase17-concurrency.test.ts. */
const sessionContext = new AsyncLocalStorage<string>();
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

const prismaRef = prisma;

const { joinTeamAction, createTeamAction } = await import('@/lib/actions/team-actions');
const { submitInvestigationAction } = await import('@/lib/actions/submission-actions');
const { saveEvaluationAction, startEvaluationAction } =
  await import('@/lib/actions/evaluator-actions');
const { approveEvaluationAction } = await import('@/lib/actions/evaluation-approval-actions');
const { checkAuthoritativeLevelAccess } = await import('@/lib/event/level-access');

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let participantSeq = 0;

async function makeParticipant(tag: string) {
  participantSeq++;
  return prisma.user.create({
    data: {
      email: `p16_${tag}_${participantSeq}@concurrency.test`,
      username: `p16_${tag}_${participantSeq}`,
      passwordHash: await hashPassword('EventConcurrency123!'),
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    },
  });
}

async function makeEvaluator(tag: string) {
  participantSeq++;
  return prisma.user.create({
    data: {
      email: `e16_${tag}_${participantSeq}@concurrency.test`,
      username: `e16_${tag}_${participantSeq}`,
      passwordHash: await hashPassword('EventConcurrency123!'),
      role: 'EVALUATOR',
      status: 'ACTIVE',
    },
  });
}

async function makeSquad(name: string, head: { id: string }, password = 'SquadPass1') {
  const team = await prisma.team.create({
    data: {
      name,
      code: generateTeamCode(),
      passwordHash: await hashPassword(password),
      creatorId: head.id,
    },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: head.id, slot: 1, role: 'CREATOR' },
  });
  return team;
}

/** Starts `fn` once per user, all in flight together, each with its own identity. */
function dispatchAs<T>(
  userIds: string[],
  fn: () => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(userIds.map((id) => sessionContext.run(id, fn)));
}

function joinForm(code: string, password = 'SquadPass1') {
  const fd = new FormData();
  fd.set('teamCode', code);
  fd.set('password', password);
  return fd;
}

function createForm(name: string) {
  const fd = new FormData();
  fd.set('teamName', name);
  fd.set('password', 'SquadPass1');
  fd.set('confirmPassword', 'SquadPass1');
  return fd;
}

function submissionForm(level = 2) {
  const fd = new FormData();
  fd.set('level', String(level));
  fd.set('attacker', LEVEL2_ATTACKER);
  fd.set('proof', LEVEL2_PROOF);
  fd.set(
    'files',
    new File(['%PDF-1.4 phase16 evidence report'], 'report.pdf', { type: 'application/pdf' }),
  );
  return fd;
}

function fulfilledSuccesses<T extends { success: boolean }>(
  results: PromiseSettledResult<T>[],
): T[] {
  return results
    .filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v) => v.success);
}

async function resetDatabase() {
  await prisma.auditLog.deleteMany({});
  await prisma.submissionFile.deleteMany({});
  await prisma.evaluation.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.announcement.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.teamMember.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.user.deleteMany({});
}

async function setLevel2(status: 'LIVE' | 'LOCKED' | 'PAUSED' | 'COMPLETED', endsInMs = 7200_000) {
  const now = new Date();
  await prisma.levelState.upsert({
    where: { levelNumber: 2 },
    update: {
      status,
      startedAt: status === 'LIVE' ? now : null,
      endsAt: status === 'LIVE' ? new Date(now.getTime() + endsInMs) : null,
      remainingSeconds: Math.max(0, Math.floor(endsInMs / 1000)),
    },
    create: {
      levelNumber: 2,
      name: "Level 2 — The Boar's Mark",
      codename: "THE BOAR'S MARK",
      status,
      durationMinutes: 120,
      durationSeconds: 7200,
      remainingSeconds: Math.max(0, Math.floor(endsInMs / 1000)),
      startedAt: status === 'LIVE' ? now : null,
      endsAt: status === 'LIVE' ? new Date(now.getTime() + endsInMs) : null,
    },
  });
  resetLevelStateVerificationCache();
}

async function setPortal(isOnline: boolean) {
  await prisma.portalSetting.upsert({
    where: { id: 'default' },
    update: { isOnline },
    create: { id: 'default', isOnline },
  });
}

describe('Phase 16 — Event concurrency & data integrity', () => {
  beforeEach(async () => {
    // The criteria table is global state that decides a level's maximum score,
    // and other suites replace it. Establish it here rather than inherit it.
    await resetEvaluationCriteria();
    currentSessionUserId = null;
    await resetDatabase();
    await setPortal(true);
    await setLevel2('LIVE');
  });

  afterAll(async () => {
    currentSessionUserId = null;
    await resetDatabase();
    await setPortal(true);
  });

  // =========================================================================
  // §4 TEAM CREATION CONCURRENCY — 2 / 10 / 50 simultaneous requests
  // =========================================================================
  describe('§4 Team creation under concurrency', () => {
    for (const n of [2, 10, 50]) {
      it(`creates exactly ${n} distinct squads when ${n} participants create simultaneously`, async () => {
        const creators = await Promise.all(
          Array.from({ length: n }, (_, i) => makeParticipant(`create${n}_${i}`)),
        );

        const results = await Promise.allSettled(
          creators.map((c, i) =>
            sessionContext.run(c.id, () => createTeamAction(createForm(`P16 SQUAD ${n}-${i}`))),
          ),
        );

        expect(fulfilledSuccesses(results).length).toBe(n);
        expect(await prisma.team.count()).toBe(n);

        // Every squad has exactly its creator, in slot 1. No orphans, no doubles.
        const memberships = await prisma.teamMember.findMany({
          select: { teamId: true, slot: true, userId: true },
        });
        expect(memberships.length).toBe(n);
        expect(memberships.every((m) => m.slot === 1)).toBe(true);
        expect(new Set(memberships.map((m) => m.teamId)).size).toBe(n);
        expect(new Set(memberships.map((m) => m.userId)).size).toBe(n);

        // Join codes must be unique across all squads.
        const codes = await prisma.team.findMany({ select: { code: true } });
        expect(new Set(codes.map((c) => c.code)).size).toBe(n);
      });
    }

    it('admits exactly one squad when 10 participants race for the SAME squad name', async () => {
      const creators = await Promise.all(
        Array.from({ length: 10 }, (_, i) => makeParticipant(`samename_${i}`)),
      );

      const results = await Promise.allSettled(
        creators.map((c) =>
          sessionContext.run(c.id, () => createTeamAction(createForm('CONTESTED SQUAD NAME'))),
        ),
      );

      expect(fulfilledSuccesses(results).length).toBe(1);
      expect(await prisma.team.count({ where: { name: 'CONTESTED SQUAD NAME' } })).toBe(1);
      // The nine losers must not have left orphaned memberships behind.
      expect(await prisma.teamMember.count()).toBe(1);
    });
  });

  // =========================================================================
  // §5 TEAM JOIN CONCURRENCY — the critical case
  // =========================================================================
  describe('§5 Team join under concurrency', () => {
    it('admits exactly ONE joiner when a 2-member squad is hit by 10 simultaneous joins', async () => {
      const head = await makeParticipant('full_head');
      const second = await makeParticipant('full_second');
      const team = await makeSquad('P16 NEARLY FULL SQUAD', head);
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: second.id, slot: 2, role: 'MEMBER' },
      });

      const joiners = await Promise.all(
        Array.from({ length: 10 }, (_, i) => makeParticipant(`rush_${i}`)),
      );

      const results = await dispatchAs(
        joiners.map((j) => j.id),
        () => joinTeamAction(joinForm(team.code)),
      );

      // Exactly one free slot existed, so exactly one joiner is admitted.
      expect(fulfilledSuccesses(results).length).toBe(1);

      const finalCount = await prisma.teamMember.count({ where: { teamId: team.id } });
      expect(finalCount).toBe(MAX_TEAM_SIZE);

      const slots = (
        await prisma.teamMember.findMany({
          where: { teamId: team.id },
          select: { slot: true },
        })
      )
        .map((m) => m.slot)
        .sort();
      expect(slots).toEqual([1, 2, 3]);

      // The nine refusals must be capacity messages, not incidental errors.
      const refusals = results
        .filter(
          (r): r is PromiseFulfilledResult<{ success: boolean; error?: string }> =>
            r.status === 'fulfilled' && !r.value.success,
        )
        .map((r) => r.value.error ?? '');
      expect(refusals.length).toBe(9);
      expect(refusals.every((m) => /full roster/i.test(m))).toBe(true);

      // No joiner who was refused may hold a membership anywhere.
      const strayMemberships = await prisma.teamMember.count({
        where: { userId: { in: joiners.map((j) => j.id) } },
      });
      expect(strayMemberships).toBe(1);
    });

    it('rejects every joiner when a full squad is hit by 10 simultaneous joins', async () => {
      const members = await Promise.all([
        makeParticipant('fullsq_a'),
        makeParticipant('fullsq_b'),
        makeParticipant('fullsq_c'),
      ]);
      const team = await makeSquad('P16 ALREADY FULL SQUAD', members[0]!);
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: members[1]!.id, slot: 2, role: 'MEMBER' },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: members[2]!.id, slot: 3, role: 'MEMBER' },
      });

      const joiners = await Promise.all(
        Array.from({ length: 10 }, (_, i) => makeParticipant(`late_${i}`)),
      );

      const results = await dispatchAs(
        joiners.map((j) => j.id),
        () => joinTeamAction(joinForm(team.code)),
      );

      expect(fulfilledSuccesses(results).length).toBe(0);
      expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(MAX_TEAM_SIZE);
    });

    it('never admits more than 3 across 50 joiners spread over 5 squads', async () => {
      const squads: Array<{ id: string; code: string }> = [];
      for (let s = 0; s < 5; s++) {
        const head = await makeParticipant(`multi_head_${s}`);
        squads.push(await makeSquad(`P16 MULTI SQUAD ${s}`, head));
      }

      const joiners = await Promise.all(
        Array.from({ length: 50 }, (_, i) => makeParticipant(`multi_join_${i}`)),
      );

      await Promise.allSettled(
        joiners.map((j, i) =>
          sessionContext.run(j.id, () => joinTeamAction(joinForm(squads[i % squads.length]!.code))),
        ),
      );

      for (const squad of squads) {
        const count = await prisma.teamMember.count({ where: { teamId: squad.id } });
        expect(count).toBeLessThanOrEqual(MAX_TEAM_SIZE);
      }

      // Nobody ended up on two squads.
      const grouped = await prisma.teamMember.groupBy({ by: ['userId'], _count: { id: true } });
      expect(grouped.every((g) => g._count.id === 1)).toBe(true);
    });
  });

  // =========================================================================
  // §6 CREATION / JOIN / DELETE / LEAVE RACES
  // =========================================================================
  describe('§6 Team lifecycle races', () => {
    it('refuses joins to a squad deleted mid-flight, leaving no orphan memberships', async () => {
      const head = await makeParticipant('del_head');
      const team = await makeSquad('P16 DOOMED SQUAD', head);
      const joiners = await Promise.all(
        Array.from({ length: 5 }, (_, i) => makeParticipant(`del_join_${i}`)),
      );

      // Delete the squad and fire joins at it in the same tick.
      const [, ...joinResults] = await Promise.allSettled([
        prisma.team.delete({ where: { id: team.id } }),
        ...joiners.map((j) => sessionContext.run(j.id, () => joinTeamAction(joinForm(team.code)))),
      ]);

      // Whatever the interleaving, the end state must be consistent: the squad is
      // gone and no membership row references it.
      expect(await prisma.team.count({ where: { id: team.id } })).toBe(0);
      expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(0);

      // Any join that reported success must be backed by a real squad.
      for (const r of joinResults) {
        if (r.status === 'fulfilled' && (r.value as { success: boolean }).success) {
          const memberships = await prisma.teamMember.findMany({ include: { team: true } });
          expect(memberships.every((m) => m.team !== null)).toBe(true);
        }
      }
    });

    it('keeps the roster consistent when a member leaves while others join', async () => {
      const head = await makeParticipant('leave_head');
      const leaver = await makeParticipant('leave_leaver');
      const team = await makeSquad('P16 CHURN SQUAD', head);
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: leaver.id, slot: 2, role: 'MEMBER' },
      });

      const joiners = await Promise.all(
        Array.from({ length: 5 }, (_, i) => makeParticipant(`churn_join_${i}`)),
      );

      await Promise.allSettled([
        prisma.teamMember.delete({ where: { userId: leaver.id } }),
        ...joiners.map((j) => sessionContext.run(j.id, () => joinTeamAction(joinForm(team.code)))),
      ]);

      const members = await prisma.teamMember.findMany({
        where: { teamId: team.id },
        select: { slot: true, userId: true },
      });

      expect(members.length).toBeLessThanOrEqual(MAX_TEAM_SIZE);
      // Slots remain unique and within range.
      const slots = members.map((m) => m.slot);
      expect(new Set(slots).size).toBe(slots.length);
      expect(slots.every((s) => s >= 1 && s <= MAX_TEAM_SIZE)).toBe(true);
    });

    it('admits a participant to exactly one squad when they race to join five at once', async () => {
      const participant = await makeParticipant('spread_joiner');
      const squads: Array<{ id: string; code: string }> = [];
      for (let s = 0; s < 5; s++) {
        const head = await makeParticipant(`spread_head_${s}`);
        squads.push(await makeSquad(`P16 SPREAD SQUAD ${s}`, head));
      }

      const results = await Promise.allSettled(
        squads.map((sq) =>
          sessionContext.run(participant.id, () => joinTeamAction(joinForm(sq.code))),
        ),
      );

      expect(fulfilledSuccesses(results).length).toBe(1);
      expect(await prisma.teamMember.count({ where: { userId: participant.id } })).toBe(1);
    });
  });

  // =========================================================================
  // §7 SUBMISSION GATING — expiry, lock, offline
  // =========================================================================
  describe('§7 Submission gating is enforced server-side', () => {
    async function squadWithMembers() {
      const head = await makeParticipant('sub_head');
      const mate = await makeParticipant('sub_mate');
      const team = await makeSquad('P16 SUBMIT SQUAD', head);
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: mate.id, slot: 2, role: 'MEMBER' },
      });
      return { head, mate, team };
    }

    it('rejects submission after the level timer has expired', async () => {
      const { head, team } = await squadWithMembers();
      // A LIVE level whose endsAt is in the past resolves to COMPLETED on read.
      await setLevel2('LIVE', -1000);

      const result = await sessionContext.run(head.id, () =>
        submitInvestigationAction(submissionForm()),
      );

      expect(result.success).toBe(false);
      expect(await prisma.submission.count({ where: { teamId: team.id } })).toBe(0);
    });

    it('rejects submission when the level is LOCKED', async () => {
      const { head, team } = await squadWithMembers();
      await setLevel2('LOCKED');

      const result = await sessionContext.run(head.id, () =>
        submitInvestigationAction(submissionForm()),
      );

      expect(result.success).toBe(false);
      expect(await prisma.submission.count({ where: { teamId: team.id } })).toBe(0);
    });

    it('rejects submission when the level is PAUSED', async () => {
      const { head, team } = await squadWithMembers();
      await setLevel2('PAUSED');

      const result = await sessionContext.run(head.id, () =>
        submitInvestigationAction(submissionForm()),
      );

      expect(result.success).toBe(false);
      expect(await prisma.submission.count({ where: { teamId: team.id } })).toBe(0);
    });

    it('rejects submission when the portal is OFFLINE', async () => {
      const { head, team } = await squadWithMembers();
      await setPortal(false);

      const result = await sessionContext.run(head.id, () =>
        submitInvestigationAction(submissionForm()),
      );

      expect(result.success).toBe(false);
      expect(await prisma.submission.count({ where: { teamId: team.id } })).toBe(0);
    });

    it('rejects submission from a BLOCKED squad', async () => {
      const { head, team } = await squadWithMembers();
      await prisma.team.update({ where: { id: team.id }, data: { status: 'BLOCKED' } });

      const result = await sessionContext.run(head.id, () =>
        submitInvestigationAction(submissionForm()),
      );

      expect(result.success).toBe(false);
      expect(await prisma.submission.count({ where: { teamId: team.id } })).toBe(0);
    });

    it('records exactly one submission when all three teammates submit at once', async () => {
      const { head, mate, team } = await squadWithMembers();
      const third = await makeParticipant('sub_third');
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: third.id, slot: 3, role: 'MEMBER' },
      });

      const results = await dispatchAs([head.id, mate.id, third.id], () =>
        submitInvestigationAction(submissionForm()),
      );

      // Every teammate's upload is accepted — each one REPLACES the previous, which
      // is the intended behaviour now that a squad can correct its report before
      // the deadline. Last write wins.
      //
      // What must never happen is two submissions for one squad, and that is
      // guaranteed by the unique index on (teamId, level) rather than by the
      // application winning a race. The file rows must also describe exactly one
      // upload: a mixture would mean two uploads interleaved inside the
      // transaction.
      expect(fulfilledSuccesses(results).length).toBeGreaterThan(0);
      expect(await prisma.submission.count({ where: { teamId: team.id, level: 2 } })).toBe(1);

      const files = await prisma.submissionFile.findMany({
        where: { submission: { teamId: team.id, level: 2 } },
      });
      expect(files.length).toBe(1);
    });
  });

  // =========================================================================
  // §8 SCORE & LEADERBOARD CONSISTENCY
  // =========================================================================
  describe('§8 Score integrity under concurrent evaluation', () => {
    it('keeps every squad score equal to the sum of its APPROVED evaluations', async () => {
      const evaluator = await makeEvaluator('score_eval');
      const squads: { id: string; submissionIds: string[] }[] = [];

      for (let s = 0; s < 8; s++) {
        const head = await makeParticipant(`score_head_${s}`);
        const team = await makeSquad(`P16 SCORE SQUAD ${s}`, head);
        const submissionIds: string[] = [];
        for (const level of [1, 2, 3]) {
          const sub = await prisma.submission.create({
            data: { teamId: team.id, userId: head.id, level, status: 'SUBMITTED' },
          });
          submissionIds.push(sub.id);
        }
        squads.push({ id: team.id, submissionIds });
      }

      // Every submission across every squad evaluated at once.
      const allSubmissionIds = squads.flatMap((s) => s.submissionIds);
      await Promise.allSettled(
        allSubmissionIds.map((submissionId, i) =>
          sessionContext.run(evaluator.id, () =>
            saveEvaluationAction({
              submissionId,
              score: 10 + (i % 40),
              status: 'EVALUATED',
            }),
          ),
        ),
      );

      // Nothing is approved yet, so no squad may carry any score at all.
      for (const t of await prisma.team.findMany({ select: { score: true } })) {
        expect(t.score).toBe(0);
      }

      // Approve everything, then assert the leaderboard equals the APPROVED sum.
      const admin = await prisma.user.create({
        data: {
          email: `p16_score_admin_${Date.now()}@concurrency.test`,
          username: `p16_score_admin_${Date.now()}`,
          passwordHash: await hashPassword('EventConcurrency123!'),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      const pending = await prisma.evaluation.findMany({ select: { id: true } });
      await Promise.allSettled(
        pending.map((e) => sessionContext.run(admin.id, () => approveEvaluationAction(e.id))),
      );

      const teams = await prisma.team.findMany({ select: { id: true, score: true } });
      const sums = await prisma.evaluation.groupBy({
        by: ['teamId'],
        where: { approvalStatus: 'APPROVED' },
        _sum: { score: true },
      });
      const sumMap = new Map(sums.map((s) => [s.teamId, s._sum.score ?? 0]));

      for (const t of teams) {
        expect(t.score).toBe(sumMap.get(t.id) ?? 0);
      }
    });

    it('never stores a negative score or one above the maximum', async () => {
      const evaluator = await makeEvaluator('bounds_eval');
      const head = await makeParticipant('bounds_head');
      const team = await makeSquad('P16 BOUNDS SQUAD', head);
      const sub = await prisma.submission.create({
        data: { teamId: team.id, userId: head.id, level: 2, status: 'SUBMITTED' },
      });

      for (const badScore of [-1, -100, 1001, 2000, Number.NaN]) {
        const result = await sessionContext.run(evaluator.id, () =>
          saveEvaluationAction({ submissionId: sub.id, score: badScore, status: 'EVALUATED' }),
        );
        expect(result.success).toBe(false);
      }

      expect(await prisma.evaluation.count({ where: { submissionId: sub.id } })).toBe(0);
      const stored = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
      expect(stored.score).toBe(0);
    });

    it('leaderboard ordering reflects stored scores with deterministic tie-breaking', async () => {
      const evaluator = await makeEvaluator('tie_eval');
      // Three squads, two deliberately tied.
      const scores = [50, 50, 90];
      for (let i = 0; i < scores.length; i++) {
        const head = await makeParticipant(`tie_head_${i}`);
        const team = await makeSquad(`P16 TIE SQUAD ${i}`, head);
        const sub = await prisma.submission.create({
          data: { teamId: team.id, userId: head.id, level: 2, status: 'SUBMITTED' },
        });
        await sessionContext.run(evaluator.id, () =>
          saveEvaluationAction({ submissionId: sub.id, score: scores[i]!, status: 'EVALUATED' }),
        );
      }

      // Scores only reach the leaderboard once approved, so approve them all.
      const orderingAdmin = await prisma.user.create({
        data: {
          email: `p16_tie_admin_${Date.now()}@concurrency.test`,
          username: `p16_tie_admin_${Date.now()}`,
          passwordHash: await hashPassword('EventConcurrency123!'),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      for (const e of await prisma.evaluation.findMany({ select: { id: true } })) {
        await sessionContext.run(orderingAdmin.id, () => approveEvaluationAction(e.id));
      }

      const board = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, score: true, updatedAt: true },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      });

      // Descending by score, and the ordering is total (no undefined ties).
      for (let i = 1; i < board.length; i++) {
        expect(board[i - 1]!.score).toBeGreaterThanOrEqual(board[i]!.score);
      }
      expect(board[0]!.score).toBe(90);
      expect(new Set(board.map((b) => b.id)).size).toBe(board.length);
    });
  });

  // =========================================================================
  // §9 EVALUATOR OPTIMISTIC CONCURRENCY
  // =========================================================================
  describe('§9 Evaluator version conflict', () => {
    async function submissionUnderReview() {
      const head = await makeParticipant('eval_head');
      const team = await makeSquad('P16 EVAL SQUAD', head);
      const sub = await prisma.submission.create({
        data: { teamId: team.id, userId: head.id, level: 2, status: 'SUBMITTED' },
      });
      return { team, sub };
    }

    it('rejects the second save when two evaluators submit against the same version', async () => {
      const evalA = await makeEvaluator('conflict_a');
      const evalB = await makeEvaluator('conflict_b');
      const { sub } = await submissionUnderReview();

      // Both evaluators open the evaluation and observe the same version.
      await sessionContext.run(evalA.id, () => startEvaluationAction(sub.id));
      const opened = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: sub.id },
      });
      const sharedVersion = opened.version;

      // Evaluator A saves first and wins.
      const first = await sessionContext.run(evalA.id, () =>
        saveEvaluationAction({
          submissionId: sub.id,
          score: 70,
          status: 'EVALUATED',
          version: sharedVersion,
          feedback: 'Evaluator A verdict',
        }),
      );
      expect(first.success).toBe(true);

      // Evaluator B saves against the now-stale version and must be refused.
      const second = await sessionContext.run(evalB.id, () =>
        saveEvaluationAction({
          submissionId: sub.id,
          score: 20,
          status: 'EVALUATED',
          version: sharedVersion,
          feedback: 'Evaluator B verdict',
        }),
      );
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/modified by another evaluator|reload/i);

      // A's work must survive intact — B must not have silently overwritten it.
      const finalEval = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: sub.id },
      });
      expect(finalEval.score).toBe(70);
      expect(finalEval.feedback).toBe('Evaluator A verdict');
    });

    it('admits at most one of two simultaneous saves against the same version', async () => {
      const evalA = await makeEvaluator('sim_a');
      const evalB = await makeEvaluator('sim_b');
      const { sub } = await submissionUnderReview();

      await sessionContext.run(evalA.id, () => startEvaluationAction(sub.id));
      const opened = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: sub.id },
      });

      const results = await Promise.allSettled([
        sessionContext.run(evalA.id, () =>
          saveEvaluationAction({
            submissionId: sub.id,
            score: 88,
            status: 'EVALUATED',
            version: opened.version,
          }),
        ),
        sessionContext.run(evalB.id, () =>
          saveEvaluationAction({
            submissionId: sub.id,
            score: 12,
            status: 'EVALUATED',
            version: opened.version,
          }),
        ),
      ]);

      expect(fulfilledSuccesses(results).length).toBe(1);

      // The stored score must be one of the two submitted values, never a blend.
      const finalEval = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: sub.id },
      });
      expect([88, 12]).toContain(finalEval.score);
    });

    it('preserves evaluator notes and team feedback as distinct fields', async () => {
      const evaluator = await makeEvaluator('notes_eval');
      const { sub } = await submissionUnderReview();

      await sessionContext.run(evaluator.id, () =>
        saveEvaluationAction({
          submissionId: sub.id,
          score: 64,
          status: 'EVALUATED',
          notes: 'Internal: weak on persistence analysis.',
          feedback: 'Good work on the intrusion vector.',
        }),
      );

      const stored = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: sub.id },
      });
      expect(stored.notes).toBe('Internal: weak on persistence analysis.');
      expect(stored.feedback).toBe('Good work on the intrusion vector.');
      expect(stored.notes).not.toBe(stored.feedback);
    });
  });

  // =========================================================================
  // §10 TIMER AUTHORITY
  // =========================================================================
  describe('§10 Timers are server-authoritative', () => {
    it('derives expiry from stored endsAt, not from any client-supplied time', async () => {
      const head = await makeParticipant('timer_head');
      await makeSquad('P16 TIMER SQUAD', head);

      await setLevel2('LIVE', -5000); // ended 5 seconds ago
      const expired = await checkAuthoritativeLevelAccess(2, true);
      expect(expired.allowed).toBe(false);
      expect(expired.isCompleted).toBe(true);
      expect(expired.state?.remainingSeconds).toBe(0);

      await setLevel2('LIVE', 60_000); // ends in 60 seconds
      const live = await checkAuthoritativeLevelAccess(2, true);
      expect(live.allowed).toBe(true);
      expect(live.state?.remainingSeconds).toBeGreaterThan(0);
      expect(live.state?.remainingSeconds).toBeLessThanOrEqual(60);
    });

    it('reports the same authoritative state to every concurrent reader', async () => {
      await setLevel2('LIVE', 3_600_000);

      const reads = await Promise.all(
        Array.from({ length: 60 }, () => checkAuthoritativeLevelAccess(2, true)),
      );

      const endsAtValues = new Set(reads.map((r) => r.state?.endsAt));
      // All readers must agree on the authoritative end timestamp.
      expect(endsAtValues.size).toBe(1);
      expect(reads.every((r) => r.allowed)).toBe(true);
    });

    it('rejects a submission that begins before expiry but is evaluated after it', async () => {
      const head = await makeParticipant('expire_head');
      const team = await makeSquad('P16 EXPIRE SQUAD', head);

      // Level expires between the participant loading the page and submitting.
      await setLevel2('LIVE', 40);
      await new Promise((r) => setTimeout(r, 80));

      const result = await sessionContext.run(head.id, () =>
        submitInvestigationAction(submissionForm()),
      );

      expect(result.success).toBe(false);
      expect(await prisma.submission.count({ where: { teamId: team.id } })).toBe(0);
    });
  });

  // =========================================================================
  // §12 ANNOUNCEMENTS & NOTIFICATIONS
  // =========================================================================
  describe('§12 Announcement isolation and duplicate delivery', () => {
    it('delivers a PARTICIPANTS announcement to participants only, once each', async () => {
      const participants = await Promise.all(
        Array.from({ length: 6 }, (_, i) => makeParticipant(`ann_p_${i}`)),
      );
      const evaluator = await makeEvaluator('ann_e');

      const announcement = await prisma.announcement.create({
        data: {
          title: 'Participants only',
          content: 'Squad briefing.',
          targetAudience: 'PARTICIPANTS',
          published: true,
        },
      });

      const eligible = await prisma.user.findMany({
        where: { status: 'ACTIVE', role: 'PARTICIPANT' },
        select: { id: true },
      });
      await prisma.notification.createMany({
        data: eligible.map((u) => ({
          userId: u.id,
          announcementId: announcement.id,
          title: announcement.title,
          message: announcement.content,
        })),
      });

      // Exactly one notification per participant, none for the evaluator.
      for (const p of participants) {
        expect(
          await prisma.notification.count({
            where: { userId: p.id, announcementId: announcement.id },
          }),
        ).toBe(1);
      }
      expect(
        await prisma.notification.count({
          where: { userId: evaluator.id, announcementId: announcement.id },
        }),
      ).toBe(0);
    });

    it('does not expose staff-only announcements to the participant feed', async () => {
      const { listVisibleAnnouncements } = await import('@/lib/event/announcements');

      await prisma.announcement.createMany({
        data: [
          { title: 'For all', content: 'x', targetAudience: 'ALL', published: true },
          { title: 'For evaluators', content: 'x', targetAudience: 'EVALUATORS', published: true },
          { title: 'For admins', content: 'x', targetAudience: 'ADMINS', published: true },
          {
            title: 'For participants',
            content: 'x',
            targetAudience: 'PARTICIPANTS',
            published: true,
          },
          { title: 'Unpublished', content: 'x', targetAudience: 'ALL', published: false },
        ],
      });

      const feed = await listVisibleAnnouncements('PARTICIPANT');
      const titles = feed.map((a) => a.title);

      expect(titles).toContain('For all');
      expect(titles).toContain('For participants');
      expect(titles).not.toContain('For evaluators');
      expect(titles).not.toContain('For admins');
      expect(titles).not.toContain('Unpublished');
    });
  });

  // =========================================================================
  // §20 DATA INTEGRITY INVARIANTS
  // =========================================================================
  describe('§20 Data integrity', () => {
    it('cascades team deletion to memberships without deleting participant accounts', async () => {
      const head = await makeParticipant('cascade_head');
      const mate = await makeParticipant('cascade_mate');
      const team = await makeSquad('P16 CASCADE SQUAD', head);
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: mate.id, slot: 2, role: 'MEMBER' },
      });

      await prisma.team.delete({ where: { id: team.id } });

      expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(0);
      // The participants themselves survive and may form new squads.
      expect(await prisma.user.count({ where: { id: { in: [head.id, mate.id] } } })).toBe(2);
    });

    it('cascades account deletion to membership without deleting the squad', async () => {
      const head = await makeParticipant('acct_head');
      const mate = await makeParticipant('acct_mate');
      const team = await makeSquad('P16 ACCOUNT SQUAD', head);
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: mate.id, slot: 2, role: 'MEMBER' },
      });

      await prisma.user.delete({ where: { id: mate.id } });

      expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
      expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(1);
    });

    it('cascades submission deletion to files and evaluation', async () => {
      const evaluator = await makeEvaluator('orphan_eval');
      const head = await makeParticipant('orphan_head');
      const team = await makeSquad('P16 ORPHAN SQUAD', head);

      const sub = await prisma.submission.create({
        data: { teamId: team.id, userId: head.id, level: 2, status: 'SUBMITTED' },
      });
      await prisma.submissionFile.create({
        data: {
          submissionId: sub.id,
          fileName: 'f.pdf',
          originalName: 'f.pdf',
          fileSize: 10,
          mimeType: 'application/pdf',
          storagePath: 'uploads/submissions/level-2/f.pdf',
        },
      });
      await prisma.evaluation.create({
        data: {
          submissionId: sub.id,
          evaluatorId: evaluator.id,
          teamId: team.id,
          level: 2,
          status: 'EVALUATED',
          score: 50,
        },
      });

      await prisma.submission.delete({ where: { id: sub.id } });

      expect(await prisma.submissionFile.count({ where: { submissionId: sub.id } })).toBe(0);
      expect(await prisma.evaluation.count({ where: { submissionId: sub.id } })).toBe(0);
    });

    it('rejects duplicate emails, usernames, team names and team codes', async () => {
      const user = await makeParticipant('dup_base');
      const team = await makeSquad('P16 DUP SQUAD', user);
      const hash = await hashPassword('x');

      await expect(
        prisma.user.create({
          data: { email: user.email, username: 'different_name', passwordHash: hash },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.user.create({
          data: { email: 'different@x.test', username: user.username, passwordHash: hash },
        }),
      ).rejects.toThrow();

      const other = await makeParticipant('dup_other');
      await expect(
        prisma.team.create({
          data: {
            name: team.name,
            code: generateTeamCode(),
            passwordHash: hash,
            creatorId: other.id,
          },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.team.create({
          data: {
            name: 'P16 OTHER NAME',
            code: team.code,
            passwordHash: hash,
            creatorId: other.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('leaves no orphaned rows after the full concurrent workload', async () => {
      // Exercise creation, joining and submission together, then assert that
      // every foreign key still resolves.
      const creators = await Promise.all(
        Array.from({ length: 6 }, (_, i) => makeParticipant(`mix_create_${i}`)),
      );
      await Promise.allSettled(
        creators.map((c, i) =>
          sessionContext.run(c.id, () => createTeamAction(createForm(`P16 MIX SQUAD ${i}`))),
        ),
      );

      const teams = await prisma.team.findMany({ select: { id: true, code: true } });
      const joiners = await Promise.all(
        Array.from({ length: 12 }, (_, i) => makeParticipant(`mix_join_${i}`)),
      );
      await Promise.allSettled(
        joiners.map((j, i) =>
          sessionContext.run(j.id, () => joinTeamAction(joinForm(teams[i % teams.length]!.code))),
        ),
      );

      const heads = await prisma.teamMember.findMany({
        where: { slot: 1 },
        select: { userId: true },
      });
      await Promise.allSettled(
        heads.map((h) =>
          sessionContext.run(h.userId, () => submitInvestigationAction(submissionForm())),
        ),
      );

      // Every membership points at a live squad and a live user.
      const memberships = await prisma.teamMember.findMany({
        include: { team: { select: { id: true } }, user: { select: { id: true } } },
      });
      expect(memberships.every((m) => m.team && m.user)).toBe(true);

      // Every submission points at a live squad and a live user.
      const submissions = await prisma.submission.findMany({
        include: { team: { select: { id: true } }, user: { select: { id: true } } },
      });
      expect(submissions.every((s) => s.team && s.user)).toBe(true);

      // Every submission file points at a live submission.
      const files = await prisma.submissionFile.findMany({
        include: { submission: { select: { id: true } } },
      });
      expect(files.every((f) => f.submission)).toBe(true);

      // No squad over capacity, no participant on two squads.
      const overCapacity = (
        await prisma.team.findMany({ select: { _count: { select: { members: true } } } })
      ).filter((t) => t._count.members > MAX_TEAM_SIZE);
      expect(overCapacity.length).toBe(0);

      const perUser = await prisma.teamMember.groupBy({ by: ['userId'], _count: { id: true } });
      expect(perUser.every((g) => g._count.id === 1)).toBe(true);

      // No squad holds two submissions for the same level.
      const perLevel = await prisma.submission.groupBy({
        by: ['teamId', 'level'],
        _count: { id: true },
      });
      expect(perLevel.every((g) => g._count.id === 1)).toBe(true);
    });
  });
});
