/**
 * Applies the SQLite durability + concurrency pragmas to the database file.
 *
 *   npm run db:pragmas
 *
 * `journal_mode = WAL` is stored in the database file header, so running this
 * ONCE per database file is enough — it then applies to every connection and
 * survives restarts. Run it after `prisma db push` / `prisma migrate deploy`
 * and any time the database file is recreated.
 *
 * See src/lib/prisma.ts for why this matters. In short: the SQLite default
 * (`journal_mode = delete`) makes every writer block every reader, which
 * serialises the whole portal under concurrent participant load.
 *
 * No-op on non-SQLite datasources.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const url = process.env['DATABASE_URL'] ?? '';

  if (!url.startsWith('file:')) {
    console.warn('[pragmas] Datasource is not SQLite — nothing to do.');
    return;
  }

  const before = (await prisma.$queryRawUnsafe('PRAGMA journal_mode;')) as Array<
    Record<string, unknown>
  >;
  console.warn(`[pragmas] journal_mode before: ${before[0]?.['journal_mode']}`);

  // `$queryRawUnsafe` (not `$executeRawUnsafe`) — several PRAGMA statements return
  // a result row, which the SQLite execute path rejects with P2010.
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 8000;');
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');

  const after = (await prisma.$queryRawUnsafe('PRAGMA journal_mode;')) as Array<
    Record<string, unknown>
  >;
  const mode = String(after[0]?.['journal_mode'] ?? 'unknown').toLowerCase();
  console.warn(`[pragmas] journal_mode after:  ${mode}`);

  if (mode !== 'wal') {
    throw new Error(
      `Failed to enable WAL mode (journal_mode is still "${mode}"). ` +
        'The database file may be on a network filesystem, which does not support WAL.',
    );
  }

  console.warn('[pragmas] WAL enabled. Readers and the writer no longer block each other.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
