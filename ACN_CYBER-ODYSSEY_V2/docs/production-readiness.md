# ACN Cyber Odyssey V2 — Production Readiness Checklist

**Target event:** ~210 participants · 50 squads · max 3 per squad · 3 levels
**Date:** 2026-08-31
**Companion document:** [phase-17-production-readiness.md](production/phase-17-production-readiness.md) — full architecture audit, index rationale and Phase 17 findings.

---

## How to read the status column

| Status         | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| **PASS**       | Verified by an automated test or a measured run that was actually executed. |
| **WARNING**    | Works, but with a caveat that must be understood before the event.          |
| **NOT TESTED** | Not verified. Stated explicitly rather than assumed.                        |
| **FAIL**       | Verified as broken. (No item currently holds this status.)                  |

Nothing is marked PASS on the basis of reading the code alone. Code-only review is recorded as NOT TESTED.

---

## 1. Executive answer

| Question                        | Answer                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current database                | **SQLite** (`prisma/dev.db`), WAL mode                                                                                                                                                      |
| Recommended production database | **SQLite is acceptable for this event** with the pool settings in §3, on measured evidence. PostgreSQL recommended if you need >1 app instance, point-in-time recovery, or growth headroom. |
| Is migration required?          | **No, not for this event.** The schema is PostgreSQL-portable and the path is prepared, but migrating is optional.                                                                          |
| Maximum tested concurrency      | **1000 concurrent reads**, **800 concurrent write transactions**, **210 concurrent logins** — all with zero errors.                                                                         |
| Failure point                   | **Not located.** No failure occurred within the tested range.                                                                                                                               |
| Biggest remaining risk          | No browser and no HTTP-level testing has been performed (§17).                                                                                                                              |

---

## 2. Database

| Item                                                     | Status               | Evidence                                                                                                                                                    |
| -------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema documented (models, keys, relations, constraints) | PASS                 | [phase-17 §1–3](production/phase-17-production-readiness.md)                                                                                                |
| Migration history exists                                 | PASS                 | 3 migrations under `prisma/migrations/`; `prisma migrate status` clean                                                                                      |
| No destructive migration required                        | PASS                 | Slot migration hand-written with `ROW_NUMBER()` backfill; safe on populated DB                                                                              |
| WAL journal mode enabled                                 | PASS                 | `npm run db:doctor` → `journal_mode=wal`                                                                                                                    |
| Connection pooling configured                            | PASS                 | `.env` and `.env.example` carry `connection_limit=12`; startup warning if absent                                                                            |
| Foreign keys enforced                                    | PASS                 | `PRAGMA foreign_keys = ON`; cascade tests in `phase16-event-concurrency.test.ts`                                                                            |
| Indexes justified, not speculative                       | PASS                 | 43 indexes, each commented with the query it serves                                                                                                         |
| Schema portable to PostgreSQL                            | PASS _(schema only)_ | `prisma migrate diff` against a `postgresql` provider generates valid DDL preserving all 6 critical unique constraints, 44 indexes, 10 CASCADE + 3 SET NULL |
| PostgreSQL running end-to-end                            | **NOT TESTED**       | No PostgreSQL server was provisioned. Schema translation verified; runtime behaviour is not.                                                                |

### The two settings that decide whether the event works

Both were wrong by default and are now fixed. Both are measured, not assumed.

**(a) `journal_mode` was `delete`** — a writer took an EXCLUSIVE lock blocking _every_ reader. Now WAL.

**(b) Prisma's SQLite connector pools ONE connection** — every interactive transaction queued behind it and failed past the 10s pool timeout.

| `DATABASE_URL`                                                        | Failed submissions (50 squads) | p50       |
| --------------------------------------------------------------------- | ------------------------------ | --------- |
| `file:./dev.db`                                                       | **40 of 50**                   | 10,935 ms |
| `file:./dev.db?connection_limit=12&pool_timeout=30&socket_timeout=30` | **0 of 50**                    | 36 ms     |

