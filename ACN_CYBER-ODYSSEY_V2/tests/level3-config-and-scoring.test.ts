import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import * as sessionModule from '@/lib/auth/session';
import {
  isValidIpv4,
  isIpv6Shaped,
  parseTargetIp,
  getLevel3Config,
  updateLevel3Config,
} from '@/lib/level3/target-config';
import {
  getLevel3ScoreSummary,
  getLevel3EvaluatedPoints,
  LEVEL3_REPORT_KEY,
  LEVEL3_RESPONSE_KEY,
} from '@/lib/level3/score-summary';
import {
  setLevel3TargetIpAction,
  setLevel3Track2ReleasedAction,
  setLevel3TrackPointsAction,
  getLevel3ConfigAction,
} from '@/lib/actions/level3-config-actions';
import {
  saveLevelResource,
  removeLevelResource,
  getPublishedLevelResource,
  getLevelResources,
} from '@/lib/event/level-resources';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

/**
 * Level 3 — Creator-configurable target IP, sample report, and the corrected
 * scoring model.
 *
 * Two properties are under test throughout:
 *
 *   1. NOTHING PARTICIPANT-FACING IS A LITERAL. The target address and every
 *      point figure are read from the database, so a Creator change reaches
 *      participants without a redeploy.
 *
 *   2. ONE AUTHORITATIVE NUMBER. The figure the participant sees, the maximum
 *      the evaluator scores against, and the maximum an Admin approves are the
 *      same rows — not three copies that can drift.
 */

const REPORT_POINTS = 200;

/**
 * The Level 3 Response criterion is RETIRED: the final report carries the
 * level's whole evaluated value. Kept at 0 so the keyed lookup still resolves.
 */
const RESPONSE_POINTS = 0;
const TRACK1 = 3500;
const TRACK2_CUMULATIVE = 6500;

let seq = 0;

async function makeUser(role: 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN' | 'CREATOR') {
  seq++;
  const tag = `l3cfg_${role.toLowerCase()}_${seq}_${Date.now()}`;
  return prisma.user.create({
    data: {
      email: `${tag}@level3-config.test`,
      username: tag,
      passwordHash: await hashPassword('TestPass!2026'),
      role,
      status: 'ACTIVE',
    },
  });
}

function mockSession(user: { id: string; role: string; status: string; username: string } | null) {
  vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(user as never);
}

/** Smallest byte sequence that passes the SAMPLE_REPORT magic-byte check. */
function pdfFile(name: string, marker: string): File {
  const bytes = Buffer.from(`%PDF-1.7\n% ${marker}\n`, 'utf8');
  return new File([bytes], name, { type: 'application/pdf' });
}

/**
 * Restores the two keyed Level 3 criteria the seed installs — AND the level
 * maximum they break down.
 *
 * `LevelState.maxScore` is the authoritative ceiling; a rubric is a breakdown of
 * it and is ignored when the two disagree (see lib/evaluation/level-max-score.ts).
 * Seeding the criteria without the matching level maximum is itself the
 * misconfiguration, so the fixture now sets both.
 */
async function seedLevel3Criteria() {
  await prisma.levelState.upsert({
    where: { levelNumber: 3 },
    update: { maxScore: REPORT_POINTS + RESPONSE_POINTS },
    create: {
      levelNumber: 3,
      name: 'Level 3',
      codename: 'LEVEL_3',
      status: 'LOCKED',
      maxScore: REPORT_POINTS + RESPONSE_POINTS,
      durationMinutes: 120,
      durationSeconds: 7200,
      remainingSeconds: 7200,
    },
  });
  await prisma.evaluationCriterion.deleteMany({ where: { levelNumber: 3 } });
  await prisma.evaluationCriterion.createMany({
    data: [
      {
        id: 'l3_crit_report',
        key: LEVEL3_REPORT_KEY,
        levelNumber: 3,
        title: 'Final Investigation Report',
        maxPoints: REPORT_POINTS,
        sortOrder: 1,
        isActive: true,
        required: true,
      },
      {
        id: 'l3_crit_response',
        key: LEVEL3_RESPONSE_KEY,
        levelNumber: 3,
        title: 'Level 3 Response (retired)',
        maxPoints: RESPONSE_POINTS,
        sortOrder: 2,
        isActive: false,
        required: true,
      },
    ],
  });
}

async function resetConfig() {
  await prisma.level3Config.deleteMany({});
}

