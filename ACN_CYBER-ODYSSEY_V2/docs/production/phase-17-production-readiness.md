# Phase 17 — Production Readiness Report

**Project:** ACN Cyber Odyssey V2 (TRACE Event Portal)
**Target:** 50 squads · up to 3 participants each · ~210 participant accounts · multiple evaluators, admins, one Creator
**Date:** 2026-08-31

---

## Verification vocabulary

This report distinguishes levels of evidence, and never blurs them.

| Level                   | Meaning                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **CODE VERIFIED**       | Read and reasoned about in source. No execution.                                             |
| **TEST VERIFIED**       | Covered by an automated test that was run and passed.                                        |
| **LOAD VERIFIED**       | Measured by `scripts/load-test.ts` against the 50-squad fixture. Database layer only.        |
| **BROWSER VERIFIED**    | Exercised through a real browser. **Nothing in this report is browser verified** — see §24.  |
| **PRODUCTION VERIFIED** | Observed in a real event under real load. **Nothing in this report is production verified.** |
| **NOT VERIFIED**        | Stated explicitly wherever it applies.                                                       |

---

## 1. Architecture overview

**Stack.** Next.js 15.5 App Router (`output: 'standalone'`), React 19, Prisma 6 over SQLite, Tailwind 4, Vitest. No external CDN (`npm run check:no-cdn` enforces this).

**Rendering.** Every authenticated route is server-rendered on demand. `cookies()` is read on each request, which opts every page out of static generation. Only `/login`, `/signup`, `/events` and `/_not-found` are static.

**Authentication.** Opaque 32-byte random session token in an `httpOnly`, `sameSite=lax`, `secure`-in-production cookie, backed by a `Session` row. No JWT, no client-readable identity.

**Authorization.** Enforced in two layers, both server-side:

1. Route guards in `src/lib/auth/guards.ts`, applied in role layouts (`/admin`, `/creator`, `/evaluator`) and per-page for participant routes.
2. An independent guard inside every server action (`assertCreator`, `requireAdminUser`, `requireEvaluatorRole`, `requireCreatorUser`).

Layer 2 is what actually protects data: a participant who reads the client bundle can invoke any server action directly. §12 documents the test that proves layer 2 holds.

**Data flow.** Server components read via Prisma and pass plain serialisable props to client components. Client components mutate via server actions. There is no REST API for application data; the only route handlers are three authenticated file streams.

**Real-time.** None. There are no WebSockets, no SSE, and — deliberately — **no polling**. Timers count down client-side from a server-issued `endsAt`; see §7.

---

## 2. Database architecture and the SQLite decision

### 2.1 Current datasource

SQLite, single file at `prisma/dev.db`.

### 2.2 The two settings that decide whether the event works

Two defaults were found to be actively dangerous. Both are now fixed, and both are measured.

**(a) `journal_mode` was `delete`.** In rollback-journal mode a writer takes an EXCLUSIVE lock that blocks _every concurrent reader_. With ~210 participants reading dashboards while audit logs and activity timestamps are written, the whole portal serialises behind each write.

Fixed by enabling **WAL** (`npm run db:pragmas`, also asserted at client init in `src/lib/prisma.ts`). WAL is persisted in the database file header, so it applies to every connection and survives restarts. Verified: `npm run db:doctor` reports `journal_mode=wal`.

**(b) Prisma's SQLite connector pools a single connection.** Every interactive transaction therefore queued behind one connection and, past the 10-second default pool timeout, simply failed.

**Measured on the 50-squad fixture, all squads submitting simultaneously:**

| DATABASE_URL                                                          | Submissions failed | p50 latency |
| --------------------------------------------------------------------- | ------------------ | ----------- |
| `file:./dev.db`                                                       | **40 of 50**       | 10,935 ms   |
| `file:./dev.db?connection_limit=12&pool_timeout=30&socket_timeout=30` | **0 of 50**        | 36 ms       |

This is the single highest-impact finding in the audit. Four out of five squads would have seen "submission failed" at the deadline.

**Required production `DATABASE_URL`:**

```
DATABASE_URL="file:./dev.db?connection_limit=12&pool_timeout=30&socket_timeout=30"
```

`.env.example` documents this, and `src/lib/prisma.ts` prints a loud startup warning if a SQLite URL omits `connection_limit`, so the misconfiguration cannot recur silently.

### 2.3 Is SQLite acceptable for this event?

**With the settings above: yes, on the measured evidence, with caveats.** Every scenario in §21 passed at 210-participant concurrency with zero errors and all integrity invariants intact.

The caveats are real and are not resolved by tuning:

- SQLite admits **one writer at a time**. Raising the pool converts contention from _failure_ into _latency_ (write p95 rose to ~550 ms under the burst). That is the right trade for a submission deadline, but the ceiling exists.
- The database is a **local file**. No network access, so the app server cannot be scaled horizontally.
- **No point-in-time recovery and no replication.** Recovery means restoring a file copy; see §29.

**Recommendation:** run the event on SQLite with the tuned URL if the deployment is a single server and the backup plan in §29 is followed. Migrate to PostgreSQL if you need more than one app instance, PITR, or headroom beyond the measured load. The migration path is: change `provider` to `postgresql` in `prisma/schema.prisma`, point `DATABASE_URL` at the server, run `npx prisma migrate deploy`. The schema uses no SQLite-specific types, so it ports directly. **The PostgreSQL path is NOT VERIFIED** — it has not been run.

### 2.4 Migrations

**Before Phase 17 the project had no migration history at all** — the schema was maintained with `prisma db push`, which offers no rollback, no deployment record, and no reproducibility.

Now established under `prisma/migrations/`:

| Migration                          | Purpose                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `00000000000000_phase17_baseline`  | Baseline of the schema as it stood, marked applied against the existing database (non-destructive). |
| `20260831000001_team_member_slot`  | Adds `TeamMember.slot` + `UNIQUE(teamId, slot)`, with a `ROW_NUMBER()` backfill.                    |
| `20260831000002_user_locked_until` | Adds `User.lockedUntil`.                                                                            |

