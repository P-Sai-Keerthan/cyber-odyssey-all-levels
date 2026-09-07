import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

/** Minimum acceptable length for the bootstrap Creator password. */
const MIN_CREATOR_PASSWORD_LENGTH = 12;

/**
 * Level 3 evaluated components.
 *
 * The event's published figures. They are seeded into `EvaluationCriterion`,
 * which is the authority thereafter — an Admin editing a criterion changes what
 * the evaluator scores against AND what the participant is shown, because both
 * read the same rows. These constants only decide where a fresh database starts.
 */
/** Level 1's published point value. Automatic scoring; no evaluated deliverable. */
const LEVEL1_MAX_SCORE = 100;

const LEVEL3_REPORT_POINTS = 200;

/**
 * Level 3's evaluated maximum is the FINAL REPORT alone: 200 PTS.
 *
 * A separate "Level 3 Response" criterion previously sat beside it, making the
 * level's evaluated ceiling 400. It is retired below rather than deleted — it
 * carries no scores, and an inactive row stays inspectable if the decision is
 * ever revisited. Only ACTIVE criteria count toward the ceiling.
 */
const LEVEL3_EVALUATED_MAX = LEVEL3_REPORT_POINTS;

const PRE_REGISTERED_EMAILS = [
  { email: 'participant1@acn.org', name: 'Alex Rivera' },
  { email: 'participant2@acn.org', name: 'Jordan Hayes' },
  { email: 'participant3@acn.org', name: 'Taylor Swift' },
  { email: 'participant4@acn.org', name: 'Morgan Reed' },
  { email: 'participant5@acn.org', name: 'Casey Vance' },
  { email: 'participant6@acn.org', name: 'Sam Chen' },
  { email: 'participant7@acn.org', name: 'Riley Stone' },
  { email: 'participant8@acn.org', name: 'Devon Knight' },
  { email: 'participant9@acn.org', name: 'Avery Frost' },
  { email: 'participant10@acn.org', name: 'Rowan Cross' },
];