describe('Level 3 — Creator configuration and corrected scoring', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetConfig();
    await seedLevel3Criteria();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.user.deleteMany({ where: { email: { contains: '@level3-config.test' } } });
    await prisma.level3Config.deleteMany({});
    await prisma.levelResource.deleteMany({ where: { levelNumber: 3 } });
  });

  // =========================================================================
  // IPv4 VALIDATION  (task TEST 8 — invalid IP)
  // =========================================================================
  describe('IPv4 validation', () => {
    it('accepts well-formed dotted-quad addresses', () => {
      for (const ok of ['10.20.30.40', '192.168.10.25', '0.0.0.0', '255.255.255.255', '8.8.8.8']) {
        expect(isValidIpv4(ok), ok).toBe(true);
      }
    });

    it('rejects every malformed value the brief calls out', () => {
      for (const bad of ['hello-world', '999.999.999.999', '1234', 'javascript:test', '']) {
        expect(isValidIpv4(bad), bad).toBe(false);
      }
    });

    it('rejects wrong octet counts, out-of-range octets and non-numeric octets', () => {
      for (const bad of [
        '10.20.30',
        '10.20.30.40.50',
        '10.20.30.256',
        '10.20.30.-1',
        '10.20.30.4a',
        '1e2.1.1.1',
        '0x7f.0.0.1',
        ' 10.0.0.1',
        '10.0.0.1 ',
      ]) {
        expect(isValidIpv4(bad), bad).toBe(false);
      }
    });

    it('rejects leading-zero octets, which some resolvers read as octal', () => {
      // 010.1.1.1 is 8.1.1.1 to inet_aton. A participant pasting what they were
      // shown would reach a different host than the one the Creator intended.
      expect(isValidIpv4('010.1.1.1')).toBe(false);
      expect(isValidIpv4('10.01.1.1')).toBe(false);
      // A single zero octet is legitimate and must still pass.
      expect(isValidIpv4('10.0.1.1')).toBe(true);
    });

    it('detects and explicitly rejects IPv6 rather than silently storing it', () => {
      for (const v6 of ['::1', '2001:db8::1', 'fe80::1%eth0', '::ffff:10.0.0.1']) {
        expect(isIpv6Shaped(v6), v6).toBe(true);
        const parsed = parseTargetIp(v6);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.error).toContain('IPv6');
      }
    });

    it('treats an empty string as "clear the target", not as an error', () => {
      const parsed = parseTargetIp('   ');
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toBeNull();
    });
  });

  // =========================================================================
  // TARGET IP — add / replace / remove  (task TESTS 1, 2, 5)
  // =========================================================================
  describe('Target IP lifecycle', () => {
    it('TEST 1 — a Creator sets the IP and the participant read returns that value', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      const res = await setLevel3TargetIpAction('10.20.30.40');
      expect(res.success).toBe(true);
      expect(res.data?.targetIp).toBe('10.20.30.40');

      // The participant page reads through getLevel3ScoreSummary, with no session.
      mockSession(null);
      const summary = await getLevel3ScoreSummary();
      expect(summary.targetIp).toBe('10.20.30.40');
    });

    it('TEST 2 — changing the IP replaces it; no earlier value survives', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      await setLevel3TargetIpAction('10.20.30.40');
      const changed = await setLevel3TargetIpAction('10.20.30.50');
      expect(changed.success).toBe(true);

      const summary = await getLevel3ScoreSummary();
      expect(summary.targetIp).toBe('10.20.30.50');
      expect(summary.targetIp).not.toBe('10.20.30.40');

      // Exactly one configuration row — a change updates, never accumulates.
      expect(await prisma.level3Config.count()).toBe(1);
    });

    it('clears the target, leaving the participant read null rather than stale', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      await setLevel3TargetIpAction('10.20.30.40');
      const cleared = await setLevel3TargetIpAction('');
      expect(cleared.success).toBe(true);
      expect(cleared.data?.targetIp).toBeNull();

      expect((await getLevel3ScoreSummary()).targetIp).toBeNull();
    });

    it('TEST 8 — rejects invalid addresses through the action and writes nothing', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);
      await setLevel3TargetIpAction('10.20.30.40');

      for (const bad of [
        'hello-world',
        '999.999.999.999',
        '1234',
        'javascript:test',
        '2001:db8::1',
      ]) {
        const res = await setLevel3TargetIpAction(bad);
        expect(res.success, bad).toBe(false);
        expect(res.error, bad).toBeTruthy();
        // The previously configured value is untouched by a rejected write.
        expect((await getLevel3Config()).targetIp).toBe('10.20.30.40');
      }
    });

    it('records an audit entry naming the previous and new value', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      await setLevel3TargetIpAction('10.20.30.40');
      await setLevel3TargetIpAction('10.20.30.50');

      const log = await prisma.auditLog.findFirst({
        where: { actorId: creator.id, action: 'LEVEL3_TARGET_IP_UPDATED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).toBeTruthy();
      expect(log?.details).toContain('10.20.30.40');
      expect(log?.details).toContain('10.20.30.50');
    });
  });

  // =========================================================================
  // AUTHORIZATION  (task TESTS 6, 7)
  // =========================================================================
  describe('Creator-only authorization', () => {
    it('TEST 6 — a participant calling the configuration action is refused and changes nothing', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);
      await setLevel3TargetIpAction('10.20.30.40');

      const participant = await makeUser('PARTICIPANT');
      mockSession(participant);

      const res = await setLevel3TargetIpAction('66.66.66.66');
      expect(res.success).toBe(false);
      expect(res.error).toContain('permission');
      expect((await getLevel3Config()).targetIp).toBe('10.20.30.40');
    });

    it('refuses evaluators and admins — configuration is the Creator’s, per existing RBAC', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);
      await setLevel3TargetIpAction('10.20.30.40');

      for (const role of ['EVALUATOR', 'ADMIN'] as const) {
        const user = await makeUser(role);
        mockSession(user);
        const res = await setLevel3TargetIpAction('66.66.66.66');
        expect(res.success, role).toBe(false);
        expect((await getLevel3Config()).targetIp, role).toBe('10.20.30.40');
      }
    });

    it('refuses an anonymous caller', async () => {
      mockSession(null);
      const res = await setLevel3TargetIpAction('66.66.66.66');
      expect(res.success).toBe(false);
      expect(await prisma.level3Config.count()).toBe(0);
    });

    it('refuses a SUSPENDED creator — status is checked, not just role', async () => {
      const creator = await makeUser('CREATOR');
      mockSession({ ...creator, status: 'SUSPENDED' });
      const res = await setLevel3TargetIpAction('10.20.30.40');
      expect(res.success).toBe(false);
    });

    it('gates the configuration READ behind the same Creator check', async () => {
      const participant = await makeUser('PARTICIPANT');
      mockSession(participant);
      expect((await getLevel3ConfigAction()).success).toBe(false);

      const creator = await makeUser('CREATOR');
      mockSession(creator);
      expect((await getLevel3ConfigAction()).success).toBe(true);
    });

    it('TEST 7 — configuration is a single scoped row; a second cannot be created alongside it', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      await setLevel3TargetIpAction('10.20.30.40');
      await setLevel3Track2ReleasedAction(true);
      await setLevel3TrackPointsAction({ track1Points: 3500, track2Points: 6500 });

      // Every mutation addresses the same primary key. There is no client-supplied
      // id, event id or path anywhere in the write path, so there is no parameter
      // a caller could change to reach a different event's configuration.
      const rows = await prisma.level3Config.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('default');
    });

    it('ignores client-supplied identity — the actor comes from the session', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);
      await setLevel3TargetIpAction('10.20.30.40');

      const row = await prisma.level3Config.findUnique({ where: { id: 'default' } });
      expect(row?.updatedById).toBe(creator.id);
    });
  });

  // =========================================================================
  // SCORING MODEL  (task TESTS 8-13)
  // =========================================================================
  describe('Corrected Level 3 scoring model', () => {
    it('TEST 9 — report score is 200, read from the keyed criterion', async () => {
      expect((await getLevel3EvaluatedPoints()).reportPoints).toBe(200);
      expect((await getLevel3ScoreSummary()).reportPoints).toBe(200);
    });

    it('TEST 8 — the retired Response criterion contributes nothing', async () => {
      // Level 3's evaluated value is carried entirely by the Final Report. The
      // Response criterion is retired (inactive), so it must add zero rather
      // than quietly re-entering the ceiling.
      expect((await getLevel3EvaluatedPoints()).responsePoints).toBe(0);
      expect((await getLevel3ScoreSummary()).responsePoints).toBe(0);
      expect((await getLevel3ScoreSummary()).evaluatedPoints).toBe(REPORT_POINTS);
    });

    it('TEST 10 — Track 1, before Track 2 is released, is 3500', async () => {
      const summary = await getLevel3ScoreSummary();
      expect(summary.track1Points).toBe(TRACK1);
      expect(summary.track2Released).toBe(false);
      expect(summary.availableDiscoveryPoints).toBe(TRACK1);
    });

    it('TEST 11 — releasing Track 2 makes the cumulative 6500 the available ceiling', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      const released = await setLevel3Track2ReleasedAction(true);
      expect(released.success).toBe(true);

      const summary = await getLevel3ScoreSummary();
      expect(summary.track2Points).toBe(TRACK2_CUMULATIVE);
      expect(summary.track2Released).toBe(true);
      expect(summary.availableDiscoveryPoints).toBe(TRACK2_CUMULATIVE);
    });

    it('TEST 13 — Track 2 REPLACES Track 1; the two are never summed', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);
      await setLevel3Track2ReleasedAction(true);

      const summary = await getLevel3ScoreSummary();

      // The double-counting bug this guards against would give 10,000.
      expect(summary.availableDiscoveryPoints).toBe(TRACK2_CUMULATIVE);
      expect(summary.availableDiscoveryPoints).not.toBe(TRACK1 + TRACK2_CUMULATIVE);
      expect(summary.availableTotalPoints).toBe(
        TRACK2_CUMULATIVE + REPORT_POINTS + RESPONSE_POINTS,
      );
      expect(summary.availableTotalPoints).toBe(6700);
    });

    it('computes the available total correctly in both track states', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      // Before release: 3500 discovery + 200 report
      expect((await getLevel3ScoreSummary()).availableTotalPoints).toBe(3700);

      await setLevel3Track2ReleasedAction(true);
      // After release: 6500 discovery + 200 report
      expect((await getLevel3ScoreSummary()).availableTotalPoints).toBe(6700);

      // fullTotalPoints is the post-release ceiling regardless of current state.
      await setLevel3Track2ReleasedAction(false);
      const summary = await getLevel3ScoreSummary();
      expect(summary.availableTotalPoints).toBe(3700);
      expect(summary.fullTotalPoints).toBe(6700);
    });

    it('TEST 12 — participant display and evaluator maximum come from the SAME rows', async () => {
      // The evaluator's maximum is the sum of ACTIVE criteria for the level —
      // exactly the rows getLevel3EvaluatedPoints reads. Deriving both from one
      // source is what makes them incapable of disagreeing.
      const activeCriteria = await prisma.evaluationCriterion.findMany({
        where: { levelNumber: 3, isActive: true },
        select: { maxPoints: true },
      });
      const evaluatorMax = activeCriteria.reduce((sum, c) => sum + c.maxPoints, 0);

      const summary = await getLevel3ScoreSummary();
      expect(summary.evaluatedPoints).toBe(evaluatorMax);
      expect(summary.evaluatedPoints).toBe(REPORT_POINTS);
    });

    it('follows an Admin editing a criterion, rather than holding its own copy', async () => {
      await prisma.evaluationCriterion.update({
        where: { id: 'l3_crit_report' },
        data: { maxPoints: 275 },
      });

      const summary = await getLevel3ScoreSummary();

      // The component figure follows the edit …
      expect(summary.reportPoints).toBe(275);

      // … but the LEVEL ceiling does not move on its own. 275 + 200 = 475 no
      // longer matches the configured 400, so the rubric is in disagreement and
      // the configured maximum still governs. Raising the ceiling is a separate,
      // deliberate edit at Admin -> Levels.
      expect(summary.evaluatedPoints).toBe(REPORT_POINTS + RESPONSE_POINTS);
    });

    it('moves the ceiling when the Admin updates the level maximum to match', async () => {
      await prisma.evaluationCriterion.update({
        where: { id: 'l3_crit_report' },
        data: { maxPoints: 275 },
      });
      await prisma.levelState.update({
        where: { levelNumber: 3 },
        data: { maxScore: 275 },
      });

      const summary = await getLevel3ScoreSummary();
      expect(summary.evaluatedPoints).toBe(275);
    });

    it('excludes a DEACTIVATED criterion, matching what the evaluator scores against', async () => {
      await prisma.evaluationCriterion.update({
        where: { id: 'l3_crit_response' },
        data: { isActive: false },
      });

      const evaluated = await getLevel3EvaluatedPoints();
      // The REPORT is what `criteriaConfigured` tracks, and deactivating the
      // (already retired) Response does not change that.
      expect(evaluated.criteriaConfigured).toBe(true);
      // Falls back to the published figure rather than reporting zero, and says
      // so through criteriaConfigured.
      expect(evaluated.reportPoints).toBe(REPORT_POINTS);
    });

    it('resolves criteria by KEY, so renaming one does not break the display', async () => {
      await prisma.evaluationCriterion.update({
        where: { id: 'l3_crit_response' },
        data: { title: 'Renamed By An Admin' },
      });

      const summary = await getLevel3ScoreSummary();
      expect(summary.responsePoints).toBe(RESPONSE_POINTS);
      expect(summary.criteriaConfigured).toBe(true);
    });

    it('refuses a Track 2 ceiling below Track 1 — the pair can never express double-counting', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      const res = await setLevel3TrackPointsAction({ track1Points: 3500, track2Points: 3000 });
      expect(res.success).toBe(false);
      expect(res.error?.toLowerCase()).toContain('cumulative');
    });

    it('rejects non-integer, negative and absurd track values', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      for (const bad of [
        { track1Points: -1, track2Points: 6500 },
        { track1Points: 3500.5, track2Points: 6500 },
        { track1Points: 3500, track2Points: 99_999_999 },
        { track1Points: NaN, track2Points: 6500 },
      ]) {
        const res = await setLevel3TrackPointsAction(
          bad as { track1Points: number; track2Points: number },
        );
        expect(res.success, JSON.stringify(bad)).toBe(false);
      }
    });

    it('creates the configuration row lazily on first read, with the published defaults', async () => {
      expect(await prisma.level3Config.count()).toBe(0);
      const config = await getLevel3Config();
      expect(config.track1Points).toBe(TRACK1);
      expect(config.track2Points).toBe(TRACK2_CUMULATIVE);
      expect(config.track2Released).toBe(false);
      expect(config.targetIp).toBeNull();
      expect(await prisma.level3Config.count()).toBe(1);
    });

    it('never awards anything — releasing Track 2 touches no squad score', async () => {
      const creator = await makeUser('CREATOR');
      mockSession(creator);

      const before = await prisma.team.findMany({ select: { id: true, score: true } });
      await setLevel3Track2ReleasedAction(true);
      await updateLevel3Config({ track1Points: 1, track2Points: 2 }, creator.id);
      const after = await prisma.team.findMany({ select: { id: true, score: true } });

      expect(after).toEqual(before);
      expect(await prisma.level3Discovery.count()).toBe(0);
    });
  });

  // =========================================================================
  // SAMPLE REPORT  (task TESTS 3, 4, 5)
  // =========================================================================
  describe('Sample report lifecycle', () => {
    afterAll(async () => {
      await prisma.levelResource.deleteMany({ where: { levelNumber: 3 } });
    });

    it('TEST 3 — a Creator uploads a sample report and it becomes available to participants', async () => {
      const creator = await makeUser('CREATOR');

      const saved = await saveLevelResource({
        levelNumber: 3,
        resourceKey: 'SAMPLE_REPORT',
        file: pdfFile('sample-level3-report.pdf', 'v1'),
        actorId: creator.id,
        actorUsername: creator.username,
      });

      expect(saved.originalName).toBe('sample-level3-report.pdf');
      expect(saved.isPublished).toBe(true);

      const published = await getPublishedLevelResource(3, 'SAMPLE_REPORT');
      expect(published).toBeTruthy();
      expect(fs.existsSync(published!.storagePath)).toBe(true);
    });

    it('TEST 4 — replacing the report serves v2 and removes v1 from disk', async () => {
      const creator = await makeUser('CREATOR');

      const v1 = await saveLevelResource({
        levelNumber: 3,
        resourceKey: 'SAMPLE_REPORT',
        file: pdfFile('sample-level3-report-v1.pdf', 'v1'),
        actorId: creator.id,
        actorUsername: creator.username,
      });
      const v1Path = (await getPublishedLevelResource(3, 'SAMPLE_REPORT'))!.storagePath;

      const v2 = await saveLevelResource({
        levelNumber: 3,
        resourceKey: 'SAMPLE_REPORT',
        file: pdfFile('sample-level3-report-v2.pdf', 'v2'),
        actorId: creator.id,
        actorUsername: creator.username,
      });

      expect(v2.originalName).toBe('sample-level3-report-v2.pdf');
      expect(v2.id).toBe(v1.id); // upserted, not duplicated

      const published = await getPublishedLevelResource(3, 'SAMPLE_REPORT');
      expect(published!.originalName).toBe('sample-level3-report-v2.pdf');
      expect(fs.readFileSync(published!.storagePath, 'utf8')).toContain('v2');
      expect(fs.existsSync(v1Path)).toBe(false);

      // Still exactly one row for the level+key pair.
      const all = await getLevelResources(3);
      expect(all.filter((r) => r.resourceKey === 'SAMPLE_REPORT')).toHaveLength(1);
    });

    it('TEST 5 — removing the report leaves nothing to link to, and no 404 to hit', async () => {
      const creator = await makeUser('CREATOR');

      await saveLevelResource({
        levelNumber: 3,
        resourceKey: 'SAMPLE_REPORT',
        file: pdfFile('sample-level3-report.pdf', 'v1'),
        actorId: creator.id,
        actorUsername: creator.username,
      });
      const storagePath = (await getPublishedLevelResource(3, 'SAMPLE_REPORT'))!.storagePath;

      const removed = await removeLevelResource({
        levelNumber: 3,
        resourceKey: 'SAMPLE_REPORT',
        actorId: creator.id,
        actorUsername: creator.username,
      });

      expect(removed).toBe(true);
      expect(await getPublishedLevelResource(3, 'SAMPLE_REPORT')).toBeNull();
      expect(fs.existsSync(storagePath)).toBe(false);

      // The participant page derives its button from exactly this: nothing
      // published means the neutral state renders, not a dead download.
      const resources = await getLevelResources(3);
      expect(resources.find((r) => r.resourceKey === 'SAMPLE_REPORT')).toBeUndefined();
    });

    it('rejects a non-PDF and a spoofed PDF extension', async () => {
      const creator = await makeUser('CREATOR');

      await expect(
        saveLevelResource({
          levelNumber: 3,
          resourceKey: 'SAMPLE_REPORT',
          file: new File([Buffer.from('PK\x03\x04zip')], 'report.zip', { type: 'application/zip' }),
          actorId: creator.id,
          actorUsername: creator.username,
        }),
      ).rejects.toThrow(/extension/i);

      // Right extension, wrong bytes — caught by the magic-byte check.
      await expect(
        saveLevelResource({
          levelNumber: 3,
          resourceKey: 'SAMPLE_REPORT',
          file: new File([Buffer.from('<html>not a pdf</html>')], 'report.pdf', {
            type: 'application/pdf',
          }),
          actorId: creator.id,
          actorUsername: creator.username,
        }),
      ).rejects.toThrow(/signature/i);
    });

    it('strips path traversal from the stored filename', async () => {
      const creator = await makeUser('CREATOR');

      const saved = await saveLevelResource({
        levelNumber: 3,
        resourceKey: 'SAMPLE_REPORT',
        file: pdfFile('../../../etc/passwd.pdf', 'traversal'),
        actorId: creator.id,
        actorUsername: creator.username,
      });

      expect(saved.originalName).not.toContain('..');
      expect(saved.originalName).not.toContain('/');

      const record = await getPublishedLevelResource(3, 'SAMPLE_REPORT');
      const resolved = path.resolve(record!.storagePath);
      const root = path.resolve(process.cwd(), 'uploads', 'resources');
      expect(resolved.startsWith(root)).toBe(true);
    });
  });
});