The slot migration is **hand-written**. The migration Prisma generates backfills every existing row with the column default (`slot = 1`), which violates the new unique index for any squad that already has two or more members. The hand-written version renumbers each squad's roster 1..n in join order and is safe against a populated database.

Deploy with `npm run db:migrate` (`prisma migrate deploy`). Do **not** use `prisma migrate dev` or `db push` against production.

---

## 3. Database indexes

Every index below was added because a specific query in the codebase needs it. Indexes were not added speculatively — each one carries a comment in `prisma/schema.prisma` naming the query it serves.

### Added in Phase 17

| Model          | Index                                    | Query it serves                                                                                  |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `User`         | `[role, status]`                         | Pending-approval queue; evaluator/admin rosters; active-account counts on both staff overviews.  |
| `User`         | `[status]`                               | Standalone active/blocked/pending counts.                                                        |
| `User`         | `[createdAt]`                            | Account lists, ordered `createdAt desc`, paginated.                                              |
| `Team`         | `[status, score]`                        | Leaderboard: `where status='ACTIVE' order by score desc`.                                        |
| `Team`         | `[createdAt]`                            | Creator/Admin squad registry ordering.                                                           |
| `Session`      | `[expiresAt]`                            | Active-session counts, Creator session monitor, expired-session reaping. Previously a full scan. |
| `Submission`   | **`UNIQUE [teamId, level]`**             | Replaces the old non-unique index; see §5.                                                       |
| `Submission`   | `[level, status]`                        | Evaluator and Admin submission queues.                                                           |
| `Submission`   | `[submittedAt]`                          | Queue ordering.                                                                                  |
| `Evaluation`   | `[teamId, status]`                       | **On the write path**: score aggregation `sum(score) where teamId=? and status='EVALUATED'`.     |
| `Evaluation`   | `[status, level]`                        | Admin evaluation monitor filters.                                                                |
| `Evaluation`   | `[updatedAt]`                            | Admin evaluation monitor ordering.                                                               |
| `Announcement` | `[published, targetAudience, createdAt]` | Participant feed and every badge count.                                                          |
| `Notification` | `[userId, createdAt]`                    | Per-user notification feed, newest first.                                                        |
| `TeamMember`   | **`UNIQUE [teamId, slot]`**              | Capacity enforcement; see §6.                                                                    |

### Deliberately not added

- `LevelState` — three rows. Any index is noise.
- `TeamMember[teamId, joinedAt]` — at most three rows per squad; the existing `[teamId]` index is sufficient.
- `PortalSetting` — single row, primary key `'default'`.

Total explicit indexes after Phase 17: **43** (verified against `sqlite_master`).

---

## 4. Query optimisation

| ID         | Change                                                                                                                                                 | Impact                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-17-01 | Sequential `await` waterfalls replaced with `Promise.all` on `/dashboard`, `/event`, `/event/level-1..3`, `/leaderboard`, and four Admin list actions. | The dashboard alone went from 4 sequential round trips to 1.                                                                                                                                                                                                                                                                                                                                                                            |
| PERF-17-02 | `lastActivityAt` refresh interval raised 60 s → 5 min.                                                                                                 | This is a **write on the read path of every authenticated request**. At 60 s with 210 participants it sustained ~3.5 writes/second of pure telemetry contending for the single write lock.                                                                                                                                                                                                                                              |
| PERF-17-03 | `getSessionUser()` no longer joins the squad roster.                                                                                                   | It previously executed `session → user → membership → team → members → user` — a five-table join — on **every page render and every server action**. Only `/team` renders the roster; it now uses `getSessionUserWithTeamRoster()`. As a side effect the session object no longer carries `passwordHash` at all, which the type system now enforces.                                                                                    |
| PERF-17-04 | Render-triggered audit writes throttled to one row per actor per action per 15 minutes (`src/lib/audit/audit-log.ts`).                                 | `LEVEL2_OPENED` fired on **every render** of the Level 2 workspace — every refresh, every client navigation, and every re-render caused by an unrelated `revalidatePath` from the Admin console. During a live 2-hour level with 210 participants this was the largest single write source in the application. `PARTICIPANT_VIEWED`, `TEAM_VIEWED` and `SUBMISSION_VIEWED` fired on every Admin list query including filter keystrokes. |
| PERF-17-05 | `ensureLevelStatesExist()` latched per process, and its three `findUnique` calls collapsed into one `findMany`.                                        | It ran **three queries on every call**, and is called by `getLevelState`, `getLevelStates` and `getActiveLevel` — which sit on the dashboard, all three level pages, the event page and both staff consoles.                                                                                                                                                                                                                            |
| PERF-17-06 | Row-fetching-to-count replaced with `_count`; whole-record `include`s replaced with explicit `select`s.                                                | `files: {select:{id:true}}`, `submissions: {select:{id:true}}` and `notifications: {select:{id:true}}` transferred one row per item purely to read `.length` — the notification case was ~210 rows per announcement.                                                                                                                                                                                                                    |

### Privacy side-effect of PERF-17-06

`getAdminSubmissionsAction` used `include: { team: true, user: true }`, and `getAdminEvaluationsAction` used `include: { team: true, evaluator: true }`. `team: true` loads `Team.code` (the private squad join code) **and** `Team.passwordHash`; `user: true` loads `User.passwordHash`.

**These values never reached the client** — every action maps to an explicit DTO before returning. This was over-fetching, not a data leak. It has nonetheless been eliminated: credentials no longer enter application memory on a monitoring query.

---

## 5. Transaction strategy

Interactive transactions wrap every multi-statement mutation: team create/join, submission create/replace, evaluation save, staff approval, account block/delete, team delete, portal toggle.

**CONC-17-02 — explicit transaction options.** Prisma's defaults (`maxWait: 2000 ms`, `timeout: 5000 ms`) are far too tight for a single-writer datasource. `src/lib/db/transaction.ts` defines:

