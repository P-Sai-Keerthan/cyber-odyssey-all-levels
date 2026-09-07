import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';
import * as sessionModule from '@/lib/auth/session';
import {
  createScoreAdjustmentRequest,
  approveScoreAdjustment,
  rejectScoreAdjustment,
  getScoreAdjustments,
  getTeamScoreAdjustments,
} from '@/lib/score-adjustments/service';
import {
  normalizeScoreAdjustmentLevel,
  requestScoreAdjustmentSchema,
} from '@/lib/score-adjustments/types';
import { getLeaderboardStandings } from '@/lib/leaderboard/standings';
import {
  requestScoreAdjustmentAction,
  approveScoreAdjustmentAction,
  rejectScoreAdjustmentAction,
} from '@/lib/actions/score-adjustment-actions';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

let seq = 0;

async function makeUser(role: 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN') {
  seq++;
  return prisma.user.create({
    data: {
      email: `adj_${role.toLowerCase()}_${seq}_${Date.now()}@adjustments.test`,
      username: `adj_${role.toLowerCase()}_${seq}_${Date.now()}`,
      passwordHash: await hashPassword('TestPass!2026'),
      role,
      status: 'ACTIVE',
    },
  });
}

function mockSession(user: {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
}) {
  return vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
    ...user,
    membership: null,
  } as unknown as Awaited<ReturnType<typeof sessionModule.getSessionUser>>);
}

async function makeSquad(name: string) {
  const head = await makeUser('PARTICIPANT');
  const team = await prisma.team.create({
    data: {
      name,
      code: generateTeamCode(),
      passwordHash: await hashPassword('SquadPass1!'),
      creatorId: head.id,
    },
  });

  await prisma.teamMember.create({
    data: {
      teamId: team.id,
      userId: head.id,
      role: 'HEAD',
    },
  });

  return team;
}

