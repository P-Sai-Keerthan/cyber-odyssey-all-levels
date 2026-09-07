/**
 * Database-layer load harness for the 210-participant / 50-squad event.
 *
 *   npm run seed:event-fixture      # once, to create the data
 *   npm run load:test               # then measure
 *
 * WHAT THIS MEASURES — AND WHAT IT DOES NOT
 * ------------------------------------------
 * This drives the REAL query shapes the portal issues (the dashboard bundle, the
 * leaderboard, the evaluator queue, the announcement feed, the submission write
 * path) at event concurrency, against the REAL schema and indexes, and reports
 * measured latency distributions.
 *
 * It does NOT exercise HTTP, React server rendering, session cookie parsing, TLS,
 * or the network between participants and the server. A passing run here is
 * evidence that the DATABASE layer sustains the load. It is NOT evidence that the
 * deployed application sustains 210 concurrent browsers — that requires driving
 * the running server with an HTTP load tool, which is documented as NOT VERIFIED
 * in docs/production/phase-17-production-readiness.md.
 *
 * Read every number below as "database layer, single process, local disk".
 */
import { PrismaClient } from '@prisma/client';
import { countVisibleAnnouncements } from '../src/lib/event/announcements';
import { CRITICAL_WRITE_TX } from '../src/lib/db/transaction';

const prisma = new PrismaClient();

const FIXTURE_EMAIL_DOMAIN = '@loadtest.invalid';
const FIXTURE_TEAM_PREFIX = 'LOADTEST ';

/** Concurrent virtual participants per wave. */
const CONCURRENCY = Number(process.env['LOAD_CONCURRENCY'] ?? 210);
/** Waves per scenario, so numbers are not a single lucky sample. */
const WAVES = Number(process.env['LOAD_WAVES'] ?? 3);

interface ScenarioResult {
  name: string;
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

/**
 * Runs `op` `concurrency` times in parallel, `waves` times over, timing each
 * individual operation.
 */
async function measure(
  name: string,
  op: (i: number) => Promise<unknown>,
  concurrency = CONCURRENCY,
  waves = WAVES,
): Promise<ScenarioResult> {
  const durations: number[] = [];
  let errors = 0;
  let firstError: string | null = null;

  const started = performance.now();

  for (let wave = 0; wave < waves; wave++) {
    const batch = Array.from({ length: concurrency }, async (_, i) => {
      const t0 = performance.now();
      try {
        await op(wave * concurrency + i);
      } catch (e) {
        errors++;
        if (!firstError) {
          firstError =
            e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 180) : String(e);
        }
      }
      durations.push(performance.now() - t0);
    });
    await Promise.all(batch);
  }

  const totalMs = performance.now() - started;
  const sorted = [...durations].sort((a, b) => a - b);