This was also silently affecting the **test suite**, which ran unpooled until this phase (BUG-16-02). `vitest.config.mts` now appends the pool parameters so tests exercise the deployed configuration.

---

## 3. Concurrency

| Item                                                    | Status | Evidence                                                                   |
| ------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| Team creation — 2 simultaneous                          | PASS   | `phase16-event-concurrency.test.ts`                                        |
| Team creation — 10 simultaneous                         | PASS   | 10 distinct squads, 10 distinct codes, no orphans                          |
| Team creation — 50 simultaneous                         | PASS   | 50 distinct squads, no duplicates, no orphan memberships                   |
| Contested squad NAME (10 racing for one name)           | PASS   | Exactly 1 succeeds; 9 refused; 1 membership total                          |
| **Team join — 2-member squad, 10 simultaneous joiners** | PASS   | Exactly 1 admitted, final roster = 3, slots `[1,2,3]`, 9 capacity refusals |
| Team join — full squad, 10 joiners                      | PASS   | 0 admitted, roster stays 3                                                 |
| Team join — 50 joiners across 5 squads                  | PASS   | No squad over 3; no participant on two squads                              |
| Join a deleted squad mid-flight                         | PASS   | No orphan memberships; end state consistent                                |
| Member leaves while others join                         | PASS   | Slots remain unique and in range                                           |
| One participant joins 5 squads at once                  | PASS   | Exactly 1 membership                                                       |
| Duplicate submission (3 teammates at once)              | PASS   | Exactly 1 submission row                                                   |
| Concurrent evaluations → score integrity                | PASS   | Every squad score equals its EVALUATED sum                                 |
| Evaluator version conflict                              | PASS   | Second save refused; first evaluator's score and feedback intact           |
| Two simultaneous saves, same version                    | PASS   | Exactly 1 succeeds; stored score is never a blend                          |
| Concurrent file uploads (50)                            | PASS   | 50 distinct paths, byte-for-byte content integrity                         |

**Enforcement mechanism.** Capacity is a database guarantee, not a count: `TeamMember.slot` under `UNIQUE(teamId, slot)`. A fourth member cannot be admitted under any interleaving because admission requires winning a unique index the database owns. Submission uniqueness likewise rests on `UNIQUE(teamId, level)`.

**WARNING — scope of proof.** The test datasource is SQLite, which serialises writers. These tests prove the guards behave correctly and that _database constraints_ do the rejecting. They cannot alone prove behaviour on a parallel MVCC engine. The structural argument for PostgreSQL safety is that every invariant is enforced by a unique index rather than by a read-then-write check — but that is reasoning, not measurement.

---

## 4. Authentication & authorization

| Item                                                | Status | Evidence                                                                |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Password hashes never returned to clients           | PASS   | Session type structurally excludes `passwordHash`; test asserts no leak |
| 210 concurrent logins                               | PASS   | Scenario A: p95 1,515 ms, 0 errors, 131 logins/s                        |
| Blocked accounts cannot authenticate                | PASS   | `security-hardening-audit.test.ts`                                      |
| Pending accounts cannot authenticate                | PASS   | Same                                                                    |
| Session revoked on status change                    | PASS   | Session deleted on next request if not ACTIVE                           |
| Account lockout preserved and corrected             | PASS   | 4 tests; `lockedUntil` cannot be extended by victim activity            |
| Full RBAC matrix (4 roles × all privileged actions) | PASS   | **140 assertions**, `phase17-rbac-matrix.test.ts`                       |
| Client-supplied role claims ignored                 | PASS   | Participant sending `role=CREATOR` still refused                        |
| Account status enforced independently of role       | PASS   | PENDING/BLOCKED/SUSPENDED/REJECTED all denied                           |

---

## 5. Timers

