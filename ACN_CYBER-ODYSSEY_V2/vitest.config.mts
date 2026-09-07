import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Matches `DATABASE_URL=...` in a dotenv file, quoted or bare. */
const DB_URL_PATTERN = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m;

function readUrlFrom(file: string): string | undefined {
  try {
    const contents = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    return DB_URL_PATTERN.exec(contents)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Which database the test suite runs against.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE DATABASE
 * ---------------------------------------------------------------------------
 * Several suites `deleteMany({})` whole tables — users, teams, submissions,
 * evaluation criteria — as part of their setup. That is legitimate for a test,
 * and catastrophic if it lands on the database an operator is looking at. While
 * the portal was on SQLite the blast radius was one local file; on PostgreSQL it
 * is a real server that an event could be running against.
 *
 * So tests resolve `odyssey_portal_test` from `.env.test`, separate from the
 * `odyssey_portal` database `.env` names. Precedence:
 *
 *   1. an explicitly exported DATABASE_URL   (CI decides)
 *   2. .env.test                             (local default for tests)
 *   3. .env                                  (last resort)
 *
 * ---------------------------------------------------------------------------
 * POOL PARAMETERS
 * ---------------------------------------------------------------------------
 * Only appended for a `file:` URL. Prisma's SQLite connector defaults to ONE
 * pooled connection, so without them the concurrency suites contend in a way
 * nobody would deploy — and concurrency BUGS could pass unnoticed because the
 * contention never materialises (BUG-16-02). A PostgreSQL URL carries its own
 * pool settings and is never rewritten here.
 */
function testDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'] ?? readUrlFrom('./.env.test') ?? readUrlFrom('./.env');

  if (!url) {
    throw new Error(
      'No DATABASE_URL for the test run. Create .env.test pointing at a DISPOSABLE ' +
        'database (odyssey_portal_test) — the suite truncates tables and must never ' +
        'be pointed at the database an event is running on.',
    );
  }

  if (!url.startsWith('file:') || url.includes('connection_limit=')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=12&pool_timeout=30&socket_timeout=30`;
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl(),
    },
    testTimeout: 15000,
    hookTimeout: 15000,
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{mjs,ts}',
    ],
    exclude: ['node_modules/**', '.next/**'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'scripts/lib/**'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/stubs/server-only.ts', import.meta.url)),
    },
  },
});
