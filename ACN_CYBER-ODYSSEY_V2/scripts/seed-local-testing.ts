import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

/**
 * Writes a real placeholder deliverable and returns the row fields that point at it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The seeded submissions used to declare `storagePath: 'uploads/test/<name>'`
 * and never write anything there. Every seeded deliverable was therefore broken
 * in TWO ways at once:
 *
 *   1. No file existed, so the download 404'd.
 *   2. `uploads/test` is not `uploads/submissions`, and the evaluator download
 *      route resolves through `resolveContainedPath(..., UPLOAD_ROOTS.submissions)`.
 *      The path would have been refused as an escape attempt even if the bytes
 *      had been there.
 *
 * An evaluator rehearsing the review flow hit a dead DOWNLOAD button on every
 * seeded submission, which reads as a broken portal rather than as fixture data.
 *
 * The extensions are now restricted to what `saveSubmissionFile` actually
 * accepts (.pdf/.docx/.doc/.zip) with matching magic bytes, so the fixture
 * describes a submission the application could really have produced — a `.raw`
 * memory image and a `.pcap` were records the upload path would have rejected.
 */
function seedDeliverable(level: number, fileName: string, originalName: string, mimeType: string) {
  const dir = path.join(process.cwd(), 'uploads', 'submissions', `level-${level}`);
  fs.mkdirSync(dir, { recursive: true });

  const full = path.join(dir, fileName);
  const body = fileName.endsWith('.zip')
    ? Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
        Buffer.alloc(512, 0x20),
      ])
    : Buffer.from(
        `%PDF-1.4
% Seeded Cyber Odyssey test deliverable: ${originalName}
%%EOF
`,
        'utf8',
      );
  fs.writeFileSync(full, body);

  return {
    fileName,
    originalName,
    fileSize: body.length,
    mimeType,
    storagePath: path.relative(process.cwd(), full).split(path.sep).join('/'),
  };
}

export const TEST_PASSWORD = 'CyberOdyssey2026!';

export interface LocalTestUser {
  email: string;
  username: string;
  role: 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN' | 'CREATOR';
  customPassword?: string;
}

export const LOCAL_TEST_USERS: LocalTestUser[] = [
  // Participants for Team 01 (1 member)
  { email: 'test_p1_t1@odyssey.local', username: 'test_p1_t1', role: 'PARTICIPANT' },
  // Participants for Team 02 (2 members)
  { email: 'test_p1_t2@odyssey.local', username: 'test_p1_t2', role: 'PARTICIPANT' },
  { email: 'test_p2_t2@odyssey.local', username: 'test_p2_t2', role: 'PARTICIPANT' },
  // Participants for Team 03 (3 members)
  { email: 'test_p1_t3@odyssey.local', username: 'test_p1_t3', role: 'PARTICIPANT' },
  { email: 'test_p2_t3@odyssey.local', username: 'test_p2_t3', role: 'PARTICIPANT' },
  { email: 'test_p3_t3@odyssey.local', username: 'test_p3_t3', role: 'PARTICIPANT' },
  // Participants for Team 04 (2 members)
  { email: 'test_p1_t4@odyssey.local', username: 'test_p1_t4', role: 'PARTICIPANT' },
  { email: 'test_p2_t4@odyssey.local', username: 'test_p2_t4', role: 'PARTICIPANT' },
  // Participants for Team 05 (1 member)
  { email: 'test_p1_t5@odyssey.local', username: 'test_p1_t5', role: 'PARTICIPANT' },
  // Unassigned participant
  { email: 'test_unassigned@odyssey.local', username: 'test_unassigned', role: 'PARTICIPANT' },
  // Staff accounts
  { email: 'test_evaluator@odyssey.local', username: 'test_evaluator', role: 'EVALUATOR' },
  { email: 'test_admin@odyssey.local', username: 'test_admin', role: 'ADMIN' },
  { email: 'test_creator@odyssey.local', username: 'test_creator', role: 'CREATOR' },
];

/**
 * The event's REAL creator accounts, read from the environment.
 *
 * These used to be two object literals in this file carrying two named people's
 * actual CREATOR passwords — the highest-privilege role in the portal — in a
 * committed script, repeated again in scripts/verify-local-testing.ts. Anyone
 * with the repository had event-owner credentials.
 *
 * They now come from the same variables `prisma/seed.ts` already uses, so there
 * is one place to set them and none to leak them. Unset means "do not seed a
 * real creator", which is the right behaviour for a machine that is only
 * running the local fixture: the fixture's own `test_creator@odyssey.local`
 * account still exists for testing the Creator role.
 */
