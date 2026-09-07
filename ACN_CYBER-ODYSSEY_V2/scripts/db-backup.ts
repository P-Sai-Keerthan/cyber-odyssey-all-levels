/**
 * Consistent online database backup.
 *
 *   npm run db:backup                    # write backups/odyssey-<timestamp>.db
 *   npm run db:backup -- --out path.db   # explicit destination
 *   npm run db:backup -- --verify        # also reopen and integrity-check the copy
 *
 * WHY NOT `cp`
 * ------------
 * Copying a live SQLite file with `cp` is NOT a valid backup. In WAL mode the
 * committed state is split across `dev.db`, `dev.db-wal` and `dev.db-shm`; a plain
 * copy taken mid-write captures a torn snapshot that may fail to open or silently
 * lose the most recent transactions.
 *
 * `VACUUM INTO` performs a transactionally consistent copy from inside a database
 * connection: it takes a read snapshot, writes a fully self-contained database
 * file, and needs no external tooling (the `sqlite3` CLI is frequently absent on
 * a deployment host). The result is a single file with no sidecars.
 *
 * The uploads directory is NOT included — submission files and Creator resources
 * live on disk. A database restored without its matching `uploads/` leaves
 * SubmissionFile rows pointing at missing files, which `npm run db:doctor`
 * detects. Back up both together; see docs/production-readiness.md §21.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Filesystem-safe UTC timestamp: 20260831-142530 */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

async function main() {
  const url = process.env['DATABASE_URL'] ?? '';

  if (!url.startsWith('file:')) {
    console.error(
      'DATABASE_URL is not SQLite. For PostgreSQL use `pg_dump`:\n' +
        '  pg_dump --format=custom --file=odyssey-<timestamp>.dump "$DATABASE_URL"\n' +
        'See docs/production-readiness.md section 21.',
    );
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const target = path.resolve(
    process.cwd(),
    arg('--out') ?? path.join('backups', `odyssey-${stamp()}.db`),
  );

  if (fs.existsSync(target)) {
    console.error(`Refusing to overwrite an existing backup: ${target}`);
    process.exitCode = 1;
    return;
  }

  // Row counts BEFORE, so the backup can be validated against them later.
  const counts = await tableCounts(prisma);

  console.warn('ACN Cyber Odyssey — database backup\n');
  console.warn('  source counts:');
  for (const [table, n] of Object.entries(counts)) {
    console.warn(`    ${table.padEnd(26)} ${String(n).padStart(7)}`);
  }

  // VACUUM INTO requires a path literal; escape single quotes for SQL safety.
  const escaped = target.replace(/'/g, "''");
  await prisma.$queryRawUnsafe(`VACUUM INTO '${escaped}';`);

  const size = fs.statSync(target).size;
  console.warn(`\n  written: ${target}`);
  console.warn(`  size   : ${(size / 1024 / 1024).toFixed(2)} MB`);

  if (process.argv.includes('--verify')) {
    console.warn('\n  verifying backup...');
    const verifier = new PrismaClient({ datasources: { db: { url: `file:${target}` } } });
    try {
      const integrity = (await verifier.$queryRawUnsafe('PRAGMA integrity_check;')) as Array<
        Record<string, unknown>
      >;
      const verdict = String(integrity[0]?.['integrity_check'] ?? 'unknown');
      console.warn(`    integrity_check: ${verdict}`);

      const restored = await tableCounts(verifier);
      let mismatches = 0;
      for (const [table, n] of Object.entries(counts)) {
        const got = restored[table];
        if (got !== n) {
          mismatches++;
          console.error(`    MISMATCH ${table}: source ${n} vs backup ${got}`);
        }
      }

      if (verdict !== 'ok' || mismatches > 0) {
        console.error('\n  BACKUP VERIFICATION FAILED — do not rely on this file.');
        process.exitCode = 1;
      } else {
        console.warn('    all table counts match the source. Backup is valid.');
      }
    } finally {
      await verifier.$disconnect();
    }
  } else {
    console.warn('\n  (run with --verify to integrity-check and count-match the copy)');
  }

  console.warn(
    '\n  REMINDER: also back up the `uploads/` directory. A database restored\n' +
      '  without its matching files leaves submissions pointing at nothing.\n',
  );
}

export async function tableCounts(client: PrismaClient): Promise<Record<string, number>> {
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

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