// ===========================================================================
// UI PLACEMENT — evaluator portal
// ===========================================================================
//
// These are SOURCE assertions, deliberately. The question they answer is "which
// component tree does this form live in", which is a property of the module
// graph, not of a rendered DOM — and rendering an async server component in
// vitest would prove less while costing a Next runtime. If the form is ever
// pasted back into the evaluation panel, this fails on the next run.
describe('Evaluator portal — score adjustment lives on exactly one page', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  /**
   * The fields the Additional Points Request form is built from. Matched
   * case-insensitively: the two pages label them differently in case
   * ("Target Squad" vs "TARGET SQUAD"), and the point is which component the
   * FIELD lives in, not how it is capitalised.
   */
  const ADJUSTMENT_FIELD_MARKERS = [
    /target squad/i,
    /justification\s*\/\s*rationale/i,
    /evidence reference/i,
    /additional points/i,
  ];

  /** The action that actually files a request. Its presence defines the form. */
  const ADJUSTMENT_ACTION = 'requestScoreAdjustmentAction';

  it('TEST 1 — the Evaluations panel renders no Additional Points Request form', () => {
    const src = read('src/components/evaluator/evaluation-panel.tsx');

    // The heading itself must be gone.
    expect(src).not.toMatch(/>\s*ADDITIONAL POINTS REQUEST\s*</);

    // And so must every field the form was built from. Checked outside comments
    // so the explanatory note left in its place cannot satisfy the assertion.
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const marker of ADJUSTMENT_FIELD_MARKERS) {
      expect(code, String(marker)).not.toMatch(marker);
    }

    // The action that files a request must not be reachable from this component.
    expect(code).not.toContain(ADJUSTMENT_ACTION);
    expect(code).not.toContain('handleRequestAdjustment');
  });

  it('TEST 2 — the Score Adjustments page renders the Additional Points Request form', () => {
    const src = read('src/components/evaluator/evaluator-score-adjustments-client.tsx');
    for (const marker of ADJUSTMENT_FIELD_MARKERS) {
      expect(src, String(marker)).toMatch(marker);
    }
    expect(src).toContain(ADJUSTMENT_ACTION);
    expect(src).toMatch(/ADDITIONAL POINTS REQUEST/);
  });

  it('routes the Score Adjustments page through the evaluator guard', () => {
    const page = read('src/app/evaluator/score-adjustments/page.tsx');
    expect(page).toContain('requireEvaluator');
    expect(page).toContain('EvaluatorScoreAdjustmentsClient');
  });

  it('keeps Score Adjustments in the Jury Desk navigation', () => {
    const sidebar = read('src/components/evaluator/evaluator-sidebar.tsx');
    expect(sidebar).toContain('/evaluator/score-adjustments');
  });

  it('does not duplicate the form onto Teams, Submissions or Overview', () => {
    for (const rel of [
      'src/components/evaluator/teams-client.tsx',
      'src/components/evaluator/submissions-client.tsx',
      'src/components/evaluator/dashboard-client.tsx',
    ]) {
      const src = read(rel);
      expect(src, rel).not.toContain('requestScoreAdjustmentAction');
    }
  });

  it('leaves the score-adjustment backend intact', () => {
    // The UI moved; the server action, service and Admin approval did not.
    expect(
      fs.existsSync(path.join(process.cwd(), 'src/lib/actions/score-adjustment-actions.ts')),
    ).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'src/lib/score-adjustments/service.ts'))).toBe(
      true,
    );
    const client = read('src/components/evaluator/evaluator-score-adjustments-client.tsx');
    expect(client).toContain(ADJUSTMENT_ACTION);
  });
});

