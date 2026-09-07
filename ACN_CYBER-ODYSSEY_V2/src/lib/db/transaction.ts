/**
 * Transaction options for the portal's critical write paths.
 *
 * WHY THESE EXIST (Phase 17 / CONC-17-02)
 * ---------------------------------------
 * Prisma's interactive-transaction defaults are `maxWait: 2000ms` and
 * `timeout: 5000ms`. Those are generous for a server database with many
 * concurrent writers, and far too tight for SQLite, which admits exactly ONE
 * writer at a time.
 *
 * Measured on the 50-squad fixture (scripts/load-test.ts) with the defaults:
 * 50 squads submitting simultaneously produced 41 transaction FAILURES out of
 * 50 — queued writers exhausted `maxWait` before the write lock became
 * available. In event terms that is four out of five squads seeing "submission
 * failed" at the deadline.
 *
 * Raising `maxWait` lets a queued writer WAIT for the lock instead of giving up.
 * It does not make SQLite concurrent — it converts a failure into latency, which
 * is the right trade for a submission deadline. The genuine fix for the write
 * ceiling is PostgreSQL; see docs/production/phase-17-production-readiness.md §2.
 *
 * These values are intentionally larger than a typical web default because the
 * operations they guard are rare per user (one submission, one evaluation save)
 * and correctness matters far more than shaving latency.
 */

/**
 * For participant- and evaluator-facing writes that must not be dropped:
 * submissions, evaluations, team joins.
 *
 * maxWait 15s — a squad at the deadline should queue behind other squads rather
 *               than be told their submission failed.
 * timeout 15s — the transaction body itself is small; this bounds a pathological
 *               stall without cutting off a legitimately queued write.
 */
export const CRITICAL_WRITE_TX = {
  maxWait: 15_000,
  timeout: 15_000,
} as const;

/**
 * For administrative writes (blocking accounts, level transitions, portal state).
 * Lower ceilings: an operator is watching and would rather see a prompt error
 * than a long hang.
 */
export const ADMIN_WRITE_TX = {
  maxWait: 8_000,
  timeout: 10_000,
} as const;