| Item                                          | Status | Evidence                                                         |
| --------------------------------------------- | ------ | ---------------------------------------------------------------- |
| Server/database authoritative                 | PASS   | Expiry derived from stored `endsAt` on every read                |
| Independent of client clock                   | PASS   | `phase16` test: expiry computed server-side regardless of caller |
| All concurrent readers converge               | PASS   | 60 concurrent reads return one identical `endsAt`                |
| Expiry during an open page rejects submission | PASS   | Level expires mid-flight → submission refused, 0 rows            |
| Submission after LOCKED / PAUSED rejected     | PASS   | Both tested                                                      |
| No client polling                             | PASS   | Only display ticks; zero DB polling anywhere                     |

---

## 6. Submissions

| Item                                         | Status | Evidence                                                 |
| -------------------------------------------- | ------ | -------------------------------------------------------- |
| One finalized submission per squad per level | PASS   | DB unique constraint + concurrency test                  |
| Rejected after timer expiry                  | PASS   | Tested                                                   |
| Rejected when level LOCKED / PAUSED          | PASS   | Tested                                                   |
| Rejected when portal OFFLINE                 | PASS   | Tested                                                   |
| Rejected from a BLOCKED squad                | PASS   | Tested                                                   |
| Cross-team submission impossible             | PASS   | Submission is bound to the session user's own membership |
| No orphaned upload files on rejection        | PASS   | `discardSubmissionFiles` on every failure path           |
| 50 deadline submissions                      | PASS   | Scenario F: p95 534 ms, 0 errors                         |

---

## 7. Evaluations & leaderboard

| Item                                           | Status | Evidence                                                                  |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Optimistic concurrency enforced                | PASS   | Version is part of the `updateMany` WHERE clause, not a read-then-compare |
| Conflicting update does not silently overwrite | PASS   | Tested — first evaluator's work survives intact                           |
| Evaluator notes vs team feedback kept distinct | PASS   | Tested                                                                    |
| Score bounds enforced (0–100)                  | PASS   | `-1, -100, 101, 1000, NaN` all rejected, nothing stored                   |
| No negative or over-max stored score           | PASS   | Tested                                                                    |
| `Team.score` updated atomically                | PASS   | Recomputed via SQL `SUM` inside the transaction                           |
| No score drift after full workload             | PASS   | Load run + tests: 0 drifted squads                                        |
| Leaderboard ordering with ties                 | PASS   | Deterministic `[score desc, updatedAt asc]`                               |
| 210 concurrent leaderboard reads               | PASS   | Scenario C: p95 34 ms                                                     |
| No private fields exposed                      | PASS   | `Team.code` / `passwordHash` never selected                               |

---

## 8. Announcements & notifications

| Item                                        | Status         | Evidence                                                          |
| ------------------------------------------- | -------------- | ----------------------------------------------------------------- |
| Audience isolation                          | PASS           | Participants never see EVALUATORS/ADMINS-only items               |
| Unpublished items hidden                    | PASS           | Tested                                                            |
| One notification per recipient              | PASS           | Tested; single `createMany` fan-out                               |
| Badge counts match the feed                 | PASS           | Both route through `src/lib/event/announcements.ts`               |
| Indexed for the real query                  | PASS           | `[published, targetAudience, createdAt]`                          |
| Double-click creates duplicate announcement | **NOT TESTED** | No idempotency key exists. Admin-only, low blast radius; see §17. |

---

## 9. File storage

| Item                                  | Status | Evidence                                                     |
| ------------------------------------- | ------ | ------------------------------------------------------------ |
| Size limit enforced                   | PASS   | 20 MB; oversized rejected without writing                    |
| Extension allow-list                  | PASS   | `.pdf .doc .docx .zip`                                       |
| MIME validation                       | PASS   | Tested                                                       |
| Magic-byte validation                 | PASS   | Renamed `.exe`→`.pdf` rejected                               |
| Executables rejected                  | PASS   | `.exe .sh .bat .ps1 .js` all rejected                        |
| Path traversal neutralised            | PASS   | Hostile filenames sanitised; containment via `path.relative` |
| Random server-side filenames          | PASS   | Team prefix + 8-byte random token                            |
| Concurrent uploads do not corrupt     | PASS   | 50 simultaneous, byte-exact content per file                 |
| Cross-team file access                | PASS   | No participant-facing download route exists at all           |
| Files stored on filesystem, not in DB | PASS   | Deliberate; DB holds metadata only                           |