- `CRITICAL_WRITE_TX` (`maxWait: 15 s`, `timeout: 15 s`) — submissions, evaluations, team joins. A squad at the deadline should **queue** behind other squads, not be told their submission failed.
- `ADMIN_WRITE_TX` (`maxWait: 8 s`, `timeout: 10 s`) — an operator is watching and would rather see a prompt error than a long hang.

**Audit-log writes are deliberately outside transactions** where they are advisory (`.catch(() => {})`), and **inside** them where the audit record must not survive a rolled-back action (team create, team join, submission, evaluation).

---

## 6. Concurrency strategy

The governing principle: **critical integrity rules are enforced by the database, not by application logic.** Application checks exist to produce good error messages; they are not the guarantee.

### 6.1 Squad capacity — max 3 (DB-17-03)

**Before:** capacity was enforced by counting rows inside a transaction and re-counting afterwards. That is correct under SQLite, which serialises writers, but races under any MVCC engine: two transactions both read `count = 2`, both insert, and the squad ends with four members. The invariant depended entirely on the datasource, and would have broken silently on migration to PostgreSQL.

**Now:** each membership occupies a numbered slot, with `@@unique([teamId, slot])`. A join claims the lowest free slot; a loser of the race gets `P2002` and retries against a now-smaller set of free slots; once every slot is taken there is nothing to claim and the join is refused. **There is no interleaving under any isolation level in which a fourth member is admitted**, because admission requires winning a unique index the database owns.

Bounded retry: `JOIN_SLOT_MAX_ATTEMPTS = MAX_TEAM_SIZE`, because each retry follows a lost race and therefore eliminates at least one slot.

### 6.2 Single membership

`TeamMember.userId` is `@unique`. A participant cannot hold two memberships, so concurrent joins to two different squads resolve to exactly one.

### 6.3 Submission uniqueness (DB-17-01)

`@@unique([teamId, level])`. Two teammates pressing Submit simultaneously produce exactly one submission; the loser receives `P2002`, which is translated into a message explaining that a teammate's submission was recorded and theirs was not needed.

### 6.4 Evaluation optimistic locking (CONC-17-01)

**Before:** the version was read, compared in JavaScript, then written — with a window between comparison and write in which another evaluator could commit.

**Now:** the version is part of the `updateMany` WHERE clause. If it has moved, the database matches zero rows and `count === 0` raises `CONCURRENCY_CONFLICT`.

### 6.5 Score aggregation

Recomputed from source inside the transaction (`SUM(score) WHERE teamId=? AND status='EVALUATED'`, served by the `[teamId, status]` index) rather than applied as a delta. A lost or replayed update therefore cannot make the stored score drift from the evaluations that justify it.

---

## 7. Timer architecture

**Single source of truth: the `LevelState` row.** `startedAt`, `endsAt`, `status`, `durationMinutes` and `remainingSeconds` are all server-owned.

**Reads.** `resolveLevelState()` computes `remainingSeconds` and `isExpired` from `endsAt` against server time on every read. A `LIVE` level whose `endsAt` has passed resolves to `COMPLETED` **without requiring an admin action** — expiry is a property of the data, not of a scheduled job.

**Client behaviour.** `LevelTimer` and `MissionTimer` receive the authoritative `endsAt` and count down locally at 1 Hz. **There is no database polling anywhere in the application** (verified by grep: the only `setInterval` calls are display ticks). At 210 participants a 1-second poll would be 210 queries/second; this design contributes zero.

**Consistency across surfaces.** The dashboard banner, `/event` cards and all three level pages read the same `LevelState` rows through the same helpers, so they cannot disagree.

**Server-side expiry enforcement.** `checkAuthoritativeLevelAccess()` gates submissions and both Level 2 resource downloads. A client whose UI has not refreshed still cannot submit past `endsAt` — the server re-derives expiry on every attempt. **TEST VERIFIED** (`tests/phase15-participant-timers-leaderboard.test.ts`: "Client manipulation cannot alter authoritative server state", "Server access check rejects access when level is expired or completed").

---

## 8. Level 1 — status: **CONTENT NOT IMPLEMENTED**

The challenge content for Level 1 does not exist.

**Bug fixed (BUG-17-08).** The page previously rendered fabricated competition content: a described compromised gateway (`GW-EXT-01 (192.168.10.1)`) and the assertion _"Your squad has completed initial telemetry triage."_ No challenge backs any of it. A participant reading that page would reasonably conclude they had already finished — or missed — work that does not exist, and would have no reason to wait for a briefing.

**Now.** `LevelPendingPanel` presents only authoritative state — level name, number, `status`, scheduled window, allocated duration, live timer, lock state — plus an explicit `CONTENT PENDING` badge, a plain-language explanation keyed to the actual status, and a "what to do next" line. No invented content.

The page also **no longer redirects away when the level is locked**. A participant who navigates there is told what the status is, rather than being bounced to `/event` with no explanation.

---

## 9. Level 2 — The Boar's Mark — status: **IMPLEMENTED**

The one fully implemented competition experience. The flow was preserved end to end: Mission Brief → Investigation Protocol → Case Information → Evidence Package → Submission Guidelines → Sample Report → Final Submission → Evaluation → Feedback → Revision.

**Creator ownership preserved and proven.** The Evidence ZIP and Sample Report are Creator-only. `requireCreatorUser()` gates upload, replace, remove and publish/unpublish. Participants may download published resources; evaluators and admins may download but **not** modify. **TEST VERIFIED** — `tests/phase17-rbac-matrix.test.ts` asserts all four resource actions are denied to PARTICIPANT, EVALUATOR, ADMIN and anonymous callers, including when the caller supplies `role=CREATOR` in the form body.

Changes made to Level 2: the render-triggered audit write was throttled (§4), the three page queries were parallelised, the submission lookup now uses the `(teamId, level)` unique index, and the resource routes gained strict path containment (§17).

---

