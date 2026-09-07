import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth/password';
import { generateTeamCode } from '../src/lib/team/code-generator';

async function main() {
  const passwordHash = await hashPassword('ParticipantPass123!');

  // 1. Create or update Participant 1
  const user = await prisma.user.upsert({
    where: { email: 'participant1@acn.org' },
    update: {
      passwordHash,
      role: 'PARTICIPANT',
      status: 'ACTIVE',
      username: 'alex_rivera',
    },
    create: {
      email: 'participant1@acn.org',
      username: 'alex_rivera',
      passwordHash,
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    },
  });

  // 2. Create Teams for Podium & Leaderboard testing
  const teamsData = [
    { name: 'CYBER PHANTOMS', score: 1200, isUserTeam: true },
    { name: 'BYTE RAIDERS', score: 1080, isUserTeam: false },
    { name: 'ZERO DAY', score: 940, isUserTeam: false },
    { name: 'SHADOW RUNNERS', score: 720, isUserTeam: false },
    { name: 'NEXUS DEFENSE', score: 550, isUserTeam: false },
    { name: 'QUANTUM SENTINELS', score: 400, isUserTeam: false },
  ];

  for (const t of teamsData) {
    const existingTeam = await prisma.team.findUnique({ where: { name: t.name } });
    let teamId: string;
    if (existingTeam) {
      await prisma.team.update({
        where: { id: existingTeam.id },
        data: { score: t.score, status: 'ACTIVE' },
      });
      teamId = existingTeam.id;
    } else {
      const created = await prisma.team.create({
        data: {
          name: t.name,
          code: generateTeamCode(),
          passwordHash,
          creatorId: user.id,
          score: t.score,
          status: 'ACTIVE',
        },
      });
      teamId = created.id;
    }

    if (t.isUserTeam) {
      // Ensure user membership
      await prisma.teamMember.deleteMany({ where: { userId: user.id } });
      await prisma.teamMember.create({
        data: {
          teamId,
          userId: user.id,
          slot: 1,
          role: 'HEAD',
        },
      });
    }
  }

  // 3. Ensure Level States
  const now = new Date();
  const level2End = new Date(now.getTime() + 118 * 60 * 1000 + 41 * 1000); // 01:58:41

  await prisma.levelState.upsert({
    where: { levelNumber: 1 },
    update: { status: 'LOCKED', durationMinutes: 60 },
    create: {
      levelNumber: 1,
      name: 'Level 1 — The Initial Trace',
      codename: 'THE INITIAL TRACE',
      status: 'LOCKED',
      durationMinutes: 60,
      durationSeconds: 3600,
      remainingSeconds: 3600,
    },
  });

  await prisma.levelState.upsert({
    where: { levelNumber: 2 },
    update: {
      status: 'LIVE',
      startedAt: now,
      endsAt: level2End,
      durationMinutes: 120,
      remainingSeconds: 7121,
    },
    create: {
      levelNumber: 2,
      name: "Level 2 — The Boar's Mark",
      codename: "THE BOAR'S MARK",
      status: 'LIVE',
      durationMinutes: 120,
      durationSeconds: 7200,
      remainingSeconds: 7121,
      startedAt: now,
      endsAt: level2End,
    },
  });

  await prisma.levelState.upsert({
    where: { levelNumber: 3 },
    update: { status: 'LOCKED', durationMinutes: 120 },
    create: {
      levelNumber: 3,
      name: 'Level 3 — The Twelve Axes',
      codename: 'THE TWELVE AXES',
      status: 'LOCKED',
      durationMinutes: 120,
      durationSeconds: 7200,
      remainingSeconds: 7200,
    },
  });

  console.warn('Seeded participant test user and leaderboard teams successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