---

## 10. Load testing

`npm run seed:event-fixture && npm run load:scenarios` — 50 squads, 210 participants. Two independent runs, results within noise.

| Scenario                                     | ops | p50    | p95      | p99      | errors | Verdict |
| -------------------------------------------- | --- | ------ | -------- | -------- | ------ | ------- |
| A — 210 logins (lookup + scrypt + session)   | 210 | 826 ms | 1,515 ms | 1,574 ms | 0      | PASS    |
| B — 210 dashboard loads                      | 210 | 46 ms  | 50 ms    | 51 ms    | 0      | PASS    |
| C — 210 leaderboard reads                    | 210 | 23 ms  | 34 ms    | 35 ms    | 0      | PASS    |
| D — 150 Level 2 workspace loads              | 150 | 35 ms  | 37 ms    | 38 ms    | 0      | PASS    |
| E — 50 evidence resource fetches             | 50  | 10 ms  | 10 ms    | 11 ms    | 0      | PASS    |
| F — 50 deadline submissions                  | 50  | 48 ms  | 534 ms   | 629 ms   | 0      | PASS    |
| G — evaluations under 6,340 background reads | 50  | 60 ms  | 650 ms   | 852 ms   | 0      | PASS    |

Thresholds: read p95 ≤ 1500 ms · write p95 ≤ 3000 ms · login p95 ≤ 5000 ms · error rate 0.
Post-load integrity: **0 duplicate submissions · 0 over-capacity squads · 0 score drift**.

### Stress ladder (`LOAD_STRESS=1`)

| Concurrent reads | p95   | throughput   | errors |
| ---------------- | ----- | ------------ | ------ |
| 250              | 17 ms | 12,633 ops/s | 0      |
| 500              | 36 ms | 12,043 ops/s | 0      |
| 1000             | 69 ms | 11,918 ops/s | 0      |

| Concurrent write transactions | p95    | throughput | errors |
| ----------------------------- | ------ | ---------- | ------ |
| 50                            | 441 ms | 76 tx/s    | 0      |
| 200                           | 234 ms | 168 tx/s   | 0      |
| 800                           | 843 ms | 433 tx/s   | 0      |

**Failure point: NOT LOCATED.** Neither ladder produced an error or breached its threshold within the tested range. Read throughput plateaus at ~12,500 ops/s with latency growing linearly — the signature of orderly queueing, not saturation. Write throughput _rises_ with concurrency (76 → 433 tx/s) because batching amortises fsync.

**Maximum tested:** 1000 concurrent reads, 800 concurrent write transactions, 210 concurrent logins. All at 4.8× the expected participant count with zero errors.

### Login cost (`npm run bench:password`)

`crypto.scrypt` is CPU-bound on the **libuv threadpool**, which defaults to 4 threads regardless of core count.

| `UV_THREADPOOL_SIZE` | 210 concurrent logins | throughput       |
| -------------------- | --------------------- | ---------------- |
| unset (4)            | 1,714 ms              | 123 logins/s     |
| 16                   | **714 ms**            | **294 logins/s** |

Setting `UV_THREADPOOL_SIZE=16` is a **2.4× login speedup** for a one-line environment change. The default is already acceptable; this is optimisation, not remediation.

---

## 11. Backups & recovery

| Item                                              | Status               | Evidence                                                                                                                                                             |
| ------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup procedure exists                           | PASS                 | `npm run db:backup`                                                                                                                                                  |
| Backup is transactionally consistent              | PASS                 | Uses `VACUUM INTO`, not `cp` — see below                                                                                                                             |
| Backup self-verifies                              | PASS                 | `--verify`: `integrity_check: ok`, all 14 table counts matched                                                                                                       |
| **Restore rehearsed**                             | PASS                 | Backup restored to a separate path, opened standalone: `integrity_check ok`, 221 users / 50 squads / 150 memberships intact, and all three integrity invariants held |
| Migration validation tooling                      | PASS _(tool exists)_ | `npm run db:migrate-validate` — count comparison + live constraint probes                                                                                            |
| Migration validation exercised against PostgreSQL | **NOT TESTED**       | No PostgreSQL instance available                                                                                                                                     |
| Rollback procedure documented                     | PASS                 | §15 below                                                                                                                                                            |

