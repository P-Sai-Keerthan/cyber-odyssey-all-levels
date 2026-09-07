/**
 * Drains the Portal integration outbox.
 *
 * The application drains opportunistically on each scoring request (see
 * `maybeDrain` in lib/outbox.js), which is enough while play is busy. This script
 * is the guarantee underneath that: run it on a timer and delivery no longer
 * depends on somebody happening to submit an answer.
 *
 * It also runs `reconcile()` first, which derives what SHOULD be queued straight
 * from `track_answers` and inserts anything missing. That is what makes a lost
 * enqueue — a process that died between awarding a point and recording the intent
 * to report it — self-healing rather than a silently missing score.
 *
 *   node scripts/drain-outbox.js              one pass, then exit
 *   node scripts/drain-outbox.js --watch      every 15s until interrupted
 *   node scripts/drain-outbox.js --status     report only, deliver nothing
 *
 * Suggested production cadence: every 30 seconds during the event.
 */

const { loadEnv } = require("../lib/loadEnv");
loadEnv();

const { pool } = require("../lib/db");
const { reconcile, drain, summary, bridgeConfigured } = require("../lib/outbox");

const WATCH_INTERVAL_MS = 15_000;

async function onePass() {
  const repaired = await reconcile();
  if (repaired.solved || repaired.hints) {
    console.log(
      `  reconcile: queued ${repaired.solved} missing solve(s), ${repaired.hints} missing hint(s)`
    );
  }

  const result = await drain({ limit: 100 });
  if (result.skipped) {
    console.log(`  drain: skipped (${result.skipped})`);
    return result;
  }
  console.log(
    `  drain: attempted ${result.attempted}, delivered ${result.delivered}, failed ${result.failed}`
  );
  return result;
}

async function report() {
  const counts = await summary();
  console.log("  outbox:", JSON.stringify(counts));

  if (counts.ABANDONED > 0) {
    const { rows } = await pool.query(
      `SELECT event_type, question_code, attempts, last_error
         FROM integration_outbox
        WHERE status = 'ABANDONED'
        ORDER BY created_at DESC
        LIMIT 10`
    );
    console.warn(`  ${counts.ABANDONED} ABANDONED event(s). Most recent:`);
    for (const row of rows) {
      console.warn(`    ${row.event_type} ${row.question_code} after ${row.attempts}: ${row.last_error}`);
    }
    console.warn(
      "  These will NOT retry on their own. Fix the cause, then re-queue with:\n" +
        "    UPDATE integration_outbox SET status='PENDING', attempts=0, next_retry_at=now()\n" +
        "     WHERE status='ABANDONED';"
    );
  }
}

async function main() {
  const watch = process.argv.includes("--watch");
  const statusOnly = process.argv.includes("--status");

  if (!bridgeConfigured()) {
    console.warn(
      "Portal bridge is not configured. Set ODYSSEY_LEVEL1_SECRET and PORTAL_BASE_URL.\n" +
        "Events will continue to queue safely and will deliver once it is."
    );
  }

  if (statusOnly) {
    await report();
    return;
  }

  if (!watch) {
    await onePass();
    await report();
    return;
  }

  console.log(`Watching. Draining every ${WATCH_INTERVAL_MS / 1000}s. Ctrl-C to stop.`);
  // Deliberately sequential, never overlapping: a slow pass must not have a
  // second pass started on top of it, or two drains compete for the same rows.
  for (;;) {
    try {
      await onePass();
    } catch (err) {
      console.error("  pass failed:", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
  }
}

main()
  .catch((err) => {
    console.error("Drain failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!process.argv.includes("--watch")) pool.end().catch(() => {});
  });
