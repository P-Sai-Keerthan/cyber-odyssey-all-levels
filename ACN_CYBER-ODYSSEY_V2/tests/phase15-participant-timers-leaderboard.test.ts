import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { generateTeamCode } from '@/lib/team/code-generator';
import {
  ensureLevelStatesExist,
  resetLevelStateVerificationCache,
  getLevelStates,
  getLevelState,
  startLevelState,
  pauseLevelState,
  resumeLevelState,
  stopLevelState,
  resetLevelState,
  configureLevelDuration,
} from '@/lib/event/level-state';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import { formatDate, formatTime, formatDateTime } from '@/lib/utils/date-formatter';

describe('Phase 15 — Participant Timers + Leaderboard UI Tests', () => {
  beforeEach(async () => {
    // Clean database tables before each test
    await prisma.evaluation.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.announcement.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.levelState.deleteMany({});

    // The level-state existence check is latched per process (PERF-17-05).
    // Truncating the table invalidates that latch, so clear it before reseeding.
    resetLevelStateVerificationCache();

    // Seed default level states
    await ensureLevelStatesExist();
  });

  // =========================================================================
  // 1. PARTICIPANT TIMERS: Synchronized Level States across Dashboard & Level Pages
  // =========================================================================
  describe('1. Authoritative Participant Timers (Dashboard & Level Pages)', () => {
    it('1. Participant dashboard retrieves authoritative timing states for Level 1, Level 2, and Level 3', async () => {
      const states = await getLevelStates();

      expect(states).toHaveLength(3);

      const lvl1 = states.find((s) => s.levelNumber === 1);
      const lvl2 = states.find((s) => s.levelNumber === 2);
      const lvl3 = states.find((s) => s.levelNumber === 3);

      expect(lvl1).toBeDefined();
      expect(lvl1?.codename).toBe('THE INITIAL TRACE');
      expect(lvl1?.status).toBe('LOCKED');

      expect(lvl2).toBeDefined();
      expect(lvl2?.codename).toBe("THE BOAR'S MARK");
      expect(lvl2?.status).toBe('LIVE');
      expect(lvl2?.endsAt).toBeTruthy();

      expect(lvl3).toBeDefined();
      expect(lvl3?.codename).toBe('THE TWELVE AXES');
      expect(lvl3?.status).toBe('LOCKED');
    });

    it('2. Individual Level pages query and receive the same authoritative LevelState record', async () => {
      const [allStates, lvl1Single, lvl2Single, lvl3Single] = await Promise.all([
        getLevelStates(),
        getLevelState(1),
        getLevelState(2),
        getLevelState(3),
      ]);

      const lvl1FromAll = allStates.find((s) => s.levelNumber === 1);
      const lvl2FromAll = allStates.find((s) => s.levelNumber === 2);
      const lvl3FromAll = allStates.find((s) => s.levelNumber === 3);

      // `remainingSeconds` is DERIVED from the clock at the moment each call
      // runs, so two independently-issued calls are not obliged to agree to the
      // second — they only have to be reading the same authoritative record.
      // Under SQLite the four queries returned fast enough to always land in the
      // same second and exact equality happened to hold; on PostgreSQL the real
      // round trips push them apart and the assertion failed at 7197 vs 7199.
      //
      // What the test is actually for is that the "all levels" path and the
      // "single level" path return the SAME LevelState. That is asserted exactly
      // on the stored fields (status, endsAt) and within a small tolerance on
      // the live countdown derived from them.
      const SAME_RECORD_TOLERANCE_SECONDS = 5;

      expect(lvl1Single?.status).toBe(lvl1FromAll?.status);
      expect(lvl1Single?.endsAt).toBe(lvl1FromAll?.endsAt);
      expect(
        Math.abs((lvl1Single?.remainingSeconds ?? 0) - (lvl1FromAll?.remainingSeconds ?? 0)),
      ).toBeLessThanOrEqual(SAME_RECORD_TOLERANCE_SECONDS);

      expect(lvl2Single?.status).toBe(lvl2FromAll?.status);
      expect(lvl2Single?.endsAt).toBe(lvl2FromAll?.endsAt);
      expect(
        Math.abs((lvl2Single?.remainingSeconds ?? 0) - (lvl2FromAll?.remainingSeconds ?? 0)),
      ).toBeLessThanOrEqual(SAME_RECORD_TOLERANCE_SECONDS);

      expect(lvl3Single?.status).toBe(lvl3FromAll?.status);
      expect(lvl3Single?.endsAt).toBe(lvl3FromAll?.endsAt);
      expect(
        Math.abs((lvl3Single?.remainingSeconds ?? 0) - (lvl3FromAll?.remainingSeconds ?? 0)),
      ).toBeLessThanOrEqual(SAME_RECORD_TOLERANCE_SECONDS);
    });

    it('3. When Level 1 is started by admin/creator, both Dashboard and Level 1 page reflect LIVE state with identical endsAt', async () => {
      const started = await startLevelState(1, null);

      expect(started.status).toBe('LIVE');
      expect(started.endsAt).toBeTruthy();

      const dashboardStates = await getLevelStates();
      const lvl1Dashboard = dashboardStates.find((s) => s.levelNumber === 1);

      const level1PageAccess = await checkAuthoritativeLevelAccess(1, true);

      expect(lvl1Dashboard?.status).toBe('LIVE');
      expect(lvl1Dashboard?.endsAt).toBe(started.endsAt);
      expect(level1PageAccess.allowed).toBe(true);
      expect(level1PageAccess.state?.status).toBe('LIVE');
      expect(level1PageAccess.state?.endsAt).toBe(started.endsAt);
    });

    it('4. Paused level preserves remaining seconds and synchronizes across all queries', async () => {
      const paused = await pauseLevelState(2, null);

      expect(paused.status).toBe('PAUSED');
      expect(paused.pausedAt).toBeTruthy();

      const dashboardStates = await getLevelStates();
      const lvl2Dashboard = dashboardStates.find((s) => s.levelNumber === 2);
      const level2PageAccess = await checkAuthoritativeLevelAccess(2, true);

      expect(lvl2Dashboard?.status).toBe('PAUSED');
      expect(lvl2Dashboard?.remainingSeconds).toBe(paused.remainingSeconds);

      expect(level2PageAccess.allowed).toBe(false);
      expect(level2PageAccess.isPaused).toBe(true);
      expect(level2PageAccess.state?.status).toBe('PAUSED');
    });

    it('5. Resumed level updates endsAt dynamically from preserved remaining seconds', async () => {
      await pauseLevelState(2, null);
      const resumed = await resumeLevelState(2, null);

      expect(resumed.status).toBe('LIVE');
      expect(resumed.endsAt).toBeTruthy();
      expect(resumed.pausedAt).toBeNull();

      const level2Access = await checkAuthoritativeLevelAccess(2, true);
      expect(level2Access.allowed).toBe(true);
      expect(level2Access.state?.endsAt).toBe(resumed.endsAt);
    });

    it('6. Reset level locks state back to LOCKED and resets duration', async () => {
      const reset = await resetLevelState(2, null);

      expect(reset.status).toBe('LOCKED');
      expect(reset.startedAt).toBeNull();
      expect(reset.endsAt).toBeNull();
      expect(reset.remainingSeconds).toBe(reset.durationSeconds);

      const level2Access = await checkAuthoritativeLevelAccess(2, true);
      expect(level2Access.allowed).toBe(false);
      expect(level2Access.reason).toContain('locked');
    });

    it('7. Configure level duration updates durationSeconds and dynamic remainingSeconds', async () => {
      const configured = await configureLevelDuration(1, 90, null);

      expect(configured.durationMinutes).toBe(90);
      expect(configured.durationSeconds).toBe(5400);
      expect(configured.remainingSeconds).toBe(5400);
    });
  });

  // =========================================================================
  // 2. EXPIRATION & SERVER-SIDE AUTHORIZATION ENFORCEMENT
  // =========================================================================
  describe('2. Expiration & Server-Side Security Enforcement', () => {
    it('8. Expired level automatically resolves status COMPLETED and isExpired true', async () => {
      // Create a level that ended 10 minutes ago
      const pastEnd = new Date(Date.now() - 10 * 60 * 1000);
      const pastStart = new Date(Date.now() - 70 * 60 * 1000);

      await prisma.levelState.update({
        where: { levelNumber: 2 },
        data: {
          status: 'LIVE',
          startedAt: pastStart,
          endsAt: pastEnd,
          remainingSeconds: 0,
        },
      });

      const state = await getLevelState(2);

      expect(state?.status).toBe('COMPLETED');
      expect(state?.isExpired).toBe(true);
      expect(state?.remainingSeconds).toBe(0);
    });

    it('9. Server access check rejects access when level is expired or completed', async () => {
      const pastEnd = new Date(Date.now() - 5000);

      await prisma.levelState.update({
        where: { levelNumber: 2 },
        data: {
          status: 'LIVE',
          endsAt: pastEnd,
        },
      });

      const access = await checkAuthoritativeLevelAccess(2, true);

      expect(access.allowed).toBe(false);
      expect(access.isCompleted).toBe(true);
      expect(access.reason).toContain('completed');
    });

    it('10. Participant cannot access level if not in an active team', async () => {
      const access = await checkAuthoritativeLevelAccess(2, false);

      expect(access.allowed).toBe(false);
      expect(access.reason).toContain('squad');
    });

    it('11. Client manipulation cannot alter authoritative server state', async () => {
      // Stopped level on server
      await stopLevelState(2, null);

      const serverState = await getLevelState(2);
      expect(serverState?.status).toBe('COMPLETED');

      // Regardless of what client might claim, server-side access check denies submission
      const access = await checkAuthoritativeLevelAccess(2, true);
      expect(access.allowed).toBe(false);
      expect(access.isCompleted).toBe(true);
    });
  });

  // =========================================================================
  // 3. LEADERBOARD: Data Integrity, Top 3 Podium & Privacy
  // =========================================================================
  describe('3. Leaderboard Data, Podium & Security', () => {
    it('12. Leaderboard query returns real team scores ordered by score DESC, updatedAt ASC', async () => {
      const passwordHash = await hashPassword('SecretPass123!');

      const creator = await prisma.user.create({
        data: {
          email: 'creator_lb@acn.org',
          username: 'creator_lb',
          passwordHash,
          role: 'CREATOR',
        },
      });

      // Create 4 teams with different scores and update times
      const teamAlpha = await prisma.team.create({
        data: {
          name: 'CYBER PHANTOMS',
          code: generateTeamCode(),
          passwordHash,
          creatorId: creator.id,
          score: 1200,
        },
      });

      const teamBeta = await prisma.team.create({
        data: {
          name: 'BYTE RAIDERS',
          code: generateTeamCode(),
          passwordHash,
          creatorId: creator.id,
          score: 1080,
        },
      });

      const teamGamma = await prisma.team.create({
        data: {
          name: 'ZERO DAY',
          code: generateTeamCode(),
          passwordHash,
          creatorId: creator.id,
          score: 940,
        },
      });

      const teamDelta = await prisma.team.create({
        data: {
          name: 'SHADOW RUNNERS',
          code: generateTeamCode(),
          passwordHash,
          creatorId: creator.id,
          score: 720,
        },
      });

      const leaderboardTeams = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          score: true,
          status: true,
          updatedAt: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      });

      expect(leaderboardTeams).toHaveLength(4);
      expect(leaderboardTeams[0]?.id).toBe(teamAlpha.id);
      expect(leaderboardTeams[0]?.name).toBe('CYBER PHANTOMS');
      expect(leaderboardTeams[0]?.score).toBe(1200);

      expect(leaderboardTeams[1]?.id).toBe(teamBeta.id);
      expect(leaderboardTeams[1]?.name).toBe('BYTE RAIDERS');
      expect(leaderboardTeams[1]?.score).toBe(1080);

      expect(leaderboardTeams[2]?.id).toBe(teamGamma.id);
      expect(leaderboardTeams[2]?.name).toBe('ZERO DAY');
      expect(leaderboardTeams[2]?.score).toBe(940);

      expect(leaderboardTeams[3]?.id).toBe(teamDelta.id);
      expect(leaderboardTeams[3]?.name).toBe('SHADOW RUNNERS');
      expect(leaderboardTeams[3]?.score).toBe(720);
    });

    it('13. PRIVACY MANDATE: Team join code and passwordHash are NEVER selected or leaked in leaderboard', async () => {
      const passwordHash = await hashPassword('SecretPass123!');
      const teamCode = generateTeamCode();

      const user = await prisma.user.create({
        data: {
          email: 'lb_privacy@acn.org',
          username: 'lb_privacy',
          passwordHash,
          role: 'PARTICIPANT',
        },
      });

      await prisma.team.create({
        data: {
          name: 'STEALTH UNIT',
          code: teamCode,
          passwordHash,
          creatorId: user.id,
          score: 500,
        },
      });

      const sanitizedResult = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          score: true,
          status: true,
          updatedAt: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
      });

      expect(sanitizedResult[0]).toBeDefined();
      expect(sanitizedResult[0]).not.toHaveProperty('code');
      expect(sanitizedResult[0]).not.toHaveProperty('passwordHash');
    });

    it('14. Tied scores are resolved deterministically using updatedAt ASC tiebreaker', async () => {
      const passwordHash = await hashPassword('SecretPass123!');

      const user = await prisma.user.create({
        data: {
          email: 'tie_user@acn.org',
          username: 'tie_user',
          passwordHash,
          role: 'PARTICIPANT',
        },
      });

      // Team 1 achieved 800 earlier
      const t1 = await prisma.team.create({
        data: {
          name: 'EARLY ACHIEVER',
          code: generateTeamCode(),
          passwordHash,
          creatorId: user.id,
          score: 800,
          updatedAt: new Date(2026, 7, 31, 10, 0, 0),
        },
      });

      // Team 2 achieved 800 later
      const t2 = await prisma.team.create({
        data: {
          name: 'LATER ACHIEVER',
          code: generateTeamCode(),
          passwordHash,
          creatorId: user.id,
          score: 800,
          updatedAt: new Date(2026, 7, 31, 11, 0, 0),
        },
      });

      const teams = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, score: true, updatedAt: true },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      });

      expect(teams[0]?.id).toBe(t1.id);
      expect(teams[1]?.id).toBe(t2.id);
    });

    it('15. Disqualified and blocked squads are excluded from the active participant leaderboard', async () => {
      const passwordHash = await hashPassword('SecretPass123!');

      const user = await prisma.user.create({
        data: {
          email: 'dq_user@acn.org',
          username: 'dq_user',
          passwordHash,
          role: 'PARTICIPANT',
        },
      });

      await prisma.team.create({
        data: {
          name: 'DISQUALIFIED SQUAD',
          code: generateTeamCode(),
          passwordHash,
          creatorId: user.id,
          score: 9999,
          status: 'DISQUALIFIED',
        },
      });

      await prisma.team.create({
        data: {
          name: 'VALID SQUAD',
          code: generateTeamCode(),
          passwordHash,
          creatorId: user.id,
          score: 500,
          status: 'ACTIVE',
        },
      });

      const activeLeaderboard = await prisma.team.findMany({
        where: { status: 'ACTIVE' },
        select: { name: true, score: true },
      });

      expect(activeLeaderboard).toHaveLength(1);
      expect(activeLeaderboard[0]?.name).toBe('VALID SQUAD');
    });
  });

  // =========================================================================
  // 4. DETERMINISTIC DATE/TIME UTILITIES & HYDRATION SAFETY
  // =========================================================================
  describe('4. Deterministic Date/Time Formatting & Hydration Safety', () => {
    it('16. formatDate outputs identical deterministic string independent of client locale', () => {
      const testDate = new Date('2026-08-31T10:30:00.000Z');
      const formatted = formatDate(testDate);

      expect(formatted).toBe('Aug 31, 2026');
    });

    it('17. formatTime outputs deterministic UTC time string without locale drift', () => {
      const testDate = new Date('2026-08-31T14:45:30.000Z');
      const formatted = formatTime(testDate);

      expect(formatted).toBe('14:45:30');
    });

    it('18. formatDateTime outputs deterministic full timestamp for logs and deliverables', () => {
      const testDate = new Date('2026-08-31T14:45:30.000Z');
      const formatted = formatDateTime(testDate);

      expect(formatted).toBe('Aug 31, 2026, 14:45:30');
    });

    it('19. Handles null and undefined timestamps gracefully without throwing or mismatching', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatTime(undefined)).toBe('—');
      expect(formatDateTime(null, 'N/A')).toBe('N/A');
    });
  });
});
