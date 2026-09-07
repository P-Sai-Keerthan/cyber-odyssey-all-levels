/**
 * Database Doctor — operational integrity + capacity inspector.
 *
 * Read-only. Never mutates data. Safe to run against production.
 *
 *   npm run db:doctor
 *
 * Verifies the invariants the event depends on:
 *   1. No team exceeds the 3-participant capacity limit.
 *   2. No participant holds membership in more than one team.
 *   3. No team has more than one submission per level.
 *   4. No submission has more than one evaluation.
 *   5. Team.score matches the sum of its EVALUATED evaluations.
 *   6. No orphaned submission files (DB row without a file on disk).
 *   7. SQLite durability/concurrency pragmas are configured (SQLite only).
 *
 * Exits non-zero if any invariant is violated, so it can gate a deploy.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { computeTeamOfficialTotal } from '../src/lib/leaderboard/team-total';

const prisma = new PrismaClient();

interface Finding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  check: string;
  message: string;
}

const findings: Finding[] = [];

function report(severity: Finding['severity'], check: string, message: string) {
  findings.push({ severity, check, message });
}

async function checkTeamCapacity() {
  const teams = await prisma.team.findMany({
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  const over = teams.filter((t) => t._count.members > 3);
  for (const t of over) {
    report(
      'CRITICAL',
      'team-capacity',
      `Team "${t.name}" (${t.id}) has ${t._count.members} members — exceeds the maximum of 3.`,
    );
  }
  console.warn(`  teams=${teams.length} over-capacity=${over.length}`);
}

async function checkSingleMembership() {
  // TeamMember.userId is @unique, so a violation is only possible if the
  // constraint was dropped. Verified defensively via aggregation.
  const grouped = await prisma.teamMember.groupBy({
    by: ['userId'],
    _count: { id: true },
  });
  const multi = grouped.filter((g) => g._count.id > 1);
  for (const g of multi) {
    report(
      'CRITICAL',
      'single-membership',
      `User ${g.userId} holds ${g._count.id} team memberships — must be exactly 1.`,
    );
  }
  console.warn(`  memberships=${grouped.length} multi-team=${multi.length}`);
}

async function checkSubmissionUniqueness() {
  const grouped = await prisma.submission.groupBy({
    by: ['teamId', 'level'],
    _count: { id: true },
  });
  const dupes = grouped.filter((g) => g._count.id > 1);
  for (const g of dupes) {
    report(
      'CRITICAL',
      'submission-uniqueness',
      `Team ${g.teamId} has ${g._count.id} submissions for level ${g.level} — must be at most 1.`,
    );
  }
  console.warn(`  submission (team,level) groups=${grouped.length} duplicates=${dupes.length}`);
}

async function checkEvaluationUniqueness() {
  const grouped = await prisma.evaluation.groupBy({
    by: ['submissionId'],
    _count: { id: true },
  });
  const dupes = grouped.filter((g) => g._count.id > 1);
  for (const g of dupes) {
    report(
      'CRITICAL',
      'evaluation-uniqueness',
      `Submission ${g.submissionId} has ${g._count.id} evaluations — must be at most 1.`,
    );
  }
  console.warn(`  evaluations=${grouped.length} duplicates=${dupes.length}`);
}

async function checkScoreConsistency() {
  // The invariant is `Team.score === the squad's official total`, and that total
  // is defined in exactly one place: computeTeamOfficialTotal.
  //
  // This check used to compare against `sum(Evaluation where status='EVALUATED')`,
  // which was never the rule the application applied — the recompute has always
  // keyed on `approvalStatus = 'APPROVED'`, so an evaluation finalised but not yet
  // approved made the doctor report HIGH drift on a perfectly healthy database.
  // It is now further out of date: the stored score also carries Level 1 results,
  // Level 3 discoveries and approved adjustments. Restating the rule here is how
  // it drifted; deriving it is how it stops.
  const teams = await prisma.team.findMany({ select: { id: true, name: true, score: true } });

  let drifted = 0;
  for (const t of teams) {
    const { total } = await computeTeamOfficialTotal(prisma, t.id);
    if (t.score !== total) {
      drifted++;
      report(
        'HIGH',
        'score-consistency',
        `Team "${t.name}" (${t.id}) has score ${t.score} but its official total is ${total}.`,
      );
    }
  }
  console.warn(`  teams=${teams.length} score-drift=${drifted}`);
}

async function checkSubmissionFilesOnDisk() {
  const files = await prisma.submissionFile.findMany({
    select: { id: true, originalName: true, storagePath: true },
  });
  let missing = 0;
  for (const f of files) {
    const resolved = path.isAbsolute(f.storagePath)
      ? f.storagePath
      : path.resolve(process.cwd(), f.storagePath);
    if (!fs.existsSync(resolved)) {
      missing++;
      report(
        'MEDIUM',
        'submission-files',
        `SubmissionFile ${f.id} ("${f.originalName}") is recorded in the database but missing on disk at ${f.storagePath}.`,
      );
    }
  }
  console.warn(`  submission files=${files.length} missing-on-disk=${missing}`);
}

async function checkSqlitePragmas() {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url.startsWith('file:')) {
    console.warn('  datasource is not SQLite — pragma checks skipped');
    report(
      'INFO',
      'sqlite-pragmas',
      'Datasource is not SQLite; concurrency is governed by the server database configuration.',
    );
    return;
  }

  const journal = (await prisma.$queryRawUnsafe('PRAGMA journal_mode;')) as Array<
    Record<string, unknown>
  >;
  const mode = String(journal[0]?.['journal_mode'] ?? 'unknown').toLowerCase();
  console.warn(`  sqlite journal_mode=${mode}`);

  if (mode !== 'wal') {
    report(
      'HIGH',
      'sqlite-pragmas',
      `SQLite journal_mode is "${mode}", not "wal". Without WAL, readers block writers and the ` +
        'portal will stall under concurrent participant load.',
    );
  }

  report(
    'INFO',
    'sqlite-capacity',
    'SQLite permits a single concurrent writer. See docs/production/phase-17-production-readiness.md ' +
      'section 2 before running the 210-participant event on this datasource.',
  );
}

/**
 * The evaluation rubric for a level must sum to that level's configured maximum.
 *
 * `LevelState.maxScore` is the authoritative cap (see lib/evaluation/level-max-score.ts).
 * Criteria are a breakdown of it. When they disagree the level is misconfigured:
 * the evaluator console suppresses the rubric and scores against the configured
 * maximum, which is safe but is not what an Admin who built the rubric intended.
 *
 * This check exists because the disagreement is invisible on screen — every
 * number renders faithfully from the database, and only adding up the rubric
 * reveals that its total is not the level's maximum. A test suite that creates
 * criteria and does not remove them produces exactly this state.
 */