describe('Score Adjustments Service & Leaderboard Integration', () => {
  beforeEach(async () => {
    // Clean up adjustments created in testing
    await prisma.scoreAdjustment.deleteMany({
      where: {
        team: {
          name: { startsWith: 'ADJ_TEST_' },
        },
      },
    });
    await prisma.team.deleteMany({
      where: {
        name: { startsWith: 'ADJ_TEST_' },
      },
    });
  });

  afterAll(async () => {
    await prisma.scoreAdjustment.deleteMany({
      where: {
        team: {
          name: { startsWith: 'ADJ_TEST_' },
        },
      },
    });
    await prisma.team.deleteMany({
      where: {
        name: { startsWith: 'ADJ_TEST_' },
      },
    });
  });

  describe('Validation & Normalization', () => {
    it('normalizes level representations accurately', () => {
      expect(normalizeScoreAdjustmentLevel(1)).toBe(1);
      expect(normalizeScoreAdjustmentLevel(2)).toBe(2);
      expect(normalizeScoreAdjustmentLevel(3)).toBe(3);
      expect(normalizeScoreAdjustmentLevel('LEVEL_1')).toBe(1);
      expect(normalizeScoreAdjustmentLevel('LEVEL 2')).toBe(2);
      expect(normalizeScoreAdjustmentLevel('3')).toBe(3);
      expect(normalizeScoreAdjustmentLevel(4)).toBeNull();
      expect(normalizeScoreAdjustmentLevel('LEVEL_4')).toBeNull();
    });

    it('enforces request validation schema', () => {
      // Valid input
      const valid = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 2,
        points: 50,
        reason: 'Identified novel unannounced 0-day exploitation chain.',
        evidenceNote: 'See station 3 report log.',
      });
      expect(valid.success).toBe(true);

      // Points out of bounds (< 1)
      const invalidPointsLow = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 2,
        points: 0,
        reason: 'Valid justification with more than 10 characters',
      });
      expect(invalidPointsLow.success).toBe(false);

      // Points above 500 are valid (no arbitrary 500-point cap)
      const validPointsAbove500 = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 2,
        points: 501,
        reason: 'Valid justification with more than 10 characters',
      });
      expect(validPointsAbove500.success).toBe(true);

      const validPointsLarge = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 2,
        points: 1000,
        reason: 'Valid justification with more than 10 characters',
      });
      expect(validPointsLarge.success).toBe(true);

      // Points out of bounds (> 100,000 safe database limit)
      const invalidPointsHigh = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 2,
        points: 100001,
        reason: 'Valid justification with more than 10 characters',
      });
      expect(invalidPointsHigh.success).toBe(false);

      // Non-integer points (float)
      const invalidPointsFloat = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 2,
        points: 15.5,
        reason: 'Valid justification with more than 10 characters',
      });
      expect(invalidPointsFloat.success).toBe(false);

      // Reason too short (< 10 chars)
      const invalidReason = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 2,
        points: 25,
        reason: 'Too short',
      });
      expect(invalidReason.success).toBe(false);

      // Invalid level
      const invalidLevel = requestScoreAdjustmentSchema.safeParse({
        teamId: 'team-123',
        level: 5,
        points: 25,
        reason: 'Valid justification with more than 10 characters',
      });
      expect(invalidLevel.success).toBe(false);
    });
  });

  describe('Request & Approval Lifecycle', () => {
    it('creates a score adjustment request in PENDING state and logs audit trail', async () => {
      const evaluator = await makeUser('EVALUATOR');
      const team = await makeSquad(`ADJ_TEST_SQUAD_${Date.now()}`);

      const created = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 2,
          points: 75,
          reason: 'Exceptional forensic root-cause reconstruction of USB exfiltration timeline.',
          evidenceNote: 'Station 2 exhibit B.',
        },
        { id: evaluator.id, username: evaluator.username },
      );

      expect(created.id).toBeDefined();
      expect(created.teamId).toBe(team.id);
      expect(created.level).toBe(2);
      expect(created.points).toBe(75);
      expect(created.status).toBe('PENDING');
      expect(created.requestedByUserId).toBe(evaluator.id);
      expect(created.requestedByUsername).toBe(evaluator.username);
      expect(created.reviewedByUserId).toBeNull();

      // Check database persistence
      const dbRecord = await prisma.scoreAdjustment.findUnique({
        where: { id: created.id },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.status).toBe('PENDING');

      // Check audit log entry
      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          action: 'SCORE_ADJUSTMENT_REQUESTED',
          actorId: evaluator.id,
        },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.actorId).toBe(evaluator.id);
    });

    it('approves score adjustment atomically and records reviewer metadata', async () => {
      const evaluator = await makeUser('EVALUATOR');
      const admin = await makeUser('ADMIN');
      const team = await makeSquad(`ADJ_TEST_SQUAD_${Date.now()}`);

      const created = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 3,
          points: 100,
          reason: 'Demonstrated complete remote code execution bypass via unlisted API route.',
        },
        { id: evaluator.id, username: evaluator.username },
      );

      const approved = await approveScoreAdjustment(created.id, {
        id: admin.id,
        username: admin.username,
      });

      expect(approved.status).toBe('APPROVED');
      expect(approved.reviewedByUserId).toBe(admin.id);
      expect(approved.reviewedByUsername).toBe(admin.username);
      expect(approved.reviewedAt).not.toBeNull();

      // Check audit log entry
      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          action: 'SCORE_ADJUSTMENT_APPROVED',
          actorId: admin.id,
        },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.actorId).toBe(admin.id);

      // Concurrency / duplicate approval prevention
      await expect(
        approveScoreAdjustment(created.id, {
          id: admin.id,
          username: admin.username,
        }),
      ).rejects.toThrow('This adjustment has already been approved');
    });

    it('rejects score adjustment with mandatory reason', async () => {
      const evaluator = await makeUser('EVALUATOR');
      const admin = await makeUser('ADMIN');
      const team = await makeSquad(`ADJ_TEST_SQUAD_${Date.now()}`);

      const created = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 1,
          points: 50,
          reason: 'Discretionary bonus recommendation for high speed completion.',
        },
        { id: evaluator.id, username: evaluator.username },
      );

      // Rejection with short reason should fail
      await expect(
        rejectScoreAdjustment(created.id, 'bad', {
          id: admin.id,
          username: admin.username,
        }),
      ).rejects.toThrow('A valid rejection reason of at least 5 characters is required');

      const rejected = await rejectScoreAdjustment(
        created.id,
        'Speed is already naturally scored by submission timestamp; bonus rejected.',
        {
          id: admin.id,
          username: admin.username,
        },
      );

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toContain('Speed is already naturally scored');
      expect(rejected.reviewedByUserId).toBe(admin.id);

      // Attempting to approve rejected request should fail
      await expect(
        approveScoreAdjustment(created.id, {
          id: admin.id,
          username: admin.username,
        }),
      ).rejects.toThrow('This adjustment was already rejected');
    });
  });

  describe('Leaderboard Integration', () => {
    it('applies approved adjustments to standings while ignoring pending and rejected adjustments', async () => {
      const evaluator = await makeUser('EVALUATOR');
      const admin = await makeUser('ADMIN');
      const team = await makeSquad(`ADJ_TEST_SQUAD_${Date.now()}`);

      // 1. Pending adjustment (+150 PTS on Level 2)
      const pendingAdj = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 2,
          points: 150,
          reason: 'Exceptional report quality in Station 4.',
        },
        { id: evaluator.id, username: evaluator.username },
      );

      // Standings before approval: adjustment should NOT count
      let standings = await getLeaderboardStandings();
      let teamRow = standings.rows.find((s) => s.id === team.id);
      expect(teamRow).toBeDefined();
      expect(teamRow?.levelAdjustmentScores?.[2]).toBe(0);

      // 2. Approve the Level 2 adjustment
      await approveScoreAdjustment(pendingAdj.id, {
        id: admin.id,
        username: admin.username,
      });

      // 3. Create and immediately reject a Level 3 adjustment (+200 PTS)
      const rejectedAdj = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 3,
          points: 200,
          reason: 'Excessive points requested without attached proof.',
        },
        { id: evaluator.id, username: evaluator.username },
      );
      await rejectScoreAdjustment(rejectedAdj.id, 'Insufficient proof provided for 200 points.', {
        id: admin.id,
        username: admin.username,
      });

      // 4. Create and approve a Level 1 adjustment (+40 PTS)
      const level1Adj = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 1,
          points: 40,
          reason: 'Creative flag recovery technique.',
        },
        { id: evaluator.id, username: evaluator.username },
      );
      await approveScoreAdjustment(level1Adj.id, {
        id: admin.id,
        username: admin.username,
      });

      // Standings after approvals:
      standings = await getLeaderboardStandings();
      teamRow = standings.rows.find((s) => s.id === team.id);

      expect(teamRow).toBeDefined();
      // Level 1: approved +40
      expect(teamRow?.levelAdjustmentScores?.[1]).toBe(40);
      // Level 2: approved +150
      expect(teamRow?.levelAdjustmentScores?.[2]).toBe(150);
      // Level 3: rejected +200 -> counts as 0
      expect(teamRow?.levelAdjustmentScores?.[3]).toBe(0);

      // Total score includes approved adjustments: 40 + 150 = 190
      expect(teamRow?.totalScore).toBeGreaterThanOrEqual(190);
    });
  });

  describe('Filtering & Queries', () => {
    it('filters adjustments by status, level, and team correctly', async () => {
      const evaluator = await makeUser('EVALUATOR');
      const admin = await makeUser('ADMIN');
      const team = await makeSquad(`ADJ_TEST_SQUAD_${Date.now()}`);

      const adj1 = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 1,
          points: 20,
          reason: 'Consistent investigative methodology documented.',
        },
        { id: evaluator.id, username: evaluator.username },
      );

      const adj2 = await createScoreAdjustmentRequest(
        {
          teamId: team.id,
          level: 2,
          points: 30,
          reason: 'Novel network traffic anomaly uncovered in Station 1.',
        },
        { id: evaluator.id, username: evaluator.username },
      );

      await approveScoreAdjustment(adj1.id, {
        id: admin.id,
        username: admin.username,
      });

      // Query team adjustments
      const teamAdjustments = await getTeamScoreAdjustments(team.id);
      expect(teamAdjustments).toHaveLength(2);

      // Query with status filter: APPROVED
      const approvedQuery = await getScoreAdjustments({
        teamId: team.id,
        status: 'APPROVED',
      });
      expect(approvedQuery.adjustments).toHaveLength(1);
      expect(approvedQuery.adjustments[0]?.id).toBe(adj1.id);

      // Query with status filter: PENDING
      const pendingQuery = await getScoreAdjustments({
        teamId: team.id,
        status: 'PENDING',
      });
      expect(pendingQuery.adjustments).toHaveLength(1);
      expect(pendingQuery.adjustments[0]?.id).toBe(adj2.id);

      // Query with level filter: 2
      const level2Query = await getScoreAdjustments({
        teamId: team.id,
        level: 2,
      });
      expect(level2Query.adjustments).toHaveLength(1);
      expect(level2Query.adjustments[0]?.id).toBe(adj2.id);
    });
  });

  describe('Server Action RBAC & Security Boundaries', () => {
    it('rejects anonymous session from requesting score adjustments', async () => {
      const getSessionSpy = vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(null);
      const res = await requestScoreAdjustmentAction({
        teamId: 'some-team',
        level: 1,
        points: 50,
        reason: 'Attempted unauthenticated adjustment request.',
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Authentication required/i);
      getSessionSpy.mockRestore();
    });

    it('rejects PARTICIPANT role from requesting score adjustments', async () => {
      const participant = await makeUser('PARTICIPANT');
      const getSessionSpy = mockSession(participant);
      const res = await requestScoreAdjustmentAction({
        teamId: 'some-team',
        level: 1,
        points: 50,
        reason: 'Participant attempting to award their squad points.',
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Unauthorized/i);
      getSessionSpy.mockRestore();
    });

    it('allows EVALUATOR to request score adjustments, but denies them approval authority', async () => {
      const evaluator = await makeUser('EVALUATOR');
      const team = await makeSquad(`ADJ_TEST_RBAC_${Date.now()}`);

      const getSessionSpy = mockSession(evaluator);

      // Evaluator creates request
      const reqRes = await requestScoreAdjustmentAction({
        teamId: team.id,
        level: 2,
        points: 1000,
        reason: 'Outstanding reverse-engineering breakdown of stage 2 telemetry.',
      });
      expect(reqRes.success).toBe(true);
      expect(reqRes.data?.status).toBe('PENDING');
      expect(reqRes.data?.points).toBe(1000);

      // Evaluator attempts to self-approve
      const approveRes = await approveScoreAdjustmentAction(reqRes.data!.id);
      expect(approveRes.success).toBe(false);
      expect(approveRes.error).toMatch(/Unauthorized.*Admin/i);

      getSessionSpy.mockRestore();
    });

    it('allows ADMIN to approve and reject score adjustments', async () => {
      const evaluator = await makeUser('EVALUATOR');
      const admin = await makeUser('ADMIN');
      const team = await makeSquad(`ADJ_TEST_RBAC_ADM_${Date.now()}`);

      // Request created by evaluator
      let getSessionSpy = mockSession(evaluator);
      const reqRes = await requestScoreAdjustmentAction({
        teamId: team.id,
        level: 3,
        points: 250,
        reason: 'Flawless exploit payload mitigation documented with zero regressions.',
      });
      expect(reqRes.success).toBe(true);
      getSessionSpy.mockRestore();

      // Approved by admin
      getSessionSpy = mockSession(admin);
      const approveRes = await approveScoreAdjustmentAction(reqRes.data!.id);
      expect(approveRes.success).toBe(true);
      expect(approveRes.data?.status).toBe('APPROVED');
      expect(approveRes.data?.reviewedByUserId).toBe(admin.id);
      getSessionSpy.mockRestore();

      // Create another to test rejection by admin
      getSessionSpy = mockSession(evaluator);
      const reqRes2 = await requestScoreAdjustmentAction({
        teamId: team.id,
        level: 1,
        points: 100,
        reason: 'Requested bonus for quick completion of level 1.',
      });
      expect(reqRes2.success).toBe(true);
      getSessionSpy.mockRestore();

      getSessionSpy = mockSession(admin);
      const rejectRes = await rejectScoreAdjustmentAction(
        reqRes2.data!.id,
        'Speed is already calculated automatically in leaderboard rankings.',
      );
      expect(rejectRes.success).toBe(true);
      expect(rejectRes.data?.status).toBe('REJECTED');
      expect(rejectRes.data?.rejectionReason).toContain('Speed is already calculated');
      getSessionSpy.mockRestore();
    });
  });
});