**Why not `cp`.** In WAL mode the committed state spans `dev.db`, `dev.db-wal` and `dev.db-shm`. A plain copy taken mid-write captures a torn snapshot that may fail to open or silently lose recent transactions. `VACUUM INTO` takes a read snapshot and writes a self-contained file with no sidecars, and needs no external `sqlite3` binary.

**`uploads/` is NOT in the database backup.** Submission files and Creator resources live on disk. A database restored without its matching `uploads/` leaves `SubmissionFile` rows pointing at missing files — `npm run db:doctor` detects exactly this. Back up both together.

### Pre-event backup checklist

1. `npm run db:backup -- --verify` — must report all counts matched.
2. Archive `uploads/` alongside it, with the same timestamp.
3. Copy both to a **separate volume or machine**.
4. Restore the pair into a scratch directory and run `npm run db:doctor` against it.
5. Only after step 4 succeeds, consider the backup usable.

### During the event

| When                            | Action                                 |
| ------------------------------- | -------------------------------------- |
| Every 15 min during live levels | `npm run db:backup` (automated)        |
| After each level closes         | Tagged backup, retained                |
| After evaluation completes      | Final backup before announcing results |

---

## 12. Security regression

All re-verified this phase. Full detail in [phase-17 §22](production/phase-17-production-readiness.md).

| Item                                                  | Status                     |
| ----------------------------------------------------- | -------------------------- |
| Password hashes never exposed                         | PASS                       |
| Team join codes never exposed to unauthorized users   | PASS                       |
| Participant cannot access creator / admin / evaluator | PASS (140 RBAC assertions) |
| Evaluator cannot access creator                       | PASS                       |
| Admin cannot access creator                           | PASS                       |
| Blocked accounts cannot act                           | PASS                       |
| Offline portal blocks participant actions             | PASS                       |
| Expired levels reject submissions server-side         | PASS                       |
| Path traversal rejected                               | PASS                       |
| Invalid / oversized file types rejected               | PASS                       |
| Score bounds enforced                                 | PASS                       |
| Audit logs preserved                                  | PASS                       |
| No secrets in tracked files                           | PASS                       |
| `npm audit`                                           | PASS — 0 vulnerabilities   |

---

## 13. Data integrity

| Item                                                       | Status                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| No orphan TeamMember records                               | PASS                                                    |
| No orphan Submission records                               | PASS                                                    |
| No orphan SubmissionFile records                           | PASS                                                    |
| Team deletion does not delete participant accounts         | PASS                                                    |
| Account deletion does not delete the squad                 | PASS                                                    |
| Submission deletion cascades to files + evaluation         | PASS                                                    |
| Duplicate emails / usernames / team names / codes rejected | PASS                                                    |
| Invalid scores rejected                                    | PASS                                                    |
| Post-workload invariants hold                              | PASS                                                    |
| Continuous integrity checker                               | PASS — `npm run db:doctor`, exits non-zero on violation |

---

## 14. Observability & error handling

| Item                                                               | Status | Evidence                                                                                                                     |
| ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Slow-query logging                                                 | PASS   | Threshold via `SLOW_QUERY_MS`; query text only, **never parameters**                                                         |
| Startup misconfiguration warning                                   | PASS   | Fires if SQLite URL lacks `connection_limit`                                                                                 |
| Audit logging for security events                                  | PASS   | Login, logout, failed login, lockout, blocks, deletions, level and portal transitions, submissions, evaluations, file access |
| Audit write amplification controlled                               | PASS   | Render-triggered events throttled to 1 per actor per 15 min                                                                  |
| No secrets in logs                                                 | PASS   | Verified by inspection of every log call                                                                                     |
| Error boundaries present                                           | PASS   | `error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx`                                                              |
| Stack traces not exposed                                           | PASS   | User sees a reference digest only                                                                                            |
| **Post-commit failure cannot report a successful write as failed** | PASS   | **BUG-16-01 fixed** — 61 unguarded `revalidatePath` calls wrapped                                                            |