function realCreatorsFromEnv(): LocalTestUser[] {
  const entries = [
    {
      email: process.env['CREATOR_EMAIL'],
      username: process.env['CREATOR_USERNAME'],
      password: process.env['CREATOR_PASSWORD'],
    },
    {
      email: process.env['CREATOR_2_EMAIL'],
      username: process.env['CREATOR_2_USERNAME'],
      password: process.env['CREATOR_2_PASSWORD'],
    },
  ];

  const out: LocalTestUser[] = [];
  for (const e of entries) {
    const email = e.email?.trim().replace(/^["']|["']$/g, '');
    const password = e.password?.trim().replace(/^["']|["']$/g, '');
    if (!email || !password) continue;
    const username =
      e.username?.trim().replace(/^["']|["']$/g, '') || email.split('@')[0] || 'event_creator';
    out.push({ email, username, role: 'CREATOR', customPassword: password });
  }
  return out;
}

export const LOCAL_TEST_TEAMS = [
  {
    name: 'ACN Test Team 01',
    code: 'ACN-TT01',
    externalRef: 'co_00000000000000000000000000000001',
    members: ['test_p1_t1@odyssey.local'], // 1 member
  },
  {
    name: 'ACN Test Team 02',
    code: 'ACN-TT02',
    externalRef: 'co_00000000000000000000000000000002',
    members: ['test_p1_t2@odyssey.local', 'test_p2_t2@odyssey.local'], // 2 members
  },
  {
    name: 'ACN Test Team 03',
    code: 'ACN-TT03',
    externalRef: 'co_00000000000000000000000000000003',
    members: ['test_p1_t3@odyssey.local', 'test_p2_t3@odyssey.local', 'test_p3_t3@odyssey.local'], // 3 members
  },
  {
    name: 'ACN Test Team 04',
    code: 'ACN-TT04',
    externalRef: 'co_00000000000000000000000000000004',
    members: ['test_p1_t4@odyssey.local', 'test_p2_t4@odyssey.local'], // 2 members
  },
  {
    name: 'ACN Test Team 05',
    code: 'ACN-TT05',
    externalRef: 'co_00000000000000000000000000000005',
    members: ['test_p1_t5@odyssey.local'], // 1 member
  },
];

const LEVEL1_CATALOGUE = [
  {
    code: 'A1',
    externalRef: 'A1',
    title: 'Network Flow Anomaly',
    track: 'A',
    points: 5,
    sortOrder: 1,
  },
  {
    code: 'A2',
    externalRef: 'A2',
    title: 'Corrupted Inode Table',
    track: 'A',
    points: 10,
    sortOrder: 2,
  },
  {
    code: 'A3',
    externalRef: 'A3',
    title: 'Shadow Service Discovery',
    track: 'A',
    points: 10,
    sortOrder: 3,
  },
  {
    code: 'A4',
    externalRef: 'A4',
    title: 'Root Cause Reconstruction',
    track: 'A',
    points: 10,
    sortOrder: 4,
  },
  {
    code: 'B1',
    externalRef: 'B1',
    title: 'Steganographic Payload',
    track: 'B',
    points: 10,
    sortOrder: 1,
  },
  {
    code: 'B2',
    externalRef: 'B2',
    title: 'Obfuscated Shellcode',
    track: 'B',
    points: 10,
    sortOrder: 2,
  },
  {
    code: 'B3',
    externalRef: 'B3',
    title: 'Memory Dump Dissection',
    track: 'B',
    points: 10,
    sortOrder: 3,
  },
  {
    code: 'B4',
    externalRef: 'B4',
    title: 'Key Material Recovery',
    track: 'B',
    points: 10,
    sortOrder: 4,
  },
  {
    code: 'C1',
    externalRef: 'C1',
    title: 'Firmware Header Analysis',
    track: 'C',
    points: 10,
    sortOrder: 1,
  },
  {
    code: 'C2',
    externalRef: 'C2',
    title: 'Entropy Variance Mapping',
    track: 'C',
    points: 10,
    sortOrder: 2,
  },
  {
    code: 'C3',
    externalRef: 'C3',
    title: 'Master Control Signal Bypass',
    track: 'C',
    points: 15,
    sortOrder: 3,
  },
];

export async function seedLocalTesting() {
  console.log('=== SEEDING LOCAL TESTING SETUP (CYBER ODYSSEY) ===');

  const passwordHash = await hashPassword(TEST_PASSWORD);

  // 1. Clean previous local test teams and associations to guarantee idempotent clean state
  const teamNames = LOCAL_TEST_TEAMS.map((t) => t.name);
  const existingTeams = await prisma.team.findMany({
    where: { name: { in: teamNames } },
    select: { id: true },
  });
  const existingTeamIds = existingTeams.map((t) => t.id);

  if (existingTeamIds.length > 0) {
    const existingSubmissions = await prisma.submission.findMany({
      where: { teamId: { in: existingTeamIds } },
      select: { id: true },
    });
    const subIds = existingSubmissions.map((s) => s.id);
    if (subIds.length > 0) {
      await prisma.submissionFile.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.evaluation.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.submission.deleteMany({ where: { id: { in: subIds } } });
    }
    await prisma.level1Result.deleteMany({ where: { teamId: { in: existingTeamIds } } });
    await prisma.level1Penalty.deleteMany({ where: { teamId: { in: existingTeamIds } } });
    await prisma.integrationTicket.deleteMany({ where: { teamId: { in: existingTeamIds } } });
    await prisma.teamMember.deleteMany({ where: { teamId: { in: existingTeamIds } } });
    await prisma.team.deleteMany({ where: { id: { in: existingTeamIds } } });
  }

  // 2. Upsert Local Test Users
  const userMap = new Map<string, string>(); // email -> userId

  // Fixture accounts plus whatever real creators the environment configures.
  const usersToSeed = [...LOCAL_TEST_USERS, ...realCreatorsFromEnv()];

  for (const u of usersToSeed) {
    const userPasswordHash = u.customPassword ? await hashPassword(u.customPassword) : passwordHash;

    // Clear any conflicting user with same username but different email
    await prisma.user.deleteMany({
      where: {
        username: u.username,
        email: { not: u.email },
      },
    });

    const record = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        username: u.username,
        role: u.role,
        status: 'ACTIVE',
        passwordHash: userPasswordHash,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: {
        email: u.email,
        username: u.username,
        role: u.role,
        status: 'ACTIVE',
        passwordHash: userPasswordHash,
      },
      select: { id: true, email: true },
    });
    userMap.set(record.email, record.id);
  }
  console.log(`[PASS] Upserted ${usersToSeed.length} local test users.`);

  // 3. Create Local Test Teams and Member Slots
  for (const t of LOCAL_TEST_TEAMS) {
    const creatorEmail = t.members[0]!;
    const creatorId = userMap.get(creatorEmail)!;

    // Delete any lingering team with same code or externalRef
    await prisma.team.deleteMany({
      where: { OR: [{ code: t.code }, { externalRef: t.externalRef }] },
    });

    const team = await prisma.team.create({
      data: {
        name: t.name,
        code: t.code,
        passwordHash,
        creatorId,
        score: 0,
        status: 'ACTIVE',
        externalRef: t.externalRef,
      },
      select: { id: true },
    });

    // Add members with slots 1, 2, 3
    for (let slot = 1; slot <= t.members.length; slot++) {
      const memberEmail = t.members[slot - 1]!;
      const userId = userMap.get(memberEmail)!;

      // Ensure user is not linked to any other team
      await prisma.teamMember.deleteMany({ where: { userId } });

      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId,
          slot,
          role: slot === 1 ? 'HEAD' : 'MEMBER',
        },
      });
    }

    console.log(
      `[PASS] Seeded team "${t.name}" (${t.members.length} member(s), ref: ${t.externalRef})`,
    );
  }

  // 4. Ensure Level 1 State is LIVE
  const now = new Date();
  const endsAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now

  await prisma.levelState.upsert({
    where: { levelNumber: 1 },
    update: {
      status: 'LIVE',
      startedAt: now,
      endsAt,
      durationMinutes: 60,
      durationSeconds: 3600,
      remainingSeconds: 3600,
    },
    create: {
      levelNumber: 1,
      name: 'Level 1 — The Initial Trace',
      codename: 'THE INITIAL TRACE',
      status: 'LIVE',
      durationMinutes: 60,
      durationSeconds: 3600,
      remainingSeconds: 3600,
      startedAt: now,
      endsAt,
    },
  });
  console.log('[PASS] Level 1 state set to LIVE.');

  // 5. Ensure Portal Setting is Online
  await prisma.portalSetting.upsert({
    where: { id: 'default' },
    update: { isOnline: true },
    create: { id: 'default', isOnline: true },
  });

  // 6. Ensure Level 1 Catalog is Populated
  for (const ch of LEVEL1_CATALOGUE) {
    await prisma.level1Challenge.upsert({
      where: { code: ch.code },
      update: {
        externalRef: ch.externalRef,
        title: ch.title,
        track: ch.track,
        points: ch.points,
        sortOrder: ch.sortOrder,
        isActive: true,
      },
      create: {
        code: ch.code,
        externalRef: ch.externalRef,
        title: ch.title,
        track: ch.track,
        points: ch.points,
        sortOrder: ch.sortOrder,
        isActive: true,
      },
    });
  }
  console.log(`[PASS] Seeded ${LEVEL1_CATALOGUE.length} Level 1 catalogue questions.`);

  // 7. Seed Pre-Registered Participant Real Names (for display name resolution)
  const TEST_NAMES: Record<string, string> = {
    'test_p1_t1@odyssey.local': 'Arjun Kumar',
    'test_p1_t2@odyssey.local': 'Vikram Rao',
    'test_p2_t2@odyssey.local': 'Priya Sharma',
    'test_p1_t3@odyssey.local': 'Rohan Patel',
    'test_p2_t3@odyssey.local': 'Ananya Iyer',
    'test_p3_t3@odyssey.local': 'Aditya Verma',
    'test_p1_t4@odyssey.local': 'Deepak Sen',
    'test_p2_t4@odyssey.local': 'Kavita Nair',
    'test_p1_t5@odyssey.local': 'Sanjay Menon',
    'test_evaluator@odyssey.local': 'Elena Rostova',
  };

  for (const [email, name] of Object.entries(TEST_NAMES)) {
    await prisma.preRegisteredParticipant.upsert({
      where: { email: email.toLowerCase() },
      update: { name },
      create: { email: email.toLowerCase(), name },
    });
  }
  console.log('[PASS] Seeded pre-registered participant real names.');

  // 8. Seed Representative Submission Test Cases (Requirement 17)
  const team1 = await prisma.team.findUnique({ where: { name: 'ACN Test Team 01' } });
  const team2 = await prisma.team.findUnique({ where: { name: 'ACN Test Team 02' } });
  const team3 = await prisma.team.findUnique({ where: { name: 'ACN Test Team 03' } });
  const team4 = await prisma.team.findUnique({ where: { name: 'ACN Test Team 04' } });
  const team5 = await prisma.team.findUnique({ where: { name: 'ACN Test Team 05' } });
  const evaluatorId = userMap.get('test_evaluator@odyssey.local')!;

  // Case 1: Team 1 has Level 1 automatic challenge solves (score: 25 PTS, NO deliverable submission)
  if (team1) {
    const chA1 = await prisma.level1Challenge.findUnique({ where: { code: 'A1' } });
    const chA2 = await prisma.level1Challenge.findUnique({ where: { code: 'A2' } });
    const chB1 = await prisma.level1Challenge.findUnique({ where: { code: 'B1' } });
    if (chA1 && chA2 && chB1) {
      await prisma.level1Result.createMany({
        data: [
          { teamId: team1.id, challengeId: chA1.id, awardedPoints: 5 },
          { teamId: team1.id, challengeId: chA2.id, awardedPoints: 10 },
          { teamId: team1.id, challengeId: chB1.id, awardedPoints: 10 },
        ],
      });
      await prisma.team.update({ where: { id: team1.id }, data: { score: 25 } });
    }
    console.log(
      '[PASS] Case 1: Team 01 seeded with Level 1 automated solves (25 PTS, no submissions).',
    );
  }

  // Case 2: Team 2 has Level 2 submission with report + answers + 2 attachments (SUBMITTED, evaluation: PENDING)
  if (team2) {
    const submitterId = userMap.get('test_p1_t2@odyssey.local')!;
    const sub2 = await prisma.submission.create({
      data: {
        teamId: team2.id,
        userId: submitterId,
        level: 2,
        status: 'SUBMITTED',
        answers: JSON.stringify({
          q1_intrusionVector:
            'Spear-phishing email with malicious macro attachment and DLL sideloading.',
          q2_decryptedHash: 'e99a18c428cb38d5f260853678922e03',
          q3_persistenceMechanism:
            'Scheduled Task registered under SYSTEM context named UpdateChecker.',
        }),
        submittedAt: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago
        files: {
          create: [
            seedDeliverable(
              2,
              'sub_tt02_forensic_report.pdf',
              'forensic_investigation_report.pdf',
              'application/pdf',
            ),
            seedDeliverable(
              2,
              'sub_tt02_memory_triage.zip',
              'memory_triage_dump.zip',
              'application/zip',
            ),
            seedDeliverable(
              2,
              'sub_tt02_network_capture.zip',
              'network_capture.zip',
              'application/zip',
            ),
          ],
        },
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: sub2.id,
        evaluatorId,
        teamId: team2.id,
        level: 2,
        status: 'PENDING',
        score: 0,
        maxScore: 100,
      },
    });
    console.log('[PASS] Case 2: Team 02 seeded with Level 2 submission (Pending Review).');
  }

  // Case 3: Team 3 has NO submission (Level 2 not submitted)
  if (team3) {
    console.log('[PASS] Case 3: Team 03 seeded with NO submission (Unsubmitted Level 2).');
  }

  // Case 4: Team 4 has Level 2 evaluated submission (ACCEPTED, evaluation: EVALUATED, score: 85 PTS)
  if (team4) {
    const submitterId = userMap.get('test_p1_t4@odyssey.local')!;
    const sub4 = await prisma.submission.create({
      data: {
        teamId: team4.id,
        userId: submitterId,
        level: 2,
        status: 'ACCEPTED',
        answers: JSON.stringify({
          q1_intrusionVector: 'VPN appliance credential stuffing vulnerability (CVE-2024-21887).',
          q2_decryptedHash: '7b2a94f830d1e5c26b489a2f1073e619',
          q3_persistenceMechanism: 'Webshell implanted into external-facing portal directory.',
        }),
        submittedAt: new Date(Date.now() - 90 * 60 * 1000), // 90 min ago
        files: {
          create: [
            seedDeliverable(
              2,
              'sub_tt04_boars_mark_report.pdf',
              'boars_mark_investigation_report.pdf',
              'application/pdf',
            ),
            seedDeliverable(
              2,
              'sub_tt04_decrypted_evidence.zip',
              'decrypted_evidence.zip',
              'application/zip',
            ),
          ],
        },
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: sub4.id,
        evaluatorId,
        teamId: team4.id,
        level: 2,
        status: 'EVALUATED',
        score: 85,
        maxScore: 100,
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        submittedAt: new Date(),
        feedback: 'Excellent intrusion vector analysis and forensic evidence chain of custody.',
        criteria: JSON.stringify([
          {
            id: 'crit_1',
            name: 'Intrusion Vector Identification & Initial Access Analysis',
            maxMarks: 30,
            awardedMarks: 28,
            feedback: 'Accurate CVE identification',
          },
          {
            id: 'crit_2',
            name: 'Payload Analysis & Decrypted Evidence Verification',
            maxMarks: 35,
            awardedMarks: 30,
            feedback: 'Evidence payload verified',
          },
          {
            id: 'crit_3',
            name: 'Adversary Persistence Mechanism & Forensics Report Quality',
            maxMarks: 35,
            awardedMarks: 27,
            feedback: 'Clear documentation',
          },
        ]),
      },
    });
    await prisma.team.update({ where: { id: team4.id }, data: { score: 85 } });
    console.log('[PASS] Case 4: Team 04 seeded with Level 2 evaluated submission (85 PTS).');
  }

  // Case 5: Team 5 has Level 3 submission (UNDER_REVIEW, evaluation: IN_REVIEW)
  if (team5) {
    const submitterId = userMap.get('test_p1_t5@odyssey.local')!;
    const sub5 = await prisma.submission.create({
      data: {
        teamId: team5.id,
        userId: submitterId,
        level: 3,
        status: 'UNDER_REVIEW',
        submittedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
        files: {
          create: [
            seedDeliverable(
              3,
              'sub_tt05_level3_report.pdf',
              'twelve_axes_vulnerability_report.pdf',
              'application/pdf',
            ),
          ],
        },
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: sub5.id,
        evaluatorId,
        teamId: team5.id,
        level: 3,
        status: 'IN_REVIEW',
        score: 0,
        maxScore: 100,
        startedAt: new Date(),
      },
    });
    console.log('[PASS] Case 5: Team 05 seeded with Level 3 submission (In Review).');
  }

  console.log('\n=== LOCAL TESTING SETUP COMPLETE ===');
  // Deliberately NOT the value. It is only a fixture credential, but printing a
  // password to stdout puts it in scrollback and CI logs regardless of how
  // unimportant it is, and the habit is the problem. The constant is one grep away.
  console.log('Shared fixture password: see TEST_PASSWORD in scripts/seed-local-testing.ts');
}

if (require.main === module) {
  seedLocalTesting()
    .catch((err) => {
      console.error('Failed to seed local testing setup:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
