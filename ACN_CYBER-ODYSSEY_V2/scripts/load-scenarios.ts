/**
 * Scenario-based load harness for the real event shape.
 *
 *   npm run seed:event-fixture     # once, to create 50 squads / 210 participants
 *   npm run load:scenarios         # then measure
 *   LOAD_STRESS=1 npm run load:scenarios   # also probe past expected load
 *
 * WHAT THIS MEASURES — AND WHAT IT DOES NOT
 * ------------------------------------------
 * Each scenario replays the query and hashing work a real request performs, at
 * realistic concurrency, against the real schema and indexes. Scenario A also
 * exercises `crypto.scrypt`, which is CPU-bound on the libuv threadpool and is
 * often the true login bottleneck rather than the database.
 *
 * It does NOT exercise HTTP, React server rendering, cookie parsing or TLS.
 * A pass here is evidence about the DATA and CPU layers, not proof that the
 * deployed server sustains 210 concurrent browsers. That distinction is carried
 * through into docs/production-readiness.md and is never blurred.
 *
 * Scenarios are deliberately REALISTIC rather than maximal: participants read far
 * more than they write, and writes cluster at deadlines. A test in which every
 * user writes simultaneously would measure a workload that never occurs.
 */
import * as os from 'os';
import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '../src/lib/auth/password';
import { countVisibleAnnouncements } from '../src/lib/event/announcements';
import { CRITICAL_WRITE_TX } from '../src/lib/db/transaction';

const prisma = new PrismaClient();

const FIXTURE_EMAIL_DOMAIN = '@loadtest.invalid';
const FIXTURE_TEAM_PREFIX = 'LOADTEST ';
const FIXTURE_PASSWORD = 'LoadTestFixture!2026';

/** Acceptance thresholds. Deliberately conservative for an in-venue event. */
const THRESHOLDS = {
  readP95Ms: 1500,
  writeP95Ms: 3000,
  loginP95Ms: 5000,
  maxErrorRate: 0.0,
};

interface ScenarioResult {
  id: string;
  name: string;
  kind: 'read' | 'write' | 'login';
  operations: number;
  totalMs: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  opsPerSecond: number;
  errors: number;
  firstError: string | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

async function measure(
  id: string,
  name: string,
  kind: ScenarioResult['kind'],
  concurrency: number,
  op: (i: number) => Promise<unknown>,
): Promise<ScenarioResult> {
  const durations: number[] = [];
  let errors = 0;
  let firstError: string | null = null;

  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async (_, i) => {
      const t0 = performance.now();
      try {
        await op(i);
      } catch (e) {
        errors++;
        if (!firstError) {
          firstError =
            e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 160) : String(e);
        }
      }
      durations.push(performance.now() - t0);
    }),
  );
  const totalMs = performance.now() - started;
  const sorted = [...durations].sort((a, b) => a - b);

  return {
    id,
    name,
    kind,
    operations: durations.length,
    totalMs,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    opsPerSecond: (durations.length / totalMs) * 1000,
    errors,
    firstError,
  };
}

function thresholdFor(kind: ScenarioResult['kind']): number {
  return kind === 'login'
    ? THRESHOLDS.loginP95Ms
    : kind === 'write'
      ? THRESHOLDS.writeP95Ms
      : THRESHOLDS.readP95Ms;
}

function verdict(r: ScenarioResult): 'PASS' | 'FAIL' {
  const errorRate = r.errors / Math.max(1, r.operations);
  return errorRate <= THRESHOLDS.maxErrorRate && r.p95 <= thresholdFor(r.kind) ? 'PASS' : 'FAIL';
}

function printResults(results: ScenarioResult[]) {
  console.warn('\n' + '='.repeat(108));
  console.warn('SCENARIO RESULTS — DATA + CPU LAYER (not HTTP)');
  console.warn('='.repeat(108));
  console.warn(
    'scenario'.padEnd(46) +
      'ops'.padStart(6) +
      'p50'.padStart(9) +
      'p95'.padStart(9) +
      'p99'.padStart(9) +
      'ops/s'.padStart(10) +
      'err'.padStart(6) +
      '  verdict',
  );
  console.warn('-'.repeat(108));
  for (const r of results) {
    console.warn(
      `${r.id} ${r.name}`.padEnd(46) +
        String(r.operations).padStart(6) +
        `${r.p50.toFixed(0)}ms`.padStart(9) +
        `${r.p95.toFixed(0)}ms`.padStart(9) +
        `${r.p99.toFixed(0)}ms`.padStart(9) +
        r.opsPerSecond.toFixed(0).padStart(10) +
        String(r.errors).padStart(6) +
        '  ' +
        verdict(r),
    );
  }
  console.warn('='.repeat(108));
  console.warn(
    `Thresholds — read p95 <= ${THRESHOLDS.readP95Ms}ms, write p95 <= ${THRESHOLDS.writeP95Ms}ms, ` +
      `login p95 <= ${THRESHOLDS.loginP95Ms}ms, error rate = 0`,
  );
  for (const r of results) {
    if (r.firstError) console.warn(`  ! ${r.id}: ${r.firstError}`);
  }
}

