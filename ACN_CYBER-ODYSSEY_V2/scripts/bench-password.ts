/**
 * Password-hash cost benchmark.
 *
 *   npm run bench:password
 *   UV_THREADPOOL_SIZE=16 npm run bench:password
 *
 * WHY THIS EXISTS
 * ---------------
 * `crypto.scrypt` is intentionally expensive and runs on the **libuv threadpool**,
 * not on the main thread and not across all CPU cores. libuv defaults to FOUR
 * threads regardless of how many cores the machine has, so concurrent logins
 * queue behind those four slots.
 *
 * At the start of an event ~210 participants sign in within a few minutes. If a
 * single verification costs ~100 ms and only four can proceed at once, login
 * throughput is capped at roughly 40/second no matter how fast the database is —
 * and every queued login also holds a Node request open.
 *
 * This script measures the real numbers on the target hardware rather than
 * guessing at them.
 */
import * as os from 'os';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';

const SAMPLE_PASSWORD = 'BenchmarkPassword!2026';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

async function measureConcurrent(label: string, concurrency: number, storedHash: string) {
  const durations: number[] = [];
  const started = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const t0 = performance.now();
      await verifyPassword(SAMPLE_PASSWORD, storedHash);
      durations.push(performance.now() - t0);
    }),
  );

  const totalMs = performance.now() - started;
  const sorted = [...durations].sort((a, b) => a - b);

  console.warn(
    `  ${label.padEnd(28)}` +
      `wall ${totalMs.toFixed(0).padStart(7)} ms   ` +
      `p50 ${percentile(sorted, 50).toFixed(0).padStart(6)} ms   ` +
      `p95 ${percentile(sorted, 95).toFixed(0).padStart(6)} ms   ` +
      `max ${(sorted[sorted.length - 1] ?? 0).toFixed(0).padStart(6)} ms   ` +
      `${((concurrency / totalMs) * 1000).toFixed(1).padStart(6)} logins/s`,
  );

  return { totalMs, throughput: (concurrency / totalMs) * 1000 };
}

async function main() {
  const threadpool = process.env['UV_THREADPOOL_SIZE'] ?? '(unset — libuv default 4)';

  console.warn('ACN Cyber Odyssey — Password hash cost benchmark\n');
  console.warn(`  logical CPUs        : ${os.cpus().length}`);
  console.warn(`  UV_THREADPOOL_SIZE  : ${threadpool}`);
  console.warn(`  scrypt params       : Node defaults (N=16384, r=8, p=1), 64-byte key\n`);

  // Single-operation cost, measured in isolation.
  const t0 = performance.now();
  const storedHash = await hashPassword(SAMPLE_PASSWORD);
  const hashMs = performance.now() - t0;

  const t1 = performance.now();
  const ok = await verifyPassword(SAMPLE_PASSWORD, storedHash);
  const verifyMs = performance.now() - t1;

  console.warn(`  single hash   : ${hashMs.toFixed(1)} ms`);
  console.warn(`  single verify : ${verifyMs.toFixed(1)} ms (correct=${ok})\n`);

  console.warn('  Concurrent verification (simulates participants signing in together):');
  await measureConcurrent('4 concurrent', 4, storedHash);
  await measureConcurrent('16 concurrent', 16, storedHash);
  await measureConcurrent('50 concurrent', 50, storedHash);
  const r210 = await measureConcurrent('210 concurrent (full event)', 210, storedHash);

  console.warn('\n  INTERPRETATION');
  console.warn(
    `  All 210 participants signing in at once takes ~${(r210.totalMs / 1000).toFixed(1)} s of ` +
      'password-hashing work alone,',
  );
  console.warn(
    `  sustaining ~${r210.throughput.toFixed(0)} logins/second. This is CPU-bound work on the libuv`,
  );
  console.warn('  threadpool and is independent of database performance.\n');

  if (!process.env['UV_THREADPOOL_SIZE']) {
    console.warn(
      '  NOTE: UV_THREADPOOL_SIZE is unset, so libuv is using 4 threads on a ' +
        `${os.cpus().length}-core machine.`,
    );
    console.warn('  Re-run as `UV_THREADPOOL_SIZE=16 npm run bench:password` to compare.\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