## 10. Level 3 — The Twelve Axes — status: **CONTENT NOT IMPLEMENTED**

As Level 1. Additionally: the previous page rendered a locked-state notice but, once unlocked, showed **only a countdown and nothing else** — a participant would sit watching a timer with no content and no explanation. `LevelPendingPanel` now covers every status.

---

## 11. Authentication

| Aspect              | State                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing    | `scrypt`, 16-byte random salt per password, 64-byte key, `timingSafeEqual` comparison. Sound.                                                                                                              |
| Password policy     | ≥ 12 characters at registration.                                                                                                                                                                           |
| Session token       | 32 random bytes, hex, opaque, DB-backed.                                                                                                                                                                   |
| Cookie              | `httpOnly`, `sameSite=lax`, `secure` in production, 7-day expiry.                                                                                                                                          |
| Session revocation  | A session whose user is not `ACTIVE` is **deleted on its next request**. Blocking an account also deletes all its sessions inside the same transaction.                                                    |
| Account enumeration | Unknown-account and wrong-password return an identical message. Status messages (`pending`, `rejected`, `blocked`) are only returned **after** the password verifies, so they cannot be used to enumerate. |
| Session hygiene     | Expired sessions for the account are reaped on each successful login.                                                                                                                                      |

### SEC-17-02 — Brute-force lockout was a permanent-lockout DoS

**The defect.** An account was treated as locked while `failedLoginCount >= 10 AND (now − lastActivityAt) < 15 min`. But `lastActivityAt` is refreshed by `getSessionUser()` on **every authenticated request** — that is, by the victim's own ordinary browsing.

**Consequence:** ten wrong guesses by anyone, against any known username, locked that participant out **indefinitely**, because their own activity kept renewing the window. On event day this is a trivial, untraceable way to remove a competitor.

**The fix.** `User.lockedUntil` holds an absolute expiry stamped once, at the moment the threshold is crossed. Nothing the account owner does can extend it. On expiry the counter resets so a single further mistake does not immediately re-lock.

**TEST VERIFIED** — four tests in `tests/security-hardening-audit.test.ts`, including one that explicitly advances `lastActivityAt` and asserts `lockedUntil` is unchanged.

---

## 12. RBAC — permission matrix

Roles are **separate authorities, not a hierarchy.** Creator is deliberately denied admin-only and evaluator-only actions: Creator supremacy is expressed by exclusive access to governance, not by being able to score submissions.

| Action group                                                   | PARTICIPANT         | EVALUATOR | ADMIN     | CREATOR   | ANON |
| -------------------------------------------------------------- | ------------------- | --------- | --------- | --------- | ---- |
| Creator governance (approvals, accounts, teams, audit, portal) | DENY                | DENY      | DENY      | **ALLOW** | DENY |
| Creator-owned Level 2 resources                                | DENY                | DENY      | DENY      | **ALLOW** | DENY |
| Admin operations (levels, announcements, monitoring, portal)   | DENY                | DENY      | **ALLOW** | DENY      | DENY |
| Evaluator scoring (queue, start, save, return, finalise)       | DENY                | **ALLOW** | DENY      | DENY      | DENY |
| Participant actions (team, submit, leaderboard)                | **ALLOW**           | DENY      | DENY      | DENY      | DENY |
| Submission file download                                       | DENY                | ALLOW     | ALLOW     | ALLOW     | DENY |
| Level 2 published resources                                    | ALLOW (level-gated) | ALLOW     | ALLOW     | ALLOW     | DENY |

**TEST VERIFIED — 140 assertions** in `tests/phase17-rbac-matrix.test.ts`. Every privileged server action is invoked **directly** as each role, bypassing the UI entirely, because hiding a button is not an authorization control. The suite also verifies:

- Account **status** is enforced independently of role — a `PENDING_APPROVAL`, `BLOCKED`, `SUSPENDED` or `REJECTED` account is denied even with the correct role.
- Client-supplied role claims are ignored — a participant sending `role=CREATOR` in the form body is still refused.

**All 140 passed on the first run.** The pre-existing authorization design was sound; this test does not fix it, it proves and locks it.

---

## 13–16. Portal permissions in detail

**Creator** — approve/reject staff; view/block/unblock/delete accounts; view/block/unblock/delete squads; portal ONLINE/OFFLINE; manage Level 2 resources; activity and audit logs; active-session monitor. Cannot block or delete their own account. Destructive operations route through `confirmation-modal.tsx`. Blocking or deleting an account deletes its sessions in the same transaction, so access is revoked immediately rather than at cookie expiry.

**Admin** — level lifecycle (start/pause/resume/stop/reset/configure duration); announcements; portal toggle; read-only participant, squad, submission and evaluation monitors; activity log. Cannot reach Creator governance, cannot manage Creator-owned Level 2 resources, cannot read password hashes or squad join codes.

**Evaluator** — squad and submission queues; open submissions; start, draft, return-for-revision and finalise evaluations; download submission files; own activity log. Requires `status = ACTIVE`: pending and blocked evaluators are refused. Cannot reach Creator or Admin areas, cannot modify Creator resources. `Team.code` and `Team.passwordHash` are never selected in any evaluator query.

**Participant** — dashboard, team create/join, three level pages, leaderboard, announcements, Level 2 submission, published resource downloads. Everything else denied.

---

## 17. File security

| Control                   | Implementation                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extension allow-list      | Submissions: `.pdf .docx .doc .zip`. Resources: `.zip` (evidence), `.pdf` (sample report).                                                                                                 |
| MIME validation           | Checked against an allow-list when supplied.                                                                                                                                               |
| **Magic-byte validation** | `%PDF`, `PK\x03\x04`/`\x05\x06`/`\x07\x08`, and the OLE2 signature for `.doc`. A renamed `.exe` is rejected.                                                                               |
| Size limits               | 20 MB per submission file; 50 MB evidence; 20 MB sample report.                                                                                                                            |
| Filename sanitisation     | `path.basename`, null-byte strip, control-char strip, traversal-dot collapse, reserved-character replacement. Stored under a server-generated name; the original is kept only as metadata. |
| Authorization             | Submission downloads require ACTIVE Evaluator/Admin/Creator. Resource downloads require an ACTIVE session, and participants additionally pass level access.                                |
| Audit                     | `FILE_ACCESSED`, `EVIDENCE_ACCESSED`, `SAMPLE_REPORT_ACCESSED`.                                                                                                                            |