async function main() {
  const [teamCount, participantCount] = await Promise.all([
    prisma.team.count({ where: { name: { startsWith: FIXTURE_TEAM_PREFIX } } }),
    prisma.user.count({
      where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'PARTICIPANT' },
    }),
  ]);

  if (teamCount === 0 || participantCount === 0) {
    console.error('Fixture missing. Run `npm run seed:event-fixture` first.');
    process.exitCode = 1;
    return;
  }

  const journal = (await prisma.$queryRawUnsafe('PRAGMA journal_mode;')) as Array<
    Record<string, unknown>
  >;
  const pooled = (process.env['DATABASE_URL'] ?? '').includes('connection_limit=');

  console.warn('ACN Cyber Odyssey — Scenario Load Test\n');
  console.warn(`  logical CPUs        : ${os.cpus().length}`);
  console.warn(`  UV_THREADPOOL_SIZE  : ${process.env['UV_THREADPOOL_SIZE'] ?? '(default 4)'}`);
  console.warn(`  journal_mode        : ${journal[0]?.['journal_mode'] ?? 'n/a'}`);
  console.warn(`  connection pooling  : ${pooled ? 'configured' : 'NOT CONFIGURED (see §2)'}`);
  console.warn(`  squads / participants: ${teamCount} / ${participantCount}\n`);

  const participants = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'PARTICIPANT' },
    select: { id: true, email: true, passwordHash: true },
  });
  const members = await prisma.teamMember.findMany({
    where: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } },
    select: { userId: true, teamId: true },
  });
  const teams = await prisma.team.findMany({
    where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
    select: { id: true, score: true },
  });

  const results: ScenarioResult[] = [];

  // --- Scenario A: 210 participants sign in ---------------------------------
  // Exercises the real login path: user lookup + scrypt verification + session
  // insert. scrypt is CPU-bound on the libuv threadpool, so this is usually the
  // most expensive scenario despite being trivial for the database.
  results.push(
    await measure('A', '210 logins (lookup + scrypt + session)', 'login', 210, async (i) => {
      const p = participants[i % participants.length]!;
      const user = await prisma.user.findUnique({
        where: { email: p.email },
        select: { id: true, passwordHash: true, status: true, role: true },
      });
      if (!user) throw new Error('fixture user missing');
      const ok = await verifyPassword(FIXTURE_PASSWORD, user.passwordHash);
      if (!ok) throw new Error('fixture password mismatch');
      await prisma.session.create({
        data: {
          userId: user.id,
          token: `loadtest_${i}_${Date.now()}_${Math.round(performance.now() * 1000)}`,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
    }),
  );

  // --- Scenario B: 210 dashboards -------------------------------------------
  results.push(
    await measure('B', '210 dashboard loads', 'read', 210, async (i) => {
      const m = members[i % members.length]!;
      const team = teams[i % teams.length]!;
      await Promise.all([
        prisma.team.count({ where: { score: { gt: team.score } } }),
        prisma.levelState.findMany({ orderBy: { levelNumber: 'asc' } }),
        prisma.teamMember.count({ where: { teamId: m.teamId } }),
        countVisibleAnnouncements('PARTICIPANT'),
      ]);
    }),
  );

  // --- Scenario C: 210 leaderboard reads ------------------------------------
  results.push(
    await measure('C', '210 leaderboard reads', 'read', 210, async () => {
      await prisma.team.findMany({
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
    }),
  );

  // --- Scenario D: 150 squad members open Level 2 ---------------------------
  results.push(
    await measure('D', '150 Level 2 workspace loads', 'read', 150, async (i) => {
      const m = members[i % members.length]!;
      await Promise.all([
        countVisibleAnnouncements('PARTICIPANT'),
        prisma.levelResource.findMany({ where: { levelNumber: 2 } }),
        prisma.submission.findUnique({
          where: { teamId_level: { teamId: m.teamId, level: 2 } },
          select: {
            id: true,
            status: true,
            files: { select: { id: true, originalName: true, fileSize: true } },
            evaluation: { select: { feedback: true, score: true, status: true } },
          },
        }),
      ]);
    }),
  );

  // --- Scenario E: 50 squads pull the evidence package ----------------------
  // Resource metadata lookup plus the authoritative level-access check that
  // gates the download.
  const { checkAuthoritativeLevelAccess } = await import('../src/lib/event/level-access');
  results.push(
    await measure('E', '50 evidence resource fetches', 'read', 50, async () => {
      await Promise.all([
        checkAuthoritativeLevelAccess(2, true),
        prisma.levelResource.findUnique({
          where: { levelNumber_resourceKey: { levelNumber: 2, resourceKey: 'EVIDENCE_PACKAGE' } },
        }),
      ]);
    }),
  );

  // --- Scenario F: 50 squads submit at the deadline -------------------------
  await prisma.submissionFile.deleteMany({
    where: { submission: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } } },
  });
  await prisma.submission.deleteMany({
    where: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } },
  });
  await prisma.team.updateMany({
    where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
    data: { score: 0 },
  });

  const headByTeam = new Map<string, string>();
  for (const m of members) if (!headByTeam.has(m.teamId)) headByTeam.set(m.teamId, m.userId);
  const submitPairs = [...headByTeam.entries()];

  results.push(
    await measure('F', '50 deadline submissions', 'write', submitPairs.length, async (i) => {
      const pair = submitPairs[i]!;
      const [teamId, userId] = pair;
      await prisma.$transaction(async (tx) => {
        const sub = await tx.submission.create({
          data: { teamId, userId, level: 2, status: 'SUBMITTED' },
        });
        await tx.submissionFile.create({
          data: {
            submissionId: sub.id,
            fileName: `lvl2_${teamId.slice(0, 8)}_load.pdf`,
            originalName: 'report.pdf',
            fileSize: 2048,
            mimeType: 'application/pdf',
            storagePath: `uploads/submissions/level-2/lvl2_${teamId.slice(0, 8)}_load.pdf`,
          },
        });
        await tx.auditLog.create({
          data: { actorId: userId, action: 'SUBMISSION_SUBMITTED', details: 'load scenario F' },
        });
      }, CRITICAL_WRITE_TX);
    }),
  );

  // --- Scenario G: evaluators score while participants keep reading ---------
  const submissions = await prisma.submission.findMany({
    where: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } },
    select: { id: true, teamId: true, level: true },
  });
  const evaluator = await prisma.user.findFirstOrThrow({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'EVALUATOR' },
    select: { id: true },
  });

  // Background participant read load, running for the duration of scenario G.
  let backgroundActive = true;
  let backgroundReads = 0;
  const background = (async () => {
    while (backgroundActive) {
      await Promise.all(
        Array.from({ length: 20 }, async () => {
          const team = teams[backgroundReads % teams.length]!;
          await prisma.team.count({ where: { score: { gt: team.score } } });
          backgroundReads++;
        }),
      );
    }
  })();

  results.push(
    await measure(
      'G',
      'evaluations under live read load',
      'write',
      Math.min(submissions.length, 50),
      async (i) => {
        const sub = submissions[i]!;
        await prisma.$transaction(async (tx) => {
          await tx.evaluation.upsert({
            where: { submissionId: sub.id },
            update: { score: 60 + (i % 40), status: 'EVALUATED' },
            create: {
              submissionId: sub.id,
              evaluatorId: evaluator.id,
              teamId: sub.teamId,
              level: sub.level,
              score: 60 + (i % 40),
              status: 'EVALUATED',
            },
          });
          const agg = await tx.evaluation.aggregate({
            where: { teamId: sub.teamId, status: 'EVALUATED' },
            _sum: { score: true },
          });
          await tx.team.update({
            where: { id: sub.teamId },
            data: { score: agg._sum.score ?? 0 },
          });
        }, CRITICAL_WRITE_TX);
      },
    ),
  );

  backgroundActive = false;
  await background;
  console.warn(`  (scenario G ran against ${backgroundReads} concurrent background reads)\n`);

  printResults(results);

  // --- Integrity after the full workload ------------------------------------
  console.warn('\n--- POST-LOAD INTEGRITY ---');
  const dupes = (
    await prisma.submission.groupBy({ by: ['teamId', 'level'], _count: { id: true } })
  ).filter((g) => g._count.id > 1);
  const over = (
    await prisma.team.findMany({
      where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
      select: { _count: { select: { members: true } } },
    })
  ).filter((t) => t._count.members > 3);
  const teamsNow = await prisma.team.findMany({
    where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
    select: { id: true, score: true },
  });
  const sums = await prisma.evaluation.groupBy({
    by: ['teamId'],
    where: { status: 'EVALUATED' },
    _sum: { score: true },
  });
  const sumMap = new Map(sums.map((s) => [s.teamId, s._sum.score ?? 0]));
  const drifted = teamsNow.filter((t) => t.score !== (sumMap.get(t.id) ?? 0));

  console.warn(`  duplicate submissions : ${dupes.length}`);
  console.warn(`  squads over capacity  : ${over.length}`);
  console.warn(`  squads w/ score drift : ${drifted.length}`);

  const integrityOk = dupes.length === 0 && over.length === 0 && drifted.length === 0;
  console.warn(`  INTEGRITY: ${integrityOk ? 'ALL INVARIANTS HOLD' : 'VIOLATIONS DETECTED'}`);

  // --- Optional stress probe ------------------------------------------------
  if (process.env['LOAD_STRESS']) {
    console.warn('\n--- STRESS PROBE (beyond expected load) ---');

    console.warn('\n  READ ladder — where does the read path stop meeting p95?\n');
    for (const level of [250, 300, 500, 750, 1000]) {
      const r = await measure(
        `S${level}`,
        `${level} concurrent reads`,
        'read',
        level,
        async (i) => {
          const team = teams[i % teams.length]!;
          await Promise.all([
            prisma.team.count({ where: { score: { gt: team.score } } }),
            countVisibleAnnouncements('PARTICIPANT'),
          ]);
        },
      );
      console.warn(
        `  ${String(level).padStart(5)} concurrent  ` +
          `p50 ${r.p50.toFixed(0).padStart(5)}ms  ` +
          `p95 ${r.p95.toFixed(0).padStart(6)}ms  ` +
          `${r.opsPerSecond.toFixed(0).padStart(6)} ops/s  ` +
          `errors ${r.errors}  ${verdict(r)}`,
      );
    }

    // The write path is where SQLite's single-writer rule binds, so this is the
    // ladder that actually locates the ceiling. Each entry is a full interactive
    // transaction, matching what a real submission or evaluation performs.
    console.warn('\n  WRITE ladder — the single-writer ceiling:\n');
    for (const level of [50, 100, 200, 400, 800]) {
      await prisma.auditLog.deleteMany({ where: { details: 'stress probe' } });
      const r = await measure(
        `W${level}`,
        `${level} concurrent write transactions`,
        'write',
        level,
        async (i) => {
          await prisma.$transaction(async (tx) => {
            await tx.auditLog.create({
              data: { action: 'STRESS_PROBE', details: 'stress probe' },
            });
            await tx.auditLog.count({ where: { action: 'STRESS_PROBE' } });
            void i;
          }, CRITICAL_WRITE_TX);
        },
      );
      console.warn(
        `  ${String(level).padStart(5)} concurrent  ` +
          `p50 ${r.p50.toFixed(0).padStart(5)}ms  ` +
          `p95 ${r.p95.toFixed(0).padStart(6)}ms  ` +
          `${r.opsPerSecond.toFixed(0).padStart(6)} tx/s  ` +
          `errors ${r.errors}  ${verdict(r)}` +
          (r.firstError ? `\n        first failure: ${r.firstError}` : ''),
      );
    }
    await prisma.auditLog.deleteMany({ where: { details: 'stress probe' } });
  }

  const failed = results.filter((r) => verdict(r) === 'FAIL');
  console.warn(
    `\n${results.length - failed.length}/${results.length} scenarios PASS. ` +
      `${failed.length} FAIL.`,
  );
  console.warn(
    '\nSCOPE: data + CPU layer only. Not evidence of HTTP-server capacity under\n' +
      '210 concurrent browsers — see docs/production-readiness.md.\n',
  );

  if (failed.length > 0 || !integrityOk) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Remove the sessions this run created so the fixture stays reusable.
    await prisma.session
      .deleteMany({ where: { token: { startsWith: 'loadtest_' } } })
      .catch(() => {});
    await prisma.$disconnect();
  });