async function checkCriteriaMatchLevelMax() {
  const [levels, criteria] = await Promise.all([
    prisma.levelState.findMany({ select: { levelNumber: true, maxScore: true } }),
    prisma.evaluationCriterion.findMany({
      where: { isActive: true },
      select: { levelNumber: true, maxPoints: true },
    }),
  ]);

  let mismatched = 0;
  for (const level of levels) {
    const rows = criteria.filter((c) => c.levelNumber === level.levelNumber);
    if (rows.length === 0) continue; // No rubric is a valid configuration.

    const sum = rows.reduce((acc, c) => acc + c.maxPoints, 0);
    if (sum !== level.maxScore) {
      mismatched++;
      report(
        'HIGH',
        'criteria-vs-level-max',
        `Level ${level.levelNumber} has ${rows.length} active criteria totalling ${sum} PTS, ` +
          `but LevelState.maxScore is ${level.maxScore} PTS. The evaluator console will ignore ` +
          `the rubric and score out of ${level.maxScore}. Fix at Admin -> Evaluations -> Criteria & Rubric, ` +
          `or change the level maximum at Admin -> Levels.`,
      );
    }
  }

  console.warn(
    `  levels with a rubric=${new Set(criteria.map((c) => c.levelNumber)).size} mismatched=${mismatched}`,
  );
}

async function main() {
  console.warn('ACN Cyber Odyssey — Database Doctor\n');
  console.warn('Running integrity checks...');

  await checkTeamCapacity();
  await checkSingleMembership();
  await checkSubmissionUniqueness();
  await checkEvaluationUniqueness();
  await checkScoreConsistency();
  await checkCriteriaMatchLevelMax();
  await checkSubmissionFilesOnDisk();
  await checkSqlitePragmas();

  console.warn('\n--- FINDINGS ---');
  if (findings.length === 0) {
    console.warn('No issues found. All integrity invariants hold.');
  } else {
    for (const f of findings) {
      console.warn(`[${f.severity}] ${f.check}: ${f.message}`);
    }
  }

  const blocking = findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  console.warn(`\n${findings.length} finding(s), ${blocking.length} blocking (CRITICAL/HIGH).`);

  if (blocking.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