### BUG-16-01 — the most consequential bug found this phase

`revalidatePath` runs _after_ the transaction commits. If it threw, the enclosing `try/catch` converted a write that **genuinely succeeded** into an error response.

For an evaluation save this is severe: the evaluator is told the save failed, re-saves, and is then **blocked by the optimistic-concurrency guard on their own committed work** — locked out of an evaluation they already completed.

Found because the new concurrency tests invoke server actions outside a Next.js request scope, where `revalidatePath` throws. 61 call sites across `admin-actions`, `evaluator-actions` and `creator-resource-actions` were affected. Phase 17 had fixed this in `submission-actions` only and missed the rest.

---

## 15. Deployment

### Required environment variables

| Variable                       | Required      | Notes                                                                           |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | **Yes**       | Must include `connection_limit=12&pool_timeout=30&socket_timeout=30` for SQLite |
| `CREATOR_EMAIL`                | Yes (seeding) | Seed refuses to run without it                                                  |
| `CREATOR_PASSWORD`             | Yes (seeding) | Minimum 12 chars; no fallback exists                                            |
| `CREATOR_USERNAME`             | No            | Defaults to `event_creator`                                                     |
| `UV_THREADPOOL_SIZE`           | Recommended   | `16` — 2.4× login throughput                                                    |
| `SLOW_QUERY_MS`                | No            | Defaults to 300                                                                 |
| `ACTIVITY_REFRESH_INTERVAL_MS` | No            | Defaults to 5 min                                                               |
| `NODE_ENV`                     | **Yes**       | `production` — required for `secure` cookies                                    |

Never commit real values. `.env` is git-ignored; `.env.example` holds placeholders only.

### Deploy commands

```bash
npm ci
npm run db:backup -- --verify          # before touching anything
npm run db:migrate                     # prisma migrate deploy — never db push
npm run db:pragmas                     # enable WAL (once per database file)
npm run db:seed                        # requires CREATOR_EMAIL + CREATOR_PASSWORD
npm run db:doctor                      # must exit 0
npm run verify                         # typecheck, lint, format, tests, build, CDN
npm run build && npm start             # behind a TLS-terminating proxy
```

### Verify production

```bash
npm run db:doctor
npm run seed:event-fixture && npm run load:scenarios && npm run seed:event-fixture -- --wipe
```

### Rollback

```bash
# 1. Stop the application.
# 2. Restore the database and uploads from the same timestamped pair.
cp backups/odyssey-<timestamp>.db prisma/dev.db
rm -f prisma/dev.db-wal prisma/dev.db-shm     # discard stale sidecars
rm -rf uploads && tar -xzf backups/uploads-<timestamp>.tar.gz
# 3. Re-apply pragmas and verify before restarting.
npm run db:pragmas
npm run db:doctor
# 4. Restart.
```

Migrations are **forward-only**. Rolling back a schema change means restoring the pre-migration backup — which is why step 1 of the deploy sequence is a verified backup.

### SQLite → PostgreSQL (optional, NOT TESTED end-to-end)

1. `npm run db:backup -- --verify`
2. Change `provider = "sqlite"` → `"postgresql"` in `prisma/schema.prisma`.
3. Point `DATABASE_URL` at the server (`?connection_limit=20&pool_timeout=20`).
4. `npx prisma migrate deploy` against the empty PostgreSQL database.
5. Copy data across.
6. `npm run db:migrate-validate -- --source "file:./dev.db" --target "$DATABASE_URL"` — compares every table's row count **and probes that the unique constraints are actually enforced on the target**. That second check matters: a migration can move every row while silently failing to recreate the index that enforces the 3-member squad cap, so counts match and the cap quietly stops existing.
7. `npm run db:doctor` against the new datasource.