  return {
    name,
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

function fmt(n: number): string {
  return n.toFixed(1).padStart(8);
}

function printResults(results: ScenarioResult[]) {
  console.warn('\n' + '='.repeat(96));
  console.warn('LOAD TEST RESULTS — DATABASE LAYER');
  console.warn('='.repeat(96));
  console.warn(
    'scenario'.padEnd(38) +
      'ops'.padStart(7) +
      'p50 ms'.padStart(9) +
      'p95 ms'.padStart(9) +
      'p99 ms'.padStart(9) +
      'max ms'.padStart(9) +
      'ops/s'.padStart(9) +
      'err'.padStart(6),
  );
  console.warn('-'.repeat(96));
  for (const r of results) {
    console.warn(
      r.name.padEnd(38) +
        String(r.operations).padStart(7) +
        fmt(r.p50) +
        ' ' +
        fmt(r.p95) +
        ' ' +
        fmt(r.p99) +
        ' ' +
        fmt(r.max) +
        ' ' +
        fmt(r.opsPerSecond) +
        ' ' +
        String(r.errors).padStart(5),
    );
  }
  console.warn('='.repeat(96));
  for (const r of results) {
    if (r.firstError) {
      console.warn(`  ! ${r.name}: first failure -> ${r.firstError}`);
    }
  }
}

async function main() {
  // ---- Preconditions ------------------------------------------------------
  const [teamCount, participantCount] = await Promise.all([
    prisma.team.count({ where: { name: { startsWith: FIXTURE_TEAM_PREFIX } } }),
    prisma.user.count({
      where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'PARTICIPANT' },
    }),
  ]);

  if (teamCount === 0 || participantCount === 0) {
    console.error('Load-test fixture is not present. Run `npm run seed:event-fixture` first.');
    process.exitCode = 1;
    return;
  }

  const journal = (await prisma.$queryRawUnsafe('PRAGMA journal_mode;')) as Array<
    Record<string, unknown>
  >;

  console.warn('ACN Cyber Odyssey — Load Test');
  console.warn(`  datasource journal_mode : ${journal[0]?.['journal_mode'] ?? 'n/a'}`);
  console.warn(`  squads in fixture       : ${teamCount}`);
  console.warn(`  participants in fixture : ${participantCount}`);
  console.warn(`  concurrency per wave    : ${CONCURRENCY}`);
  console.warn(`  waves per scenario      : ${WAVES}`);

  const members = await prisma.teamMember.findMany({
    where: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } },
    select: { userId: true, teamId: true },
  });
  const teams = await prisma.team.findMany({
    where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
    select: { id: true, score: true },
  });

  const results: ScenarioResult[] = [];

  // ---- 1. Participant dashboard bundle ------------------------------------
  // Mirrors the Promise.all in src/app/dashboard/page.tsx.
  results.push(
    await measure('participant dashboard bundle', async (i) => {
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

  // ---- 2. Leaderboard -----------------------------------------------------
  results.push(
    await measure('leaderboard read', async () => {
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

  // ---- 3. Session resolution ----------------------------------------------
  // The query every authenticated request performs before anything else.
  results.push(
    await measure('session user resolution', async (i) => {
      const m = members[i % members.length]!;
      await prisma.user.findUnique({
        where: { id: m.userId },
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          membership: {
            select: {
              teamId: true,
              role: true,
              team: { select: { id: true, name: true, score: true, status: true } },
            },
          },
        },
      });
    }),
  );

  // ---- 4. Level 2 workspace bundle ----------------------------------------
  results.push(
    await measure('level 2 workspace bundle', async (i) => {
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

  // ---- 5. Evaluator submission queue --------------------------------------
  // Fewer evaluators than participants, so a smaller concurrency is realistic.
  results.push(
    await measure(
      'evaluator submission queue',
      async () => {
        await Promise.all([
          prisma.submission.findMany({
            where: {},
            select: {
              id: true,
              teamId: true,
              level: true,
              status: true,
              submittedAt: true,
              team: { select: { name: true } },
              user: { select: { username: true } },
              _count: { select: { files: true } },
              evaluation: { select: { status: true, score: true } },
            },
            orderBy: { submittedAt: 'desc' },
            take: 20,
          }),
          prisma.submission.count(),
        ]);
      },
      12,
      WAVES,
    ),
  );

  // ---- 6. Concurrent submission writes ------------------------------------
  // The heaviest realistic write burst: every squad submitting near the deadline.
  // Cleared first so the run is repeatable.
  await prisma.submissionFile.deleteMany({
    where: { submission: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } } },
  });
  await prisma.submission.deleteMany({
    where: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } },
  });

  // Deleting submissions cascades to their evaluations, so every fixture squad's
  // stored score is now unbacked. Recompute it the way the application does, or
  // the integrity check at the end would report drift caused by this cleanup
  // rather than by anything under test.
  await prisma.team.updateMany({
    where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
    data: { score: 0 },
  });

  const headByTeam = new Map<string, string>();
  for (const m of members) {
    if (!headByTeam.has(m.teamId)) headByTeam.set(m.teamId, m.userId);
  }
  const submitPairs = [...headByTeam.entries()];

  results.push(
    await measure(
      'concurrent submission writes (50 squads)',
      async (i) => {
        const pair = submitPairs[i % submitPairs.length];
        if (!pair) return;
        const [teamId, userId] = pair;
        await prisma.$transaction(async (tx) => {
          await tx.submission.create({
            data: { teamId, userId, level: 2, status: 'SUBMITTED' },
          });
          await tx.auditLog.create({
            data: { actorId: userId, action: 'SUBMISSION_SUBMITTED', details: 'load test' },
          });
        }, CRITICAL_WRITE_TX);
      },
      submitPairs.length,
      1,
    ),
  );

  // ---- 7. Duplicate-submission storm --------------------------------------
  // Every squad submits AGAIN, concurrently. Every one of these must be rejected
  // by the (teamId, level) unique index. Errors here are the CORRECT outcome and
  // are reported as such.
  const duplicateStorm = await measure(
    'duplicate submission storm (all rejected)',
    async (i) => {
      const pair = submitPairs[i % submitPairs.length];
      if (!pair) return;
      const [teamId, userId] = pair;
      await prisma.submission.create({
        data: { teamId, userId, level: 2, status: 'SUBMITTED' },
      });
    },
    submitPairs.length,
    1,
  );
  results.push(duplicateStorm);

  // ---- 8. Concurrent evaluation writes ------------------------------------
  const submissions = await prisma.submission.findMany({
    where: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } },
    select: { id: true, teamId: true, level: true },
  });
  const evaluator = await prisma.user.findFirstOrThrow({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'EVALUATOR' },
    select: { id: true },
  });

  results.push(
    await measure(
      'concurrent evaluation + score aggregation',
      async (i) => {
        const sub = submissions[i % submissions.length];
        if (!sub) return;
        await prisma.$transaction(async (tx) => {
          await tx.evaluation.upsert({
            where: { submissionId: sub.id },
            update: { score: 70 + (i % 30), status: 'EVALUATED' },
            create: {
              submissionId: sub.id,
              evaluatorId: evaluator.id,
              teamId: sub.teamId,
              level: sub.level,
              score: 70 + (i % 30),
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
      Math.min(submissions.length, 50),
      1,
    ),
  );

  printResults(results);

  // ---- Integrity assertions ----------------------------------------------
  console.warn('\n--- POST-LOAD INTEGRITY ---');

  const dupGroups = await prisma.submission.groupBy({
    by: ['teamId', 'level'],
    _count: { id: true },
  });
  const duplicates = dupGroups.filter((g) => g._count.id > 1);
  console.warn(
    `  duplicate submissions after storm : ${duplicates.length} ` +
      `(${duplicateStorm.errors}/${duplicateStorm.operations} duplicate attempts correctly rejected)`,
  );

  const overCapacity = (
    await prisma.team.findMany({
      where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
      select: { id: true, _count: { select: { members: true } } },
    })
  ).filter((t) => t._count.members > 3);
  console.warn(`  squads over capacity              : ${overCapacity.length}`);

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
  console.warn(`  squads with score drift           : ${drifted.length}`);

  const ok = duplicates.length === 0 && overCapacity.length === 0 && drifted.length === 0;
  console.warn(`\n  INTEGRITY: ${ok ? 'ALL INVARIANTS HOLD' : 'VIOLATIONS DETECTED'}`);

  console.warn(
    '\nSCOPE REMINDER: these figures measure the database layer only. They do not\n' +
      'demonstrate that the deployed HTTP server sustains 210 concurrent browsers.\n',
  );

  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