async function main() {
  console.warn('Seeding pre-registered participants and Creator account...');

  for (const item of PRE_REGISTERED_EMAILS) {
    await prisma.preRegisteredParticipant.upsert({
      where: { email: item.email.toLowerCase() },
      update: { name: item.name },
      create: {
        email: item.email.toLowerCase(),
        name: item.name,
      },
    });
  }

  // Seed secure Creator Account for approval management & portal operations.
  //
  // SECURITY (Phase 17 / SEC-17-01): credentials are sourced EXCLUSIVELY from the
  // environment. There is deliberately no hardcoded fallback — a default password
  // committed to source is a standing compromise of the highest-privilege account.
  // If the variables are absent the Creator is skipped (loudly) rather than being
  // created with a guessable password.
  const creatorEntries = [
    {
      emailRaw: process.env['CREATOR_EMAIL'],
      passwordRaw: process.env['CREATOR_PASSWORD'],
      usernameRaw: process.env['CREATOR_USERNAME'],
    },
    {
      emailRaw: process.env['CREATOR_2_EMAIL'],
      passwordRaw: process.env['CREATOR_2_PASSWORD'],
      usernameRaw: process.env['CREATOR_2_USERNAME'],
    },
  ];

  let seededCreators = 0;
  for (const entry of creatorEntries) {
    if (entry.emailRaw && entry.passwordRaw) {
      if (entry.passwordRaw.length < MIN_CREATOR_PASSWORD_LENGTH) {
        throw new Error(
          `CREATOR_PASSWORD must be at least ${MIN_CREATOR_PASSWORD_LENGTH} characters. ` +
            'Refusing to seed a weak password for the highest-privilege account.',
        );
      }
      const creatorEmail = entry.emailRaw.trim().toLowerCase();
      const creatorUsername =
        entry.usernameRaw?.trim().replace(/^["']|["']$/g, '') || 'event_creator';
      const creatorPasswordHash = await hashPassword(entry.passwordRaw);

      await prisma.user.upsert({
        where: { email: creatorEmail },
        update: {
          username: creatorUsername,
          role: 'CREATOR',
          status: 'ACTIVE',
          passwordHash: creatorPasswordHash,
        },
        create: {
          email: creatorEmail,
          username: creatorUsername,
          passwordHash: creatorPasswordHash,
          role: 'CREATOR',
          status: 'ACTIVE',
        },
      });
      seededCreators++;
    }
  }

  if (seededCreators === 0) {
    console.warn(
      '[seed] SKIPPED Creator account: CREATOR_EMAIL and CREATOR_PASSWORD are not set.\n' +
        '       Copy .env.example to .env, set both values, then re-run `npm run db:seed`.',
    );
  }

  // Seed default Portal Settings (Online by default)
  await prisma.portalSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      isOnline: true,
    },
  });

  // Seed default Level States for authoritative timer and lifecycle control
  const now = new Date();
  const level2End = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // Level 1's configured maximum is 100 PTS — the level's published value.
  //
  // It was 1000, copied from Level 2. Level 1 is scored automatically by the
  // challenge bridge and has no deliverable, so nothing read the figure and the
  // error stayed invisible; but `LevelState.maxScore` is now the authoritative
  // cap the evaluator console scores against, so a Level 1 submission (an
  // operator can create one) would have been scored out of 1000 for a level
  // worth 100.
  await prisma.levelState.upsert({
    where: { levelNumber: 1 },
    update: { maxScore: LEVEL1_MAX_SCORE },
    create: {
      levelNumber: 1,
      name: 'Level 1 — The Initial Trace',
      codename: 'THE INITIAL TRACE',
      status: 'LOCKED',
      maxScore: LEVEL1_MAX_SCORE,
      durationMinutes: 60,
      durationSeconds: 3600,
      remainingSeconds: 3600,
    },
  });

  await prisma.levelState.upsert({
    where: { levelNumber: 2 },
    update: { maxScore: 1000 },
    create: {
      levelNumber: 2,
      name: "Level 2 — The Boar's Mark",
      codename: "THE BOAR'S MARK",
      status: 'LIVE',
      maxScore: 1000,
      durationMinutes: 120,
      durationSeconds: 7200,
      remainingSeconds: 7200,
      startedAt: now,
      endsAt: level2End,
    },
  });

  // Level 3's evaluated maximum is REPORT (200) + RESPONSE (200). It is a
  // fallback only: `getLevel3EvaluatedPoints` reads the keyed criteria rows
  // below, which are the authority. Kept in step so the two can never disagree.
  await prisma.levelState.upsert({
    where: { levelNumber: 3 },
    update: { maxScore: LEVEL3_EVALUATED_MAX },
    create: {
      levelNumber: 3,
      name: 'Level 3 — The Twelve Axes',
      codename: 'THE TWELVE AXES',
      status: 'LOCKED',
      maxScore: LEVEL3_EVALUATED_MAX,
      durationMinutes: 120,
      durationSeconds: 7200,
      remainingSeconds: 7200,
    },
  });

  // Seed default official announcements if table is empty
  const announcementCount = await prisma.announcement.count();
  if (announcementCount === 0) {
    await prisma.announcement.createMany({
      data: [
        {
          title: 'Cyber Odyssey V2 Operations Initialized',
          content:
            'Welcome investigators to ACN Cyber Odyssey. Ensure your squads are assembled, credentials confirmed, and forensic tools ready before Level 1 challenges commence.',
          category: 'MISSION',
          priority: 'HIGH',
          targetAudience: 'ALL',
          published: true,
        },
        {
          title: 'Investigation Protocols & Evidence Integrity Standards',
          content:
            'All forensic findings and hashes submitted through the terminal are verified in real-time. Review the Tactical Briefing tab for full rules and submission procedures.',
          category: 'SYSTEM',
          priority: 'NORMAL',
          targetAudience: 'PARTICIPANTS',
          published: true,
        },
        {
          title: 'Sector ALPHA-09 Signal Telemetry Live',
          content:
            'Signal telemetry monitoring is now active across Sector ALPHA-09. Report any communication discrepancies to Command Desk marshals immediately.',
          category: 'GENERAL',
          priority: 'NORMAL',
          targetAudience: 'ALL',
          published: true,
        },
      ],
    });
  }

  // Seed default Level 2 resources if not already present
  const resourceDir = path.join(process.cwd(), 'uploads', 'resources', 'level-2');
  if (!fs.existsSync(resourceDir)) {
    fs.mkdirSync(resourceDir, { recursive: true });
  }

  const defaultEvidencePath = path.join(resourceDir, 'cyber_odyssey_level2_evidence.zip');
  if (!fs.existsSync(defaultEvidencePath)) {
    fs.writeFileSync(
      defaultEvidencePath,
      Buffer.from('ACN CYBER ODYSSEY // LEVEL 2 EVIDENCE PACKAGE\n', 'utf-8'),
    );
  }
  const evidenceStats = fs.statSync(defaultEvidencePath);

  await prisma.levelResource.upsert({
    where: {
      levelNumber_resourceKey: {
        levelNumber: 2,
        resourceKey: 'EVIDENCE_PACKAGE',
      },
    },
    update: {},
    create: {
      levelNumber: 2,
      resourceKey: 'EVIDENCE_PACKAGE',
      title: 'Evidence Package',
      fileName: 'cyber_odyssey_level2_evidence.zip',
      originalName: 'cyber_odyssey_level2_evidence.zip',
      storagePath: defaultEvidencePath,
      fileSize: evidenceStats.size,
      mimeType: 'application/zip',
      isPublished: true,
    },
  });

  const defaultSamplePath = path.join(resourceDir, 'cyber_odyssey_level2_sample_report.pdf');
  if (!fs.existsSync(defaultSamplePath)) {
    fs.writeFileSync(
      defaultSamplePath,
      Buffer.from('%PDF-1.4\n% ACN CYBER ODYSSEY // SAMPLE REPORT\n', 'utf-8'),
    );
  }
  const sampleStats = fs.statSync(defaultSamplePath);

  await prisma.levelResource.upsert({
    where: {
      levelNumber_resourceKey: {
        levelNumber: 2,
        resourceKey: 'SAMPLE_REPORT',
      },
    },
    update: {},
    create: {
      levelNumber: 2,
      resourceKey: 'SAMPLE_REPORT',
      title: 'Sample Investigation Report',
      fileName: 'cyber_odyssey_level2_sample_report.pdf',
      originalName: 'cyber_odyssey_level2_sample_report.pdf',
      storagePath: defaultSamplePath,
      fileSize: sampleStats.size,
      mimeType: 'application/pdf',
      isPublished: true,
    },
  });

  // Seed default dynamic evaluation criteria for Level 2 and Level 3
  interface SeedCriterion {
    id: string;
    /** Present only for criteria something outside the evaluator console reads. */
    key?: string;
    levelNumber: number;
    title: string;
    description: string;
    maxPoints: number;
    sortOrder: number;
    isActive: boolean;
    guidance: string;
    required: boolean;
  }

  const defaultCriteria: SeedCriterion[] = [
    // Level 2 Forensics Criteria (Sum = 1000 PTS)
    {
      id: 'l2_crit_1',
      levelNumber: 2,
      title: 'Intrusion Vector & Initial Access Analysis',
      description:
        'Evaluate the squad’s identification of initial compromise mechanisms, access vectors, and triage findings.',
      maxPoints: 250,
      sortOrder: 1,
      isActive: true,
      guidance: 'Assess initial phishing, token manipulation, or credential abuse evidence.',
      required: true,
    },
    {
      id: 'l2_crit_2',
      levelNumber: 2,
      title: 'Payload Analysis & Decrypted Evidence Verification',
      description:
        'Examine recovered binary artifacts, decryptions, malware behavior, and corroborating indicators.',
      maxPoints: 250,
      sortOrder: 2,
      isActive: true,
      guidance: 'Verify analysis of recovered payloads, decryptions, and artifact hashes.',
      required: true,
    },
    {
      id: 'l2_crit_3',
      levelNumber: 2,
      title: 'Adversary Persistence & Forensic Artifact Quality',
      description:
        'Evaluate depth of persistence discovery, system logs, registry modifications, and evidence preservation.',
      maxPoints: 250,
      sortOrder: 3,
      isActive: true,
      guidance:
        'Inspect persistence mechanisms, scheduled tasks, registry modifications, or lateral traces.',
      required: true,
    },
    {
      id: 'l2_crit_4',
      levelNumber: 2,
      title: 'Timeline Reconstruction & Comprehensive Correlation',
      description:
        'Verify end-to-end incident timeline, cross-source evidence correlation, and formal report clarity.',
      maxPoints: 250,
      sortOrder: 4,
      isActive: true,
      guidance: 'Check chronological event timeline, IP correlation, and overall report rigor.',
      required: true,
    },

    // Level 3 Final Report Criteria (Sum = 1000 PTS)
    // -----------------------------------------------------------------------
    // LEVEL 3 — two scored components, each addressed by a stable `key`.
    //
    // The participant page displays these two maxima by name, so they are
    // resolved by key rather than by title: an Admin is entitled to reword a
    // criterion, and doing so must not silently change what a participant is
    // told the level is worth.
    //
    // The four earlier Level 3 criteria (l3_crit_1..4, 250 PTS each) are
    // DEACTIVATED rather than deleted, below — they carry no scores, but
    // deactivating keeps them recoverable and keeps the audit trail honest.
    // Only active criteria contribute to the evaluator's maximum.
    // -----------------------------------------------------------------------
    {
      id: 'l3_crit_report',
      key: 'LEVEL3_REPORT',
      levelNumber: 3,
      title: 'Final Investigation Report',
      description:
        'The written investigation report: findings, reproduction detail, evidence quality, root-cause depth and remediation.',
      maxPoints: LEVEL3_REPORT_POINTS,
      sortOrder: 1,
      isActive: true,
      guidance:
        'Score the written deliverable only. Reproduction clarity, evidence artefacts, root-cause reasoning and actionable mitigations.',
      required: true,
    },
    {
      id: 'l3_crit_response',
      key: 'LEVEL3_RESPONSE',
      levelNumber: 3,
      title: 'Level 3 Response (retired)',
      description:
        'The squad response: incident handling, containment reasoning, and the defensibility of the conclusions drawn.',
      maxPoints: 0,
      sortOrder: 2,
      isActive: false,
      guidance:
        'Score the response separately from the written report. Containment reasoning, prioritisation, and how well the squad defends its findings.',
      required: true,
    },
  ];

  for (const crit of defaultCriteria) {
    await prisma.evaluationCriterion.upsert({
      where: { id: crit.id },
      update: {
        // `key` is included so a database seeded before the column existed picks
        // it up on the next run rather than staying unkeyed and invisible to
        // `getLevel3EvaluatedPoints`.
        key: crit.key ?? null,
        title: crit.title,
        description: crit.description,
        maxPoints: crit.maxPoints,
        sortOrder: crit.sortOrder,
        isActive: crit.isActive,
        guidance: crit.guidance,
        required: crit.required,
      },
      create: crit,
    });
  }

  // Retire the four legacy Level 3 criteria. `updateMany` rather than `delete`:
  // they are superseded, not wrong, and an inactive row costs nothing while a
  // deleted one cannot be inspected after a scoring question is raised.
  await prisma.evaluationCriterion.updateMany({
    where: { id: { in: ['l3_crit_1', 'l3_crit_2', 'l3_crit_3', 'l3_crit_4'] } },
    data: { isActive: false },
  });

  console.warn(
    'Seeded pre-registered participants, Creator account, level states, resources, official announcements, and dynamic evaluation criteria.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
