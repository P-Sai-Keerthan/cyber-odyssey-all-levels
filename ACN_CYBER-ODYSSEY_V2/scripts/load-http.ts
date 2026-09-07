/**
 * HTTP load harness for the full event target: 300 participants, 100 squads.
 *
 *   npm run load:http
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE `load:test`
 * ---------------------------------------------------------------------------
 * `scripts/load-test.ts` drives the real QUERY SHAPES at the database layer and
 * is honest that it stops there. It cannot see connection-pool exhaustion under
 * real request concurrency, session lookup on every render, React server
 * rendering cost, or the integration endpoints — all of which are where an event
 * actually falls over.
 *
 * This harness drives REAL HTTP against both running applications.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES AND DOES NOT SIMULATE — read this before quoting the numbers
 * ---------------------------------------------------------------------------
 * DOES, over HTTP:
 *   - authenticated page renders (dashboard, event, level 1 briefing, leaderboard)
 *   - the Level 2 submission API's read path
 *   - Level 1 ticket redemption (`/api/enter`) end to end
 *   - signed Level 1 score callbacks, which are the heaviest write path in the
 *     portal: a transaction, a row lock, six aggregates and a Team update each
 *
 * DOES NOT, over HTTP:
 *   - the login form and "Enter Level 1" are Next.js SERVER ACTIONS, addressed by
 *     a build-specific action id rather than a stable route. Driving them by id
 *     would break on every rebuild and prove nothing about the event. Sessions
 *     are therefore created exactly as `loginAction` creates them, and tickets
 *     exactly as `startLevel1SessionAction` mints them — the same code, the same
 *     tables, one layer below the HTTP envelope.
 *
 * So: a load figure from this harness is a real HTTP figure for everything it
 * lists, and a database-layer figure for the two server actions. Quote it that
 * way.
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

const PORTAL = process.env['PORTAL_URL'] ?? 'http://localhost:3002';
const LEVEL1 = process.env['LEVEL1_URL'] ?? 'http://localhost:3001';

/** The event target. */
const TEAM_COUNT = Number(process.env['LOAD_TEAMS'] ?? 100);
const MEMBERS_PER_TEAM = Number(process.env['LOAD_MEMBERS_PER_TEAM'] ?? 3);

/** Clearly-labelled fixture data, trivially separable from real participants. */
const FIXTURE_PREFIX = 'LOADTEST';
const FIXTURE_DOMAIN = '@loadtest.invalid';
const FIXTURE_PASSWORD = 'LoadTestFixture!2026';

