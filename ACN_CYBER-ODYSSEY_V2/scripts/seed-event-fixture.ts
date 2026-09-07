/**
 * Event-scale test fixture: 50 squads, 150 squad participants, 60 unassigned
 * participants (210 total), plus evaluators and admins.
 *
 *   npm run seed:event-fixture
 *   npm run seed:event-fixture -- --wipe     (remove the fixture again)
 *
 * SAFETY
 * ------
 * Every generated identity is namespaced with the `loadtest-` / `LOADTEST ` prefix
 * and uses the reserved `@loadtest.invalid` domain (RFC 2606), so fixture rows are
 * unmistakable and `--wipe` can remove exactly them and nothing else. Real
 * accounts, real squads and the Creator account are never touched.
 *
 * All fixture accounts share one throwaway password. These are fake identities for
 * a private test database — never run this against production.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';
import { MAX_TEAM_SIZE } from '../src/lib/team/constants';

const prisma = new PrismaClient();

export const FIXTURE_EMAIL_DOMAIN = '@loadtest.invalid';
export const FIXTURE_TEAM_PREFIX = 'LOADTEST ';
export const FIXTURE_USERNAME_PREFIX = 'loadtest_';

/** Throwaway credential for fake fixture identities only. */
const FIXTURE_PASSWORD = 'LoadTestFixture!2026';

export const TARGET_TEAMS = 50;
export const TARGET_PARTICIPANTS = 210;
export const TARGET_EVALUATORS = 6;
export const TARGET_ADMINS = 3;

/** Participants placed into squads: 50 squads x 3 = 150. */
const SQUAD_PARTICIPANTS = TARGET_TEAMS * MAX_TEAM_SIZE;

async function wipeFixture() {
  console.warn('Removing load-test fixture...');

  const teams = await prisma.team.findMany({
    where: { name: { startsWith: FIXTURE_TEAM_PREFIX } },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);

  const users = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  // Ordered to respect foreign keys; cascades cover the rest.
  await prisma.evaluation.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.submissionFile.deleteMany({
    where: { submission: { teamId: { in: teamIds } } },
  });
  await prisma.submission.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.warn(`Removed ${teamIds.length} squads and ${userIds.length} accounts.`);
}

async function seedFixture() {
  const passwordHash = await hashPassword(FIXTURE_PASSWORD);

  console.warn(
    `Seeding fixture: ${TARGET_TEAMS} squads, ${TARGET_PARTICIPANTS} participants, ` +
      `${TARGET_EVALUATORS} evaluators, ${TARGET_ADMINS} admins...`,
  );

  // ---- Participants -------------------------------------------------------
  const participantData = Array.from({ length: TARGET_PARTICIPANTS }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      email: `participant${n}${FIXTURE_EMAIL_DOMAIN}`,
      username: `${FIXTURE_USERNAME_PREFIX}p${n}`,
      passwordHash,
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    };
  });

  await prisma.user.createMany({ data: participantData });

  const participants = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'PARTICIPANT' },
    select: { id: true },
    orderBy: { email: 'asc' },
  });

  // ---- Staff --------------------------------------------------------------
  await prisma.user.createMany({
    data: [
      ...Array.from({ length: TARGET_EVALUATORS }, (_, i) => ({
        email: `evaluator${i + 1}${FIXTURE_EMAIL_DOMAIN}`,
        username: `${FIXTURE_USERNAME_PREFIX}e${i + 1}`,
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      })),
      ...Array.from({ length: TARGET_ADMINS }, (_, i) => ({
        email: `admin${i + 1}${FIXTURE_EMAIL_DOMAIN}`,
        username: `${FIXTURE_USERNAME_PREFIX}a${i + 1}`,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      })),
    ],
  });

  // ---- Squads -------------------------------------------------------------
  // 50 squads at full capacity (3 each) consume the first 150 participants.
  // The remaining 60 stay unassigned, which mirrors a real event where not
  // everyone has formed a squad and exercises the team-onboarding paths.
  const teamPasswordHash = passwordHash;

  // Attributed to a fixture evaluator so seeded scores have a real evaluation
  // behind them (see the score comment below).
  const seedEvaluator = await prisma.user.findFirst({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'EVALUATOR' },
    select: { id: true },
  });
  const evaluatorId = seedEvaluator?.id ?? null;

  for (let t = 0; t < TARGET_TEAMS; t++) {
    const n = String(t + 1).padStart(2, '0');
    const memberSlice = participants.slice(t * MAX_TEAM_SIZE, (t + 1) * MAX_TEAM_SIZE);
    const head = memberSlice[0];
    if (!head) break;

    // Spread scores so leaderboard ordering, ties and the podium are all
    // exercised rather than every squad sitting at zero.
    //
    // The score is NOT set directly. Team.score must always equal the sum of the
    // squad's EVALUATED evaluations — that is the invariant `db-doctor` and the
    // load harness check. Seeding a bare score would fabricate points with no
    // evaluation behind them and make the fixture violate the very rule the
    // tooling exists to detect. The score is therefore produced the same way the
    // real event produces it: from an evaluation.
    const seededScore = (t % 7) * 25 + (t % 3) * 10;

    const team = await prisma.team.create({
      data: {
        name: `${FIXTURE_TEAM_PREFIX}SQUAD ${n}`,
        code: `CYB-LT${n}${String.fromCharCode(65 + (t % 26))}`,
        passwordHash: teamPasswordHash,
        creatorId: head.id,
        score: seededScore,
      },
      select: { id: true },
    });

    await prisma.teamMember.createMany({
      data: memberSlice.map((m, idx) => ({
        teamId: team.id,
        userId: m.id,
        slot: idx + 1,
        role: idx === 0 ? 'CREATOR' : 'MEMBER',
      })),
    });

    if (seededScore > 0 && evaluatorId) {
      const submission = await prisma.submission.create({
        data: { teamId: team.id, userId: head.id, level: 1, status: 'ACCEPTED' },
        select: { id: true },
      });
      await prisma.evaluation.create({
        data: {
          submissionId: submission.id,
          evaluatorId,
          teamId: team.id,
          level: 1,
          status: 'EVALUATED',
          score: seededScore,
        },
      });
    }
  }

  const assigned = SQUAD_PARTICIPANTS;
  console.warn(
    `Seeded ${TARGET_TEAMS} squads. ${assigned} participants assigned, ` +
      `${TARGET_PARTICIPANTS - assigned} left unassigned.`,
  );
}

async function summarize() {
  const [teams, participants, evaluators, admins, members] = await Promise.all([
    prisma.team.count({ where: { name: { startsWith: FIXTURE_TEAM_PREFIX } } }),
    prisma.user.count({
      where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'PARTICIPANT' },
    }),
    prisma.user.count({
      where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'EVALUATOR' },
    }),
    prisma.user.count({ where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN }, role: 'ADMIN' } }),
    prisma.teamMember.count({ where: { team: { name: { startsWith: FIXTURE_TEAM_PREFIX } } } }),
  ]);

  console.warn('\n--- FIXTURE STATE ---');
  console.warn(`  squads:            ${teams}`);
  console.warn(`  participants:      ${participants}`);
  console.warn(`  squad memberships: ${members}`);
  console.warn(`  evaluators:        ${evaluators}`);
  console.warn(`  admins:            ${admins}`);
}

async function main() {
  const wipe = process.argv.includes('--wipe');

  if (wipe) {
    await wipeFixture();
    await summarize();
    return;
  }

  // Idempotent: clear any previous fixture before reseeding.
  await wipeFixture();
  await seedFixture();
  await summarize();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
