/**
 * Storage behind the attempt throttler.
 *
 * ---------------------------------------------------------------------------
 * WHY AN INTERFACE AT ALL
 * ---------------------------------------------------------------------------
 * The counters live in this process's memory. That is the right choice for a
 * single-instance event application — a database round trip per failed guess
 * would cost more than the risk warrants — but it is a choice, not a law, and
 * the moment Level 1 runs behind more than one process it becomes the wrong one:
 * N replicas means each client gets N times its intended allowance.
 *
 * So the counters go through a STORE with a small, explicit surface. Swapping
 * memory for shared storage is then one class, not a rewrite of the throttler.
 *
 * ---------------------------------------------------------------------------
 * IMPLEMENTING A SHARED STORE LATER
 * ---------------------------------------------------------------------------
 * Level 1 already uses PostgreSQL, so a shared store needs no new dependency.
 * The contract to satisfy is exactly the five methods below, and the table is:
 *
 *   CREATE TABLE rate_limit_entries (
 *     bucket       TEXT        NOT NULL,
 *     key          TEXT        NOT NULL,
 *     count        INTEGER     NOT NULL DEFAULT 0,
 *     first_at     BIGINT      NOT NULL,
 *     locked_until BIGINT      NOT NULL DEFAULT 0,
 *     PRIMARY KEY (bucket, key)
 *   );
 *   CREATE INDEX ON rate_limit_entries (locked_until);
 *
 * `recordFailure` becomes one statement, which also makes it atomic across
 * replicas — the thing memory cannot give you:
 *
 *   INSERT INTO rate_limit_entries (bucket, key, count, first_at)
 *   VALUES ($1, $2, 1, $3)
 *   ON CONFLICT (bucket, key) DO UPDATE
 *     SET count = CASE WHEN $3 - rate_limit_entries.first_at > $4
 *                      THEN 1 ELSE rate_limit_entries.count + 1 END,
 *         first_at = CASE WHEN $3 - rate_limit_entries.first_at > $4
 *                         THEN $3 ELSE rate_limit_entries.first_at END
 *   RETURNING count, first_at;
 *
 * `sweep` becomes `DELETE FROM rate_limit_entries WHERE locked_until < $now
 * AND first_at < $now - window`, run on the same interval as here.
 *
 * NOT IMPLEMENTED, AND DELIBERATELY SO: nothing today runs more than one
 * process, an unused code path is an untested code path, and this is days from
 * an event. The interface is the deliverable; the implementation is a
 * half-hour when a second process actually exists.
 */

/**
 * Upper bound on tracked keys, per bucket.
 *
 * WHY A CAP EXISTS: entries used to be removed only when that exact key was
 * looked at again. An attacker who varies the key every request — a different
 * team name, or a spoofed forwarded address — creates entries nothing ever
 * revisits, so the map grew for as long as the process lived. That is a memory
 * leak reachable by an unauthenticated client, which is the kind worth caring
 * about.
 *
 * 20,000 keys per bucket is far above anything a 60-crew event produces and far
 * below anything that troubles a Node heap (each entry is three numbers and a
 * short string — on the order of a few MB at the cap).
 */
const MAX_KEYS_PER_BUCKET = Number(process.env.RATE_LIMIT_MAX_KEYS || 20000);

/** How often expired entries are swept, independent of whether they are read. */
const SWEEP_INTERVAL_MS = Number(process.env.RATE_LIMIT_SWEEP_MS || 60 * 1000);

class MemoryRateLimitStore {
  /**
   * @param {{ maxKeysPerBucket?: number, windowMs: number }} options
   */
  constructor(options) {
    /** @type {Map<string, Map<string, {count:number, firstAt:number, lockedUntil:number}>>} */
    this.buckets = new Map();
    this.maxKeysPerBucket = options.maxKeysPerBucket ?? MAX_KEYS_PER_BUCKET;
    this.windowMs = options.windowMs;
    this.evictions = 0;
    this.timer = null;
  }

  bucketFor(name) {
    let bucket = this.buckets.get(name);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(name, bucket);
    }
    return bucket;
  }

  get(bucketName, key) {
    return this.bucketFor(bucketName).get(key);
  }

  set(bucketName, key, entry) {
    const bucket = this.bucketFor(bucketName);

    // Enforce the cap BEFORE inserting, so the bucket can never exceed it.
    //
    // Eviction order is insertion order (JS Map guarantees it), which for this
    // structure is close enough to oldest-first: an entry's position is fixed
    // when its window opened, and `recordFailure` mutates in place rather than
    // re-inserting. Evicting an entry only ever FORGIVES attempts, never
    // fabricates a lockout, so the failure mode is a briefly more permissive
    // limiter rather than a wrongly locked-out crew.
    if (!bucket.has(key) && bucket.size >= this.maxKeysPerBucket) {
      // Sweep first — under normal operation this reclaims everything needed.
      this.sweepBucket(bucketName, Date.now());
      while (bucket.size >= this.maxKeysPerBucket) {
        const oldest = bucket.keys().next();
        if (oldest.done) break;
        bucket.delete(oldest.value);
        this.evictions++;
      }
    }

    bucket.set(key, entry);
  }

  delete(bucketName, key) {
    this.bucketFor(bucketName).delete(key);
  }

  /** Drops entries whose lockout has passed and whose window has closed. */
  sweepBucket(bucketName, now) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) return 0;

    let removed = 0;
    for (const [key, entry] of bucket) {
      const lockExpired = !entry.lockedUntil || entry.lockedUntil <= now;
      const windowClosed = now - entry.firstAt > this.windowMs;
      if (lockExpired && windowClosed) {
        bucket.delete(key);
        removed++;
      }
    }
    return removed;
  }

  sweep(now = Date.now()) {
    let removed = 0;
    for (const name of this.buckets.keys()) removed += this.sweepBucket(name, now);
    return removed;
  }

  /**
   * Starts the periodic sweep.
   *
   * `unref()` so a pending sweep never holds the process open — a CLI script
   * that happens to import this module must still be able to exit.
   */
  startSweeping(intervalMs = SWEEP_INTERVAL_MS) {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopSweeping() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  size() {
    let total = 0;
    for (const bucket of this.buckets.values()) total += bucket.size;
    return total;
  }

  clear() {
    this.buckets.clear();
    this.evictions = 0;
  }
}

module.exports = { MemoryRateLimitStore, MAX_KEYS_PER_BUCKET, SWEEP_INTERVAL_MS };
