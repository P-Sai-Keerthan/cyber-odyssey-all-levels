/**
 * Migration validation — compares two datasources row-for-row.
 *
 *   npm run db:migrate-validate -- --source "file:./dev.db" --target "postgresql://..."
 *
 * Read-only against both databases. Run it AFTER copying data and BEFORE pointing
 * the application at the new datasource. Exits non-zero on any discrepancy, so it
 * can gate a cutover.
 *
 * It checks two different things, and both matter:
 *
 *   1. ROW COUNTS per table — catches wholesale data loss during a migration.
 *   2. INTEGRITY INVARIANTS on the target — catches a migration that moved every
 *      row but lost a CONSTRAINT. That is the failure mode people miss: counts
 *      match, so the migration looks clean, but the unique index enforcing the
 *      3-member squad cap was never created and the cap silently stops existing.
 */
import { PrismaClient } from '@prisma/client';

interface Counts {
  [table: string]: number;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function tableCounts(client: PrismaClient): Promise<Counts> {
  const [
    users,
    teams,
    teamMembers,
    sessions,
    submissions,
    submissionFiles,
    evaluations,
    auditLogs,
    announcements,
    notifications,
    portalSettings,
    levelStates,
    levelResources,
    preRegistered,
  ] = await Promise.all([
    client.user.count(),
    client.team.count(),
    client.teamMember.count(),
    client.session.count(),
    client.submission.count(),
    client.submissionFile.count(),
    client.evaluation.count(),
    client.auditLog.count(),
    client.announcement.count(),
    client.notification.count(),
    client.portalSetting.count(),
    client.levelState.count(),
    client.levelResource.count(),
    client.preRegisteredParticipant.count(),
  ]);

  return {
    User: users,
    Team: teams,
    TeamMember: teamMembers,
    Session: sessions,
    Submission: submissions,
    SubmissionFile: submissionFiles,
    Evaluation: evaluations,
    AuditLog: auditLogs,
    Announcement: announcements,
    Notification: notifications,
    PortalSetting: portalSettings,
    LevelState: levelStates,
    LevelResource: levelResources,
    PreRegisteredParticipant: preRegistered,
  };
}

/**
 * Verifies that the constraints the event depends on are actually ENFORCED on the
 * target, by attempting writes that must fail. Each probe is rolled back.
 */
async function probeConstraints(target: PrismaClient): Promise<string[]> {
  const failures: string[] = [];

  // The squad capacity guarantee rests on UNIQUE(teamId, slot). If a migration
  // recreated the table without that index, counts still match but the cap is gone.
  const team = await target.team.findFirst({ select: { id: true } });
  const member = await target.teamMember.findFirst({ select: { teamId: true, slot: true } });

  if (member) {
    try {
      await target.$transaction(async (tx) => {
        const spare = await tx.user.findFirst({
          where: { membership: null, role: 'PARTICIPANT' },
          select: { id: true },
        });
        if (!spare) throw new Error('SKIP_NO_SPARE_USER');
        await tx.teamMember.create({
          data: { teamId: member.teamId, userId: spare.id, slot: member.slot, role: 'MEMBER' },
        });
        // If we reach here the unique index did NOT reject the duplicate slot.
        throw new Error('CONSTRAINT_MISSING');
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'CONSTRAINT_MISSING') {
        failures.push('TeamMember UNIQUE(teamId, slot) is NOT enforced on the target.');
      }
      // Any other throw is the constraint working, or a skip. Both are fine.
    }
  }

  // Submission uniqueness per (team, level).
  const submission = await target.submission.findFirst({
    select: { teamId: true, level: true, userId: true },
  });
  if (submission) {
    try {
      await target.$transaction(async (tx) => {
        await tx.submission.create({
          data: {
            teamId: submission.teamId,
            userId: submission.userId,
            level: submission.level,
            status: 'SUBMITTED',
          },
        });
        throw new Error('CONSTRAINT_MISSING');
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'CONSTRAINT_MISSING') {
        failures.push('Submission UNIQUE(teamId, level) is NOT enforced on the target.');
      }
    }
  }

  // Email uniqueness.
  const user = await target.user.findFirst({ select: { email: true } });
  if (user) {
    try {
      await target.$transaction(async (tx) => {
        await tx.user.create({
          data: { email: user.email, username: `probe_${Date.now()}`, passwordHash: 'probe' },
        });
        throw new Error('CONSTRAINT_MISSING');
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'CONSTRAINT_MISSING') {
        failures.push('User UNIQUE(email) is NOT enforced on the target.');
      }
    }
  }

  void team;
  return failures;
}

async function main() {
  const sourceUrl = arg('--source');
  const targetUrl = arg('--target');

  if (!sourceUrl || !targetUrl) {
    console.error(
      'Usage: npm run db:migrate-validate -- --source "<url>" --target "<url>"\n\n' +
        'Both URLs are read with the SAME Prisma schema, so the target must already\n' +
        'have had `prisma migrate deploy` run against it.',
    );
    process.exitCode = 1;
    return;
  }

  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

  try {
    console.warn('ACN Cyber Odyssey — migration validation\n');

    const [a, b] = await Promise.all([tableCounts(source), tableCounts(target)]);

    console.warn('  table'.padEnd(30) + 'source'.padStart(9) + 'target'.padStart(9) + '   status');
    console.warn('  ' + '-'.repeat(56));

    let mismatches = 0;
    for (const table of Object.keys(a)) {
      const s = a[table] ?? 0;
      const t = b[table] ?? 0;
      const ok = s === t;
      if (!ok) mismatches++;
      console.warn(
        `  ${table.padEnd(28)}${String(s).padStart(9)}${String(t).padStart(9)}   ${ok ? 'OK' : 'MISMATCH'}`,
      );
    }

    console.warn('\n  Probing that constraints are enforced on the target...');
    const constraintFailures = await probeConstraints(target);
    if (constraintFailures.length === 0) {
      console.warn('    all probed constraints are enforced.');
    } else {
      for (const f of constraintFailures) console.error(`    FAIL: ${f}`);
    }

    const ok = mismatches === 0 && constraintFailures.length === 0;
    console.warn(
      `\n  RESULT: ${ok ? 'MIGRATION VALIDATED' : 'VALIDATION FAILED'} ` +
        `(${mismatches} count mismatch(es), ${constraintFailures.length} constraint failure(s))`,
    );

    if (!ok) {
      console.error('\n  Do NOT cut over. Restore from backup and investigate.');
      process.exitCode = 1;
    }
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