### SEC-17-03 — Path containment was insufficient

The submission-file route checked:

```ts
if (!resolved.startsWith(baseDir) && !resolved.startsWith(process.cwd())) reject;
```

Two defects. The `process.cwd()` alternative made **any file inside the project directory** servable — `.env`, `prisma/dev.db`, source — the moment a `storagePath` was wrong or attacker-influenced. And bare `startsWith` is prefix matching, not containment: `/app/uploads/submissions-evil/x` passes a `startsWith('/app/uploads/submissions')` test.

Replaced with `resolveContainedPath()` (`src/lib/storage/safe-path.ts`), which compares via `path.relative` and rejects anything that climbs out, and applied to all three file routes. `storagePath` is server-generated, so this is defence in depth against a database compromise or a future code path — not a live exploit.

### Cross-team isolation

There is **no participant-facing download route for submission files at all**, so Team A cannot reach Team B's deliverables. **TEST VERIFIED** (`tests/security-hardening-audit.test.ts`, `tests/phase4-level2-workspace.test.ts` squad-isolation cases).

### BUG-17-03 — Orphaned uploads

Files are written to disk **before** the transaction, because magic-byte validation must precede any database record. If the transaction was then rejected — most commonly by the duplicate-submission guard — the bytes stayed on disk forever with no row referencing them. Over an event of 50 squads retrying, that silently fills the upload volume. `discardSubmissionFiles()` now cleans up on every failure path. **TEST VERIFIED**.

---

## 18. Leaderboard architecture

Single indexed query: `where status='ACTIVE'`, `select` of six scalar fields plus `_count.members`, ordered `[score desc, updatedAt asc]`, served by `Team[status, score]`.

`Team.code` and `Team.passwordHash` are **never selected**. **TEST VERIFIED** ("never leaks team joining code or passwordHash in public team queries").

Ranking, tie-breaking, top-3 podium, current-squad highlighting, search and pagination are handled client-side over ~50 rows — appropriate at this scale, and it avoids a query per interaction.

**LOAD VERIFIED:** p50 18.3 ms, p95 28.1 ms, ~7,000 ops/s at 210-way concurrency.

---

## 19. Announcements

### SEC-17-04 — Cross-audience count leak

Audience filtering was written inline at each call site and had drifted. `/announcements` filtered correctly, but the unread badge counts on `/leaderboard`, `/event` and `/team` counted **every published announcement**, including `EVALUATORS`- and `ADMINS`-only broadcasts.

Participants could not read those messages, but the badge told them staff-only traffic existed and exactly how much of it there was — an operational side-channel during a live event.

All audience decisions now route through `src/lib/event/announcements.ts` (`announcementVisibilityWhere`, `countVisibleAnnouncements`, `listVisibleAnnouncements`, `latestVisibleAnnouncement`), so the feed and the badge cannot disagree again. Feed queries are bounded with `take`.

Notification fan-out (`deliverAnnouncementNotifications`) uses a single `createMany` — one statement for ~210 recipients, not 210 statements.

---

## 20. Caching and revalidation

| Data                       | Classification           | Handling                                                                             |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| Login / signup / marketing | Static                   | Prerendered.                                                                         |
| All authenticated pages    | User-specific, real-time | Dynamic per request; `cookies()` forces this. **No cross-user caching is possible.** |
| Level state                | Real-time                | Read per request; expiry derived from `endsAt`.                                      |
| File downloads             | Private                  | `Cache-Control: private, no-cache, no-store, must-revalidate`.                       |
| Mutations                  | —                        | Targeted `revalidatePath` on affected routes only.                                   |

No `unstable_cache`, no `fetch` caching, no `revalidate` exports. There is no mechanism by which one participant's private state could be served to another.

### BUG-17-04 — Revalidation failure masked a successful write

`revalidatePath` runs **after** the transaction commits. If it throws, the surrounding `try/catch` converted an operation that genuinely **succeeded** into an error response — the participant saw "submission failed", retried, and hit the duplicate guard on a submission that was already saved.

Found because the concurrency test suite exercised the action outside a Next.js request scope, where `revalidatePath` throws. `safeRevalidate()` (`src/lib/utils/revalidate.ts`) now isolates it: a failed cache invalidation is a staleness problem, never a correctness one.

---

## 21. Performance and capacity analysis

### 21.1 Measured results — LOAD VERIFIED

`npm run seed:event-fixture && npm run load:test`, with `DATABASE_URL` carrying the pool settings from §2.2. 50 squads, 210 participants, 210-way concurrency, 3 waves per read scenario. Two independent runs; figures below are run 2.

| Scenario                                  | ops | p50 ms | p95 ms | p99 ms | ops/s  | errors                        |
| ----------------------------------------- | --- | ------ | ------ | ------ | ------ | ----------------------------- |
| Participant dashboard bundle              | 630 | 31.7   | 57.5   | 60.8   | 4,591  | **0**                         |
| Leaderboard read                          | 630 | 18.3   | 28.1   | 29.4   | 7,038  | **0**                         |
| Session user resolution                   | 630 | 16.0   | 20.3   | 21.0   | 11,250 | **0**                         |
| Level 2 workspace bundle                  | 630 | 42.4   | 46.1   | 46.6   | 4,542  | **0**                         |
| Evaluator submission queue                | 36  | 2.8    | 6.9    | 7.0    | 2,629  | **0**                         |
| Concurrent submission writes (50 squads)  | 50  | 35.5   | 423.8  | 644.3  | 78     | **0**                         |
| Duplicate submission storm                | 50  | 20.4   | 75.3   | 92.2   | 533    | 50 _(all correctly rejected)_ |
| Concurrent evaluation + score aggregation | 50  | 63.3   | 653.8  | 873.6  | 57     | **0**                         |