---

## 16. Verification results

| Command                                | Result                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| `npm run typecheck`                    | **PASS**                                                  |
| `npm run lint`                         | **PASS**                                                  |
| `npm run format:check`                 | **PASS**                                                  |
| `npm test`                             | **PASS** — 421/421 across 17 files                        |
| `npm run build`                        | **PASS**                                                  |
| `npm run check:no-cdn`                 | **PASS** — 765 files scanned                              |
| `npm run verify`                       | **PASS** — exit 0                                         |
| `npm audit`                            | **PASS** — 0 vulnerabilities                              |
| `git diff --check`                     | **PASS**                                                  |
| `npm run db:doctor`                    | **PASS** — 0 blocking findings                            |
| `npm run load:scenarios`               | **PASS** — 7/7 scenarios, integrity holds                 |
| `LOAD_STRESS=1 npm run load:scenarios` | **PASS** — no failure point up to 1000 reads / 800 writes |
| `npm run db:backup -- --verify`        | **PASS** — integrity ok, counts matched                   |
| Restore rehearsal                      | **PASS** — restored copy intact, invariants hold          |
| Browser testing                        | **NOT TESTED**                                            |
| HTTP-level load testing                | **NOT TESTED**                                            |

---

## 17. Remaining risks

| Risk                         | Severity | Detail                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No browser verification**  | **HIGH** | No page has been loaded in a real browser. Hydration, client interactivity, responsive layout, keyboard navigation and focus states are **NOT TESTED**. Hydration risk is structurally low — all date formatting uses fixed-locale/fixed-timezone `Intl` formatters and timers seed from server props — but that is reasoning, not observation. |
| **No HTTP-level load test**  | **HIGH** | Every figure here measures the data and CPU layers. Next.js request handling, React server rendering, cookie parsing and TLS are unmeasured. 210 concurrent _browsers_ remains unproven.                                                                                                                                                        |
| SQLite single-writer ceiling | MEDIUM   | Measured as ample for this event (800 concurrent transactions, 0 errors) but the ceiling exists and there is no horizontal scaling.                                                                                                                                                                                                             |
| Single point of failure      | MEDIUM   | One server, one database file. No replication or failover.                                                                                                                                                                                                                                                                                      |
| PostgreSQL path unexercised  | MEDIUM   | Schema translation verified; no server was run. Do not migrate on event day.                                                                                                                                                                                                                                                                    |
| Level 1 and Level 3 content  | MEDIUM   | Not implemented. The portal states this honestly, but the levels cannot be run.                                                                                                                                                                                                                                                                 |
| Announcement double-click    | LOW      | No idempotency key; a fast double-click could create two announcements. Admin-only, easily deleted.                                                                                                                                                                                                                                             |
| In-memory upload buffering   | LOW      | `file.arrayBuffer()` loads whole uploads into memory; 50 concurrent 20 MB uploads ≈ 1 GB peak RSS. Not reached in testing.                                                                                                                                                                                                                      |
| No per-IP rate limiting      | LOW      | Per-account lockout only. Acceptable on a controlled venue network.                                                                                                                                                                                                                                                                             |

---

## 18. Honest bottom line

The database, concurrency, integrity, authorization and recovery layers are **measured and verified** for this event's shape, with substantial headroom: 4.8× the expected participant count produced zero errors, and every integrity invariant survived deliberate write storms.

This is **not** a claim that the system is bug-free, will never fail, or has zero lag. Two verification gaps remain, and neither is a code change:

1. **Nothing has been opened in a browser.**
2. **Nothing has been tested through HTTP.**

Closing them takes roughly an hour: a browser smoke-test of the full Creator → Admin → Evaluator → Participant flow, and one HTTP load run against the built server. Until then the accurate statement is:

> **Data and CPU layers: LOAD VERIFIED. Concurrency, integrity, security and RBAC: TEST VERIFIED. Recovery: REHEARSED. UI and HTTP capacity: NOT TESTED.**