// ===========================================================================
// UI — no hardcoded Level 3 values remain
// ===========================================================================
describe('Level 3 participant UI carries no hardcoded target or score', () => {
  const workspace = fs.readFileSync(
    path.join(process.cwd(), 'src/components/event/level-3-workspace.tsx'),
    'utf8',
  );

  it('renders the target address from the scoring summary, never a literal', () => {
    expect(workspace).toContain('scoring.targetIp');
    // No dotted-quad literal anywhere in the component.
    expect(workspace).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it('renders the approved report denominator from configuration, not 1000', () => {
    expect(workspace).toContain('{scoring.evaluatedPoints} PTS');
    expect(workspace).not.toContain('/ 1000 PTS');
  });

  it('renders the discovery track figures from the summary', () => {
    for (const expr of ['scoring.track1Points', 'scoring.track2Points']) {
      expect(workspace, expr).toContain(expr);
    }
  });

  it('does NOT render the evaluator rubric ceilings to participants', () => {
    // Removed with the "Evaluator scored" cards: the per-component maxima are
    // the evaluator's working figures, not participant information.
    for (const expr of ['scoring.reportPoints', 'scoring.responsePoints']) {
      expect(workspace, expr).not.toContain(expr);
    }
  });

  it('shows a neutral state instead of a dead sample-report link', () => {
    expect(workspace).toContain('NO SAMPLE REPORT PROVIDED');
    expect(workspace).toContain('sampleReport?.isAvailable');
  });
});
