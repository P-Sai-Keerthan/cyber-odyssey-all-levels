import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPragmasApplied: boolean | undefined;
};

/**
 * Slow-query threshold. Queries exceeding this are surfaced on stderr so that
 * event-day bottlenecks are visible without attaching a profiler (§35 Observability).
 * Only the query duration and target are logged — never parameters, which can
 * contain password hashes or team join codes.
 */
const SLOW_QUERY_MS = Number(process.env['SLOW_QUERY_MS'] ?? 300);

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : [{ emit: 'event', level: 'query' }, 'error'],
  });

  // Structured slow-query telemetry. `e.query` is the parameterised SQL template;
  // `e.params` is deliberately NOT logged (§24 / §35: no secrets in logs).
  client.$on('query' as never, (e: { duration: number; query: string }) => {
    if (e.duration >= SLOW_QUERY_MS) {
      console.warn(`[prisma:slow] ${e.duration}ms ${e.query.slice(0, 200)}`);
    }
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;

/**
 * Applies the SQLite durability and concurrency pragmas the event depends on.
 *
 * WHY THIS MATTERS (Phase 17 / DB-17-02):
 * A freshly-created SQLite database defaults to `journal_mode = delete`, in which a
 * writer takes an EXCLUSIVE lock that blocks every concurrent reader. With ~210
 * participants reading dashboards while audit logs and activity timestamps are being
 * written, the entire portal serialises behind each write and requests time out.
 *
 *   - `journal_mode = WAL`  — readers no longer block the writer and vice versa.
 *                             This setting is persisted in the database file header,
 *                             so it survives restarts and applies to every connection.
 *   - `busy_timeout = 8000` — a connection that finds the write lock held waits up to
 *                             8s instead of failing immediately with SQLITE_BUSY.
 *                             This pragma is per-connection.
 *   - `synchronous = NORMAL`— the standard, safe pairing with WAL: durable across
 *                             application crashes, with far fewer fsyncs than FULL.
 *   - `foreign_keys = ON`   — enforce referential integrity and cascade rules.
 *
 * WAL still permits only ONE writer at a time. It raises the ceiling substantially
 * but does not remove it — see docs/production/phase-17-production-readiness.md §2
 * for the PostgreSQL migration path required for the full event.
 *
 * Non-SQLite datasources are a no-op: concurrency there is a server-side concern.
 */
export async function applyDatabasePragmas(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url.startsWith('file:')) return;

  try {
    // WAL is persistent in the database header — setting it once is sufficient,
    // but re-asserting is idempotent and cheap.
    //
    // `$queryRawUnsafe` (not `$executeRawUnsafe`) — several PRAGMA statements
    // return a result row, which the SQLite execute path rejects with P2010.
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 8000;');
    await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
  } catch (error) {
    // Never let pragma configuration take the portal down; log and continue on
    // the (slower) default journal mode.
    console.error('[prisma] Failed to apply SQLite pragmas:', error);
  }
}

/**
 * Idempotent, fire-and-forget pragma application for the Next.js server runtime.
 * Guarded on `globalThis` so repeated module evaluation (dev HMR, route isolation)
 * does not re-issue the statements on every request.
 */
export function ensureDatabasePragmas(): void {
  if (globalForPrisma.prismaPragmasApplied) return;
  globalForPrisma.prismaPragmasApplied = true;
  void applyDatabasePragmas();
}

/**
 * Warns loudly at startup if a SQLite datasource has no connection pool configured.
 *
 * Prisma's SQLite connector defaults to ONE pooled connection. Every interactive
 * transaction therefore queues behind that single connection and, past the
 * 10-second default pool timeout, simply fails.
 *
 * Measured on the 50-squad fixture (scripts/load-test.ts), simultaneous
 * submissions with the default pool:  40 of 50 FAILED, p50 10,935 ms.
 * The same run with `?connection_limit=12&pool_timeout=30`: 0 failed, p50 36 ms.
 *
 * This is silent misconfiguration with a catastrophic event-day failure mode, so
 * it is surfaced at boot rather than discovered at the submission deadline.
 */
function warnOnUnpooledSqlite(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url.startsWith('file:')) return;
  if (url.includes('connection_limit=')) return;

  console.warn(
    '\n[prisma] WARNING: SQLite DATABASE_URL has no `connection_limit`.\n' +
      '         Prisma defaults to a single connection, which makes concurrent\n' +
      '         submissions and evaluations fail under event load.\n' +
      '         Measured: 40 of 50 simultaneous submissions failed without it.\n' +
      '         Fix: DATABASE_URL="file:./dev.db?connection_limit=12&pool_timeout=30&socket_timeout=30"\n' +
      '         See .env.example and docs/production/phase-17-production-readiness.md section 2.\n',
  );
}

ensureDatabasePragmas();
warnOnUnpooledSqlite();