interface Sample {
  ok: boolean;
  ms: number;
  status: number;
  label: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function report(title: string, samples: Sample[], wallMs: number): boolean {
  const ok = samples.filter((s) => s.ok).length;
  const rate = (ok / samples.length) * 100;
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const failures = samples.filter((s) => !s.ok);

  console.log(`\n  ${title}`);
  console.log(
    `    requests      ${samples.length}   wall ${wallMs} ms   ${(samples.length / (wallMs / 1000)).toFixed(0)} req/s`,
  );
  console.log(`    success       ${ok}/${samples.length}  (${rate.toFixed(1)}%)`);
  console.log(
    `    latency ms    p50 ${percentile(times, 50)}   p95 ${percentile(times, 95)}   max ${times[times.length - 1] ?? 0}`,
  );
  if (failures.length > 0) {
    const byStatus = new Map<string, number>();
    for (const f of failures) {
      const key = `${f.label} -> ${f.status}`;
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }
    for (const [k, v] of byStatus) console.log(`    FAILURE       ${v} x ${k}`);
  }
  return rate === 100;
}

async function timed(label: string, fn: () => Promise<Response>): Promise<Sample> {
  const started = Date.now();
  try {
    const res = await fn();
    // Drain the body: leaving it unread understates latency and holds sockets.
    await res.arrayBuffer().catch(() => undefined);
    return {
      ok: res.status >= 200 && res.status < 400,
      ms: Date.now() - started,
      status: res.status,
      label,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      status: 0,
      label: `${label} (${err instanceof Error ? err.message : 'network'})`,
    };
  }
}

/** Seeds (idempotently) the squads and participants, and returns live sessions. */
async function buildFixture() {
  console.log(`\n  Seeding fixture: ${TEAM_COUNT} squads x ${MEMBERS_PER_TEAM} members …`);
  const passwordHash = await hashPassword(FIXTURE_PASSWORD);

  const teams: Array<{ id: string; externalRef: string }> = [];
  const cookies: string[] = [];

  for (let t = 1; t <= TEAM_COUNT; t++) {
    const tag = String(t).padStart(3, '0');
    const teamName = `${FIXTURE_PREFIX} Squad ${tag}`;
    const headEmail = `${FIXTURE_PREFIX.toLowerCase()}_t${tag}_m1${FIXTURE_DOMAIN}`;

    const head = await prisma.user.upsert({
      where: { email: headEmail },
      update: { status: 'ACTIVE', role: 'PARTICIPANT' },
      create: {
        email: headEmail,
        username: `${FIXTURE_PREFIX.toLowerCase()}_t${tag}_m1`,
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    const team = await prisma.team.upsert({
      where: { name: teamName },
      update: {},
      create: {
        name: teamName,
        code: `LT${tag}`,
        passwordHash,
        creatorId: head.id,
        externalRef: `co_loadtest_${tag}`,
        score: 0,
      },
    });
    teams.push({ id: team.id, externalRef: team.externalRef! });

    for (let m = 1; m <= MEMBERS_PER_TEAM; m++) {
      const email = `${FIXTURE_PREFIX.toLowerCase()}_t${tag}_m${m}${FIXTURE_DOMAIN}`;
      const user =
        m === 1
          ? head
          : await prisma.user.upsert({
              where: { email },
              update: { status: 'ACTIVE' },
              create: {
                email,
                username: `${FIXTURE_PREFIX.toLowerCase()}_t${tag}_m${m}`,
                passwordHash,
                role: 'PARTICIPANT',
                status: 'ACTIVE',
              },
            });

      await prisma.teamMember.upsert({
        where: { userId: user.id },
        update: {},
        create: { teamId: team.id, userId: user.id, slot: m, role: m === 1 ? 'HEAD' : 'MEMBER' },
      });

      // Exactly what loginAction does: a session row plus the cookie value.
      const token = crypto.randomBytes(32).toString('hex');
      await prisma.session.create({
        data: { userId: user.id, token, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      cookies.push(`cyber_session=${token}`);
    }
  }

  console.log(`  Fixture ready: ${teams.length} squads, ${cookies.length} signed-in participants.`);
  return { teams, cookies };
}

/**
 * Removes everything `buildFixture` created.
 *
 * WHY THIS EXISTS: the harness used to leave its 100 squads and 300 users in the
 * database. On the event database that is 100 fake squads on the leaderboard and
 * a participant count nobody can explain; it also meant a second run measured a
 * database that already carried the first run's rows. Teardown is keyed on the
 * LOADTEST prefix, so it can only ever match rows this script made.
 */
async function tearDownFixture(): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { name: { startsWith: `${FIXTURE_PREFIX} Squad ` } },
    select: { id: true, externalRef: true },
  });
  const teamIds = teams.map((t) => t.id);
  // IntegrationEvent is the replay ledger and holds the EXTERNAL reference the
  // sender named, not a foreign key — it deliberately survives the squad it
  // describes. Cleared by that reference instead.
  const externalRefs = teams.map((t) => t.externalRef).filter((r): r is string => Boolean(r));

  if (teamIds.length > 0) {
    // Children first: several of these have Restrict/NoAction relations, and a
    // partial cascade would leave orphans that db:doctor would then report.
    await prisma.level1Result.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.level1Penalty.deleteMany({ where: { teamId: { in: teamIds } } });
    if (externalRefs.length > 0) {
      await prisma.integrationEvent.deleteMany({
        where: { externalTeamRef: { in: externalRefs } },
      });
    }
    await prisma.integrationTicket.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.scoreAdjustment.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  }

  const users = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log(`  Fixture removed: ${teamIds.length} squads, ${userIds.length} participants.`);
}

async function main() {
  console.log('='.repeat(64));
  console.log('ACN CYBER ODYSSEY — HTTP LOAD TEST');
  console.log('='.repeat(64));

  const secret = (process.env['ODYSSEY_LEVEL1_SECRET'] ?? '').trim();
  const { teams, cookies } = await buildFixture();
  const results: boolean[] = [];

  // -- Wave 1: every participant loads the portal at once ---------------------
  const pages = ['/dashboard', '/event', '/event/level-1', '/leaderboard'];
  let started = Date.now();
  const wave1 = await Promise.all(
    cookies.map((cookie, i) =>
      timed(pages[i % pages.length]!, () =>
        fetch(`${PORTAL}${pages[i % pages.length]}`, { headers: { cookie, accept: 'text/html' } }),
      ),
    ),
  );
  results.push(
    report(
      `WAVE 1 — ${cookies.length} concurrent authenticated page loads`,
      wave1,
      Date.now() - started,
    ),
  );

  // -- Wave 2: the Level 2 submission API's read path --------------------------
  started = Date.now();
  const wave2 = await Promise.all(
    cookies.map((cookie) =>
      timed('GET /api/event/level-2/submission', () =>
        fetch(`${PORTAL}/api/event/level-2/submission`, { headers: { cookie } }),
      ),
    ),
  );
  results.push(
    report(
      `WAVE 2 — ${cookies.length} concurrent submission-state API calls`,
      wave2,
      Date.now() - started,
    ),
  );

  // -- Wave 3: every squad enters Level 1 at once -------------------------------
  const { issueTicket } = await import('../src/lib/level1/tickets');
  const head = await prisma.teamMember.findMany({
    where: { teamId: { in: teams.map((t) => t.id) }, slot: 1 },
    select: { teamId: true, userId: true },
  });
  const headByTeam = new Map(head.map((h) => [h.teamId, h.userId]));

  const tickets = await Promise.all(
    teams.map((t) =>
      issueTicket({ teamId: t.id, level: 1, issuedToUserId: headByTeam.get(t.id)! }),
    ),
  );

  started = Date.now();
  const wave3 = await Promise.all(
    tickets.map((tk) =>
      timed('GET /api/enter', () =>
        fetch(`${LEVEL1}/api/enter?ticket=${tk.ticket}`, { redirect: 'manual' }),
      ),
    ),
  );
  results.push(
    report(
      `WAVE 3 — ${teams.length} concurrent Level 1 entries (ticket redemption)`,
      wave3,
      Date.now() - started,
    ),
  );

  // -- Wave 4: the heaviest write path -----------------------------------------
  if (!secret) {
    console.log('\n  WAVE 4 skipped: ODYSSEY_LEVEL1_SECRET is not set.');
  } else {
    const challenges = await prisma.level1Challenge.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      take: 3,
    });

    const jobs: Array<() => Promise<Response>> = [];
    for (const team of teams) {
      for (const ch of challenges) {
        const body = JSON.stringify({
          eventId: crypto.randomUUID(),
          nonce: crypto.randomUUID(),
          eventType: 'LEVEL1_CHALLENGE_SOLVED',
          externalTeamRef: team.externalRef,
          externalChallengeRef: ch.externalRef,
          solvedAt: new Date().toISOString(),
        });
        const ts = Math.floor(Date.now() / 1000).toString();
        const sig =
          'sha256=' +
          crypto.createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex');
        jobs.push(() =>
          fetch(`${PORTAL}/api/integration/level1/score`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-odyssey-signature': sig,
              'x-odyssey-timestamp': ts,
            },
            body,
          }),
        );
      }
    }

    started = Date.now();
    const wave4 = await Promise.all(jobs.map((j) => timed('POST score', j)));
    results.push(
      report(
        `WAVE 4 — ${jobs.length} concurrent signed score callbacks`,
        wave4,
        Date.now() - started,
      ),
    );

    // -- Integrity: the numbers have to be right, not just fast ----------------
    console.log('\n  INTEGRITY AFTER LOAD');
    let wrong = 0;
    const expectedPerTeam = challenges.reduce((sum, c) => sum + c.points, 0);
    for (const team of teams) {
      const agg = await prisma.level1Result.aggregate({
        where: { teamId: team.id },
        _sum: { awardedPoints: true },
        _count: { _all: true },
      });
      const stored = await prisma.team.findUniqueOrThrow({
        where: { id: team.id },
        select: { score: true },
      });
      if (
        agg._count._all !== challenges.length ||
        (agg._sum.awardedPoints ?? 0) !== expectedPerTeam
      )
        wrong++;
      else if (stored.score !== expectedPerTeam) wrong++;
    }
    console.log(
      `    squads with a correct, non-duplicated score: ${teams.length - wrong}/${teams.length}`,
    );
    results.push(wrong === 0);
  }

  const poolRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()',
  );
  console.log(`\n  PostgreSQL backends on this database: ${String(poolRows[0]?.count ?? 'n/a')}`);

  console.log('\n' + '='.repeat(64));
  console.log(results.every(Boolean) ? 'LOAD TEST: ALL WAVES PASSED' : 'LOAD TEST: FAILURES ABOVE');
  console.log('='.repeat(64));

  // Always, including after a failed wave — a failed run must not leave the
  // database dirtier than a passing one.
  console.log('');
  await tearDownFixture();

  await prisma.$disconnect();
  if (!results.every(Boolean)) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  // Best-effort teardown on the error path too. If this also fails, the original
  // error is what matters, so its failure is swallowed rather than masking it.
  await tearDownFixture().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