**Post-load integrity: ALL INVARIANTS HOLD** — 0 duplicate submissions, 0 over-capacity squads, 0 squads with score drift.

### 21.2 What these numbers do and do not establish

**They establish** that the database layer sustains 210-participant concurrency across every hot query shape, and that the integrity invariants survive a deliberate write storm.

**They do not establish** that the deployed application serves 210 concurrent browsers. This harness does not exercise HTTP, React server rendering, cookie parsing, TLS, or the network. Application-server capacity is **NOT VERIFIED** — see §24.

### 21.3 210-participant / 50-squad capacity analysis

Read paths are comfortable: the heaviest bundle (Level 2 workspace) runs at p95 46 ms with 210 concurrent callers, roughly two orders of magnitude of headroom against a 5-second page budget.

Write paths are the constraint, and they are bursty rather than sustained. Realistic worst case is all 50 squads submitting in the final minute: measured at 0 errors, p95 424 ms. The comparable evaluation burst measured 0 errors, p95 654 ms.

Sustained background writes after Phase 17: `lastActivityAt` refresh at 210 participants / 5 min ≈ 0.7 writes/s, plus throttled audit at ≈ 0.25 writes/s. **Before** Phase 17 this was ≈ 3.5 writes/s of activity telemetry plus unbounded per-render audit writes.

---

## 22. Security findings

| ID        | Severity     | Finding                                                                                                                                                                                                                                                                                                     | State                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-17-01 | **CRITICAL** | Real Creator password and the owner's real email hardcoded in `.env.example` (staged for commit), as a fallback in `prisma/seed.ts`, **and in the tracked test file `tests/creator-control-center.test.ts`**.                                                                                               | **FIXED** — env-only, no fallback, minimum length enforced. **The exposed password must be rotated** (§26).                                                                                                                                                                                                                                                                |
| SEC-17-06 | **CRITICAL** | `prisma/dev.db` and `uploads/` were **not git-ignored**. The first commit would have published every account's email and scrypt password hash, every squad's PRIVATE join code and squad password hash, every live session token (a valid token is an account takeover), and every submitted evidence file. | **FIXED** — `.gitignore` now excludes the database, its WAL sidecars, `uploads/` and `backups/`. Verified with `git check-ignore`: the commit set contains only schema, migrations and seed. **If this repository has already been pushed with the database committed, the rules are not enough — the data is in git history. Rotate every credential and purge history.** |
| SEC-17-02 | **HIGH**     | Brute-force lockout renewed itself from the victim's own activity — permanent account lockout from ten wrong guesses.                                                                                                                                                                                       | **FIXED**, TEST VERIFIED.                                                                                                                                                                                                                                                                                                                                                  |
| SEC-17-03 | **MEDIUM**   | Path containment allowed any file under `process.cwd()`; prefix-based `startsWith` matching.                                                                                                                                                                                                                | **FIXED** across all three file routes.                                                                                                                                                                                                                                                                                                                                    |
| SEC-17-04 | **MEDIUM**   | Announcement badge counts leaked existence and volume of staff-only broadcasts to participants.                                                                                                                                                                                                             | **FIXED**, centralised.                                                                                                                                                                                                                                                                                                                                                    |
| SEC-17-05 | **LOW**      | `getSessionUser()` carried `passwordHash` in the object passed to server components. Never rendered.                                                                                                                                                                                                        | **FIXED** — structurally absent; the type system now prevents reintroduction.                                                                                                                                                                                                                                                                                              |

### Reviewed and found clean

- **SQL injection** — no `$queryRaw`/`$executeRaw` with interpolation. The only raw statements are fixed `PRAGMA` literals.
- **XSS** — zero `dangerouslySetInnerHTML`, zero `eval`, zero `new Function` in `src/`.
- **CSRF** — Next.js server actions carry origin checks; session cookie is `sameSite=lax`.
- **IDOR** — submission-file access is role-gated; there is no participant-facing file route to abuse.
- **Open redirects** — all redirects are string literals; none derive from user input.
- **Privilege escalation** — 140 RBAC assertions, all passing.
- **`any` usage** — none in `src/`.
- **Dependency vulnerabilities** — `npm audit`: **0 vulnerabilities**.
- **CSP** — every directive resolves to `'self'` or `'none'`; `frame-ancestors 'none'`; HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` all set.

---

## 23. Bugs found and fixed

| ID               | Severity     | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB-17-02         | **CRITICAL** | SQLite in `journal_mode=delete` — writers block all readers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CONC-17-02       | **CRITICAL** | Prisma SQLite single-connection pool: **40 of 50 concurrent submissions failed** at ~11 s. Measured.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SEC-17-01        | **CRITICAL** | Creator credentials committed to source.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| SEC-17-02        | **HIGH**     | Permanent account-lockout DoS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| DB-17-01         | **HIGH**     | No `UNIQUE(teamId, level)` — duplicate-submission prevention was datasource-dependent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DB-17-03         | **HIGH**     | Squad capacity not DB-enforced — would break on migration to any MVCC engine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| PERF-17-04       | **HIGH**     | Unbounded audit writes on every render / every list query.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| PERF-17-03       | **HIGH**     | Five-table session join on every request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| PERF-17-05       | **HIGH**     | Three redundant queries on the hottest read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| BUG-17-08        | **HIGH**     | Level 1 presented fabricated competition content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| BUG-17-03        | **MEDIUM**   | Orphaned upload files on rejected submissions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| BUG-17-04        | **MEDIUM**   | `revalidatePath` failure reported a successful submission as failed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| BUG-17-05        | **MEDIUM**   | Evaluator activity "squad" filter compared `targetId` (a **user** id) against a **team** id — the filter silently matched nothing.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| BUG-17-06        | **MEDIUM**   | Creator activity log: the text search overwrote `where.OR`, silently **discarding the account filter** while the UI still showed it as active.                                                                                                                                                                                                                                                                                                                                                                                                         |
| SEC-17-03        | **MEDIUM**   | Weak path containment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-17-04        | **MEDIUM**   | Cross-audience announcement count leak.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CONC-17-01       | **MEDIUM**   | Optimistic lock was read-then-write.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PERF-17-01/02/06 | **MEDIUM**   | Query waterfalls, 60 s activity writes, row-fetching-to-count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| BUG-17-09        | **MEDIUM**   | `npm run verify` could never pass. `output: 'standalone'` copies `scripts/` into the build, so `check:no-cdn` scanned its own detector and test fixtures and reported their example URLs and blocked-host list as violations. Because `verify` runs `build` before `check:no-cdn`, the pipeline failed unconditionally — the project's own quality gate had not been passing. Fixed by excluding test files and `scripts/` directories (Node-only tooling, never served to a browser); confirmed the check still fails on a genuine planted violation. |
| BUG-17-07        | **LOW**      | Level 3 rendered a bare countdown with no content once unlocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SEC-17-05        | **LOW**      | `passwordHash` present on the session object.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| INFO             | INFO         | `zod` is a dependency but never imported. `src/app/page.tsx` is unreachable (`next.config.ts` redirects `/` → `/login`). Neither removed — both are harmless, and §40 of the brief says not to refactor stable code for style.                                                                                                                                                                                                                                                                                                                         |

---

## 24. Remaining risks

| Risk                                     | Severity   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No browser verification**              | **HIGH**   | No page in this application has been loaded in a real browser during this phase. Hydration, client interactivity, responsive layout, keyboard navigation and focus states are **CODE VERIFIED ONLY**. Hydration risk is _structurally_ low — all date formatting goes through fixed-locale, fixed-timezone (UTC) `Intl` formatters in `src/lib/utils/date-formatter.ts`, and timers seed from server props before ticking — but this is reasoning, not observation. |
| **No HTTP-level load test**              | **HIGH**   | Capacity is proven at the database layer only. The Next.js server's own concurrency (React rendering, cookie parsing, action deserialisation) is unmeasured.                                                                                                                                                                                                                                                                                                        |
| **SQLite single-writer ceiling**         | **MEDIUM** | Measured as adequate for this event, but there is no headroom for growth and no horizontal scaling.                                                                                                                                                                                                                                                                                                                                                                 |
| **Single point of failure**              | **MEDIUM** | One server, one database file. No replication, no failover.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Level 1 and Level 3 content**          | **MEDIUM** | Not implemented. The portal is now honest about this, but the levels cannot be run.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Exposed Creator password**             | **MEDIUM** | The committed password must be rotated before the event (§26).                                                                                                                                                                                                                                                                                                                                                                                                      |
| **In-memory file buffering**             | **LOW**    | `file.arrayBuffer()` loads whole uploads into memory. 50 concurrent 20 MB uploads ≈ 1 GB peak RSS. Not hit in testing; provision memory accordingly or move to streaming.                                                                                                                                                                                                                                                                                           |
| **Absolute `storagePath` for resources** | **LOW**    | `LevelResource.storagePath` stores an absolute path, so moving the deployment directory breaks resource downloads until re-uploaded.                                                                                                                                                                                                                                                                                                                                |
| **No rate limiting**                     | **LOW**    | Beyond per-account login lockout, there is no per-IP throttling. Acceptable on a controlled event network; not for public internet exposure.                                                                                                                                                                                                                                                                                                                        |

---

## 25. Deployment recommendations

1. **Rotate the Creator password** — see §26. Do this first.
2. **Set the pooled `DATABASE_URL`** exactly as in §2.2. The startup warning will tell you if you have not.
3. `npm ci`
4. `npm run db:migrate` (`prisma migrate deploy` — never `db push`)
5. `npm run db:pragmas` — confirm WAL. Required once per database file.
6. `npm run db:seed` with `CREATOR_EMAIL` and `CREATOR_PASSWORD` set.
7. `npm run db:doctor` — must exit 0.
8. `npm run verify` — typecheck, lint, format, tests, build, CDN check.
9. `npm run build && npm start` behind a TLS-terminating reverse proxy. `secure` cookies require HTTPS.
10. Set `NODE_ENV=production`.
11. **Smoke-test the full role flow in a real browser before participants arrive** — this is the gap §24 names, and it is the highest-value hour you can spend.

---

## 26. Credential rotation (required)

`.env.example` contained a real Creator password and the owner's real email, and `prisma/seed.ts` used the same password as a hardcoded fallback. The file was untracked but staged for the first commit.

**Treat that password as compromised.** Before the event:

1. Choose a new password (≥ 16 characters) and store it in a password manager.
2. Set `CREATOR_EMAIL` and `CREATOR_PASSWORD` in `.env` (git-ignored).
3. Run `npm run db:seed` — it upserts and rotates the Creator's hash.
4. Confirm `.env` is not tracked: `git status --porcelain .env` must be empty.

The seed now **refuses** to create a Creator without both variables, and rejects any password under 12 characters. There is no fallback.

---

## 27. Backup and recovery

**SQLite.** A file copy taken while the database is being written is **not** a valid backup. Use the online backup API:

```bash
sqlite3 prisma/dev.db ".backup 'backups/odyssey-$(date +%Y%m%d-%H%M%S).db'"
```

WAL mode means `dev.db-wal` and `dev.db-shm` may exist alongside the main file; `.backup` handles this correctly, `cp` does not.

**Recommended cadence for event day:**

| When                       | Action                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| Before the event           | Full backup + **a restore rehearsal**. An untested backup is not a backup. |
| Every 15 min during levels | Automated `.backup` to a separate volume.                                  |
| After each level closes    | Tagged backup, retained.                                                   |
| After evaluation completes | Final backup before announcing results.                                    |

Also back up `uploads/` — submission files and Creator resources live on disk, not in the database. A database restore without the matching `uploads/` leaves `SubmissionFile` rows pointing at missing files; `npm run db:doctor` detects exactly this.

**Restore:** stop the app, replace `dev.db` (remove stale `-wal`/`-shm`), restore `uploads/`, run `npm run db:pragmas`, run `npm run db:doctor`, restart.

**Rollback:** migrations are forward-only. To roll back, restore the pre-migration backup.

---

## 28. Monitoring

**Built in this phase:**

- `npm run db:doctor` — seven integrity invariants; exits non-zero on violation, so it can gate a deploy or run on a cron during the event.
- Slow-query logging — `src/lib/prisma.ts` logs any query over `SLOW_QUERY_MS` (default 300 ms). **Query text only; parameters are never logged**, so password hashes and join codes cannot reach the log.
- Startup misconfiguration warning for unpooled SQLite.

**Watch during the event:** failed-login and `ACCOUNT_LOCKED` rate, submission success/failure ratio, `[prisma:slow]` frequency, `AuditLog` growth rate, disk free on the `uploads/` volume, process RSS during submission windows.

**Do not log:** passwords, password hashes, session tokens, squad join codes, query parameters.

---

## 29. Database failure behaviour

| Failure                 | Behaviour                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database unavailable    | `getSessionUser()` returns null → redirect to `/login` rather than a crash. `getPortalStatus()` fails safe to online. Route errors render `app/error.tsx`, not a stack trace. |
| Transaction fails       | Atomic rollback. Uploaded files are cleaned up (BUG-17-03). The user gets an explicit "nothing was saved" message.                                                            |
| Duplicate request       | Unique constraints reject it; the user is told a teammate's submission was recorded.                                                                                          |
| Timeout                 | Bounded by `CRITICAL_WRITE_TX`; surfaced as a clear error, never a partial write.                                                                                             |
| Restart mid-transaction | SQLite WAL rolls back the uncommitted transaction on next open.                                                                                                               |

---

## 30. Test matrix

**375 tests across 15 files. All passing.** (Baseline before Phase 17: 223.)

| Area                             | File                                                                 | Tests   |
| -------------------------------- | -------------------------------------------------------------------- | ------- |
| Auth, teams, staff lifecycle     | `participant-team.test.ts`                                           | 30      |
| Security hardening + lockout     | `security-hardening-audit.test.ts`                                   | 22      |
| **Concurrency & data integrity** | **`phase17-concurrency.test.ts`**                                    | **9**   |
| **RBAC matrix**                  | **`phase17-rbac-matrix.test.ts`**                                    | **140** |
| Creator control centre           | `creator-control-center.test.ts`                                     | 39      |
| Admin portal                     | `admin-portal.test.ts`                                               | 27      |
| Evaluator portal                 | `evaluator-portal.test.ts`                                           | 20      |
| Level 2 resources                | `level2-resource-management.test.ts`                                 | 20      |
| Level 2 workspace                | `phase4-level2-workspace.test.ts`                                    | 19      |
| Timers & leaderboard             | `phase15-participant-timers-leaderboard.test.ts`                     | 19      |
| Participant portal               | `phase3-participant-portal.test.ts`, `participant-portal-v2.test.ts` | 15      |
| Date determinism                 | `date-formatter.test.ts`                                             | 5       |
| Auth UI                          | `auth-ui.test.ts`                                                    | 6       |
| CDN policy                       | `detect-external-refs.test.mjs`                                      | 4       |

### On the concurrency suite

It invokes the **real server actions** under simultaneous dispatch, not a reimplementation of them. Each concurrent call carries its own session identity via `AsyncLocalStorage` — a shared module variable would have been overwritten by the last caller before the first action read it, so every "concurrent" request would have authenticated as the same participant and **the race under test would never have occurred**. That bug was present in the first draft of the suite and is why the capacity tests initially reported false results.

**Honest limit:** the test datasource is SQLite, which serialises writers. These tests demonstrate that the guards behave correctly and that the unique indexes are the mechanism doing the rejecting. They cannot, alone, prove behaviour under a truly parallel MVCC engine — the structural argument for that is §6.

---

## 31. Final verification

| Command                 | Result                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run typecheck`     | **PASS**                                                         |
| `npm run lint`          | **PASS**                                                         |
| `npm run format:check`  | **PASS**                                                         |
| `npm test`              | **PASS** — 375/375                                               |
| `npm run build`         | **PASS**                                                         |
| `npm run check:no-cdn`  | **PASS** — 765 files scanned (see BUG-17-09)                     |
| `npm run verify` (full) | **PASS** — exit code 0                                           |
| `npm audit`             | **PASS** — 0 vulnerabilities                                     |
| `git diff --check`      | **PASS**                                                         |
| `npm run db:doctor`     | **PASS**                                                         |
| `npm run load:test`     | **PASS** — 0 errors, all invariants hold                         |
| Browser testing         | **NOT PERFORMED** — no browser automation was run in this phase. |
| HTTP load testing       | **NOT PERFORMED** — no HTTP load tool was run.                   |

---

## 32. Bottom line

The portal is **substantially stronger than it was**: the integrity rules that matter are now enforced by the database rather than by application convention, the two SQLite defaults that would have broken event day are fixed and measured, a permanent-lockout DoS is closed, credentials are out of source, and the participant-facing copy no longer claims work that does not exist.

**It is not "everything is production ready."** Two things stand between this report and that claim, and neither is a code change:

1. **Nothing has been opened in a browser.** Every UI, hydration and accessibility statement here is code-level reasoning.
2. **Capacity is proven at the database layer only.** The application server under 210 real browsers is unmeasured.

Close those two gaps with a browser smoke-test of the full role flow and one HTTP load run, and the evidence would support the claim. Until then: **database layer LOAD VERIFIED, security and RBAC TEST VERIFIED, UI CODE VERIFIED ONLY.**
