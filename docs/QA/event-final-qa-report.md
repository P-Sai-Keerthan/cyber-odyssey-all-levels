# Cyber Odyssey — Final Pre-Event QA Report

**Testing performed:** 2026-09-08, 17:00–22:51 IST
**Tester role:** Final QA engineer (end-to-end participant simulation)
**Report version:** 1.0

> **No credentials, tokens, API keys, or secrets appear in this document.**
> A throwaway QA participant account was created through the real signup form and
> deleted afterwards; its password is deliberately not recorded here.

---

## 1. Environment Tested

| Item | Value |
|---|---|
| Portal | Next.js 15.5 (App Router), `http://localhost:3002`, **production build** (`next build` + `next start`) |
| Level 1 | Next.js 16.3 (Pages Router), `http://localhost:3001`, **production build** |
| Database | PostgreSQL 16 (Docker), `odyssey_portal` + `cyber_odyssey` |
| Node | v24.18.0 |
| Browser | Chromium in-app pane, viewports 1920 / 1440 / 1366 / 430 / 390 |

**Not tested:** the live deployment at `cyberodyssey.factamrita.in`. It was reached only
with a handful of benign HEAD/GET requests to confirm reachability and inspect security
headers. **No load was applied to production and no production data was modified.**

---

## 2. Routes Tested

**Portal —** `/login`, `/signup`, `/team/onboarding`, `/team`, `/dashboard`, `/event`,
`/event/level-1`, `/event/level-2`, `/event/level-3`, `/leaderboard`, `/admin`,
`/admin/teams`, `/creator`, `/creator/resources/level-3`, `/evaluator`,
`/evaluator/evaluations`

**Level 1 —** `/`, `/api/event/status`, plus the full API surface via the automated suite
(`/api/team/login`, `/api/enter`, `/api/trackA|B|C/*`, `/api/admin/*`).

---

## 3. Login Results

| Check | Result | Evidence |
|---|---|---|
| Login page loads | PASS | Renders at all tested widths |
| No console errors | PASS | Console read returned no logs |
| No broken API requests | PASS | All requests 200; one `ERR_ABORTED` is a superseded RSC prefetch |
| Empty-field validation | PASS | Per-field messages; button becomes "RETRY SIGN IN" |
| Wrong credentials fail | PASS | Uniform message, **does not reveal whether the account exists** |
| Correct credentials work | PASS | Signup auto-login routed to `/team/onboarding` |
| Session works after login | PASS | Username and PARTICIPANT role rendered; authenticated pages served |
| Refresh keeps session | PASS | Repeated authenticated requests with the same session succeeded |
| Logout works | PASS | Redirects to Sign In |
| **Logout invalidates server-side** | PASS | Replayed old token rendered **no** team data; **session row deleted from DB** |
| Protected routes protected | PASS | 13 routes tested unauthenticated — all redirect to Sign In |
| No data leakage | PASS | Real team names grepped against unauthenticated `/admin/teams` — **zero hits** |

---

## 4. Level 1 Results

| Check | Result | Evidence |
|---|---|---|
| Level page loads | PASS | Renders with correct brief and track breakdown |
| Points displayed | PASS | **100 PTS** |
| Track breakdown consistent | PASS | Track A 30 + Track B 30 + Track C 40 = **100** |
| **Placeholders neutral** | PASS | All challenge inputs now read `Enter your answer here...` |
| **Placeholders do not reveal answers** | PASS | 0 occurrences of any answer string in the built bundle |
| Question not repeated in input | PASS | Prompts sit above the field; input carries only neutral text |
| Attempt limit = 3 | PASS | Automated tests 13.H / 13.I / 13.J — enforced and clamped |
| Attempts independent per track | PASS | Tests 13.F / 13.G |
| Team isolation | PASS | Test 13.K — state returns only the requesting squad |
| Leaderboard admin-only | PASS | Test 13.L |
| Empty / wrong / correct answer | PASS | Covered by the 72-test functional suite |

**Not performed:** manual browser click-through of each individual challenge
(open → submit empty → submit wrong → submit correct → refresh → next). Attempt limits,
scoring and persistence were verified through the automated suite and the database
rather than by clicking. See section 13.

---

## 5. Level 2 Results

| Check | Result | Evidence |
|---|---|---|
| Page loads | PASS | Mission brief, protocol, evidence, submission sections render |
| Points displayed | PASS | **1,000 PTS** |
| Submission form present | PASS | PDF / DOCX / ZIP, max 20 MB per file |
| Shared squad submission | PASS | "All squad members share one submission — the latest is judged" |
| Resubmission allowed | PASS | Stated and reflected in submission state |
| Access control | PASS | Redirects when unauthenticated |
| Console errors | PASS | None |
| Page title | **FAIL (LOW)** | Renders "… \| ACN Cyber Odyssey \| ACN Cyber Odyssey" — template applied twice |

**Not performed:** actual file upload and download round-trip through the browser.

---

## 6. Level 3 Results

| Check | Result | Evidence |
|---|---|---|
| Page loads | PASS | Brief, protocol, scoring and submission sections render |
| Points displayed | PASS | **3,700 PTS** (3,500 discovery + 200 report) |
| **Target IP from config** | PASS | **10.20.30.40**, read from `Level3Config`, not hardcoded |
| Scoring formula shown | PASS | Bug Discovery − Hint Penalties + Approved Report |
| Track 1 value | PASS | **3,500 PTS** |
| Track 2 value | PASS | **6,500 PTS**, correctly described as *cumulative*, not additive |
| Discovery available | PASS | **3,500 PTS** |
| Current score (new squad) | PASS | 0 PTS, "APPROVED REPORT: PENDING" |
| No fabricated scores | PASS | No "Evaluator scored X" cards on the participant view |
| Deliverable status | PASS | "NO DELIVERABLES SUBMITTED" |

**Not performed:** bug-discovery ingestion, report upload, evaluator scoring and Admin
approval end-to-end. Requires the ORION bridge and staff accounts.

---

## 7. Scoring Verification

Verified at three independent layers — **UI text, server-rendered HTML, and the
database** — not by visual inspection alone.

### Database (authoritative)

```
LevelState.maxScore     L1 = 100    L2 = 1000   L3 = 200
Level3Config            track1Points = 3500   track2Points = 6500   released = false
```

### Server-rendered HTML (authenticated /event)

```
100 PTS    x2      1,000 PTS  x2      3,700 PTS  x2
```

### Participant UI

```
/event grid       L1 100 PTS   L2 1,000 PTS   L3 3,700 PTS
Level pages       L1 100 PTS   L2 1,000 PTS   L3 3,700 PTS
Level 3 scoring   Track 1 3,500 PTS    Track 2 6,500 PTS
Evaluator scale   L1 100   L2 1000 (4 criteria)   L3 200 (1 criterion)
```

| Requirement | Result |
|---|---|
| **100 must display as 100, not 1000** | **PASS** |
| **3500 must display as 3500, not 4500** | **PASS** |
| Level totals internally consistent | PASS — L1 tracks 30 + 30 + 40 = 100 |
| Grid and level pages agree | PASS — single source of truth |
| Leaderboard correct | PASS — `db:doctor` score-drift = 0 |
| No duplicate scoring | PASS — 100/100 squads correct under 300-way concurrency |

**Origin of the reported wrong values:** `4500 = 3500 + 1000`. The production database
still holds `LevelState(3).maxScore = 1000` (should be 200) and
`LevelState(1).maxScore = 1000` (should be 100). The **code is correct**; the
**production data is stale**. Local database and code both verified correct.

---

## 8. Online/Offline Verification

Verified accidentally and conclusively during load testing.

**When the level window had expired**, all 300 concurrent signed score callbacks were
rejected with **HTTP 409 `LEVEL_NOT_LIVE`** — "Level 1 is not currently accepting
results." No score was written. Integrity check: 0/100 squads scored.

**After reopening the window**, the identical 300 callbacks returned **300/300 success**
and 100/100 squads were scored correctly.

| Check | Result |
|---|---|
| Backend blocks submissions when closed | **PASS** — server-side, not a frontend flag |
| Frontend shows status | PASS — "EVENT STATUS: LIVE COMPETITION", "ACTIVE // IN PROGRESS" |
| Clear message to caller | PASS — explicit reason code and message |
| Stale frontend cannot bypass | PASS — enforcement lives in the API route |

---

## 9. UI / Responsive Results

Horizontal overflow measured programmatically (`scrollWidth` vs `clientWidth`) on the
densest page (Level 3):

| Width | Overflow | Result |
|---|---|---|
| 1920 | none (1905 / 1905) | PASS |
| 1440 | none (1425 / 1425) | PASS |
| 1366 | none (1351 / 1351) | PASS |
| 430 | none (430 / 430) | PASS |
| 390 | none (390 / 390) | PASS |

No text clipping, no controls outside the viewport, no broken navigation observed. Two
absolutely-positioned decorative elements extend past the viewport edge but do not create
page scroll — cosmetic, not a defect.

---

## 10. Bugs Found

| # | Severity | Area | Issue | Status |
|---|---|---|---|---|
| 1 | **CRITICAL** | Level 1 | Answer inputs displayed the literal correct answers — **35 points** obtainable by copying placeholder text (A1 5, A2 5, A3 10, B1 5, C3 10) | **FIXED** |
| 2 | **CRITICAL** | Build | `@aws-sdk/client-s3` declared but never installed — typecheck failed; with `S3_BUCKET` set every file upload/download would fail at runtime | **FIXED** |
| 3 | **HIGH** | Level 1 auth | Per-IP failure ceiling of 40 shared by all participants behind venue NAT — the 41st mistyped password locked out **the entire room** for 5 minutes | **FIXED** |
| 4 | **HIGH** | Scoring data | Production `LevelState.maxScore` stale → L1 shows 1000, L3 shows 4500 | **ROOT-CAUSED — production fix outstanding** |
| 5 | MEDIUM | Level 3 | `FALLBACK_SCORING` still carried retired 400-point Response values | **FIXED** |
| 6 | MEDIUM | Admin UI | Hardcoded "1000-PT SYSTEM" label contradicting per-level maxima | **FIXED** |
| 7 | MEDIUM | Portal auth | **No per-IP login throttle** — only per-account lockout | **OPEN** |
| 8 | MEDIUM | CI | 11 files fail `format:check`, breaking `npm run verify` | **OPEN** (pre-existing) |
| 9 | LOW | Level 2 | Page title renders "ACN Cyber Odyssey" twice | **OPEN** |
| 10 | LOW | Performance | 300 concurrent page loads → p50 5.3 s | **OPEN** (documented) |

### Bug 1 detail — the answer leak

| Question | Points | Old placeholder vs accepted answer |
|---|---|---|
| A1 | 5 | placeholder was the exact IP + hostname pair |
| A2 | 5 | placeholder was the exact redirect URL |
| A3 | 10 | placeholder was the exact domain |
| B1 | 5 | placeholder value matched the accepted regex |
| C3 | 10 | placeholder **and** its label both satisfied the checker |

---

## 11. Fixes Applied

1. `lib/trackA.js`, `lib/trackB.js` — all 8 challenge placeholders → `Enter your answer here...`
2. `components/EvidenceBoard.js` — placeholder **and** the label above it (both leaked C3)
3. `lib/rateLimit.js` — per-address ceiling 40 → **500**; all three profiles now env-tunable
   (`LEVEL1_MAX_ADDRESS_ATTEMPTS`, `LEVEL1_MAX_TEAM_ATTEMPTS`, `LEVEL1_MAX_ADMIN_ATTEMPTS`)
4. `scripts/test-rate-limit.js` — 4 new regression tests for the shared-NAT venue scenario
5. `.env.example` — documented the three new variables
6. `level-3-workspace.tsx` — `responsePoints 200→0`, `evaluatedPoints 400→200`,
   `availableTotal 3900→3700`, `fullTotal 6900→6700`, default prop `3,900→3,700 PTS`
7. `evaluations-hub-client.tsx` — "1000-PT SYSTEM" → "PER-LEVEL RUBRIC"
8. `npm install` — materialised the declared AWS SDK (lockfile unchanged, no dependency drift)

**No changes** to event logic, challenge questions, answer keys, or scoring formulas.

---

## 12. Tests Executed

| Command | Result |
|---|---|
| `npm test` (Level 1) | **97 passed, 0 failed** (72 functional + 25 rate limiter) |
| `npx vitest run` (Portal) | **783 passed, 33 files** |
| `npx tsc --noEmit` | **clean** |
| `npm run lint` | **clean** |
| `npm run format:check` | **FAIL — 11 files** (pre-existing) |
| `npm run check:no-cdn` | **PASS** — no external references in shipped output |
| `npm run build` (both apps) | **both succeed** |
| `npm run db:doctor` | **0 blocking findings** |
| `npm run load:http` | **ALL WAVES PASSED** |

### Load test — 100 teams x 3 members = 300 participants

| Wave | Concurrency | Success | p50 |
|---|---|---|---|
| Authenticated page loads | 300 | 300/300 | 5298 ms |
| Submission-state API | 300 | 300/300 | 868 ms |
| Level 1 entry (ticket redemption) | 100 | 100/100 | 812 ms |
| Signed score callbacks | 300 | 300/300 | 1984 ms |

**Integrity: 100/100 squads correctly scored, zero duplicates.** 42 PostgreSQL backends
against a 200-connection ceiling.

### Venue-lockout regression, proven both directions

```
ceiling = 40   -> venue locked out: true    (the original bug)
ceiling = 500  -> venue locked out: false   (after fix)
```

---

## 13. Remaining Risks

| Risk | Severity | Blocks event? |
|---|---|---|
| Production DB holds stale level maxima | **HIGH** | **YES** |
| Answer-leak fix exists only locally, not deployed | **CRITICAL** | **YES** |
| `npm install` not run on the production host | **CRITICAL** (if `S3_BUCKET` set) | **YES** |
| Portal has no per-IP login throttle | MEDIUM | No |
| 11 files fail `format:check` | MEDIUM | No |
| 5.3 s p50 at 300 concurrent | LOW | No |
| Level 2 duplicated page title | LOW | No |

### Explicitly not verified

- Whether the deployed code matches this tree
- Any production behaviour under load
- Manual click-through of individual Level 1 challenges in a browser
- Level 2 file upload/download round-trip
- Level 3 discovery ingestion, report upload, evaluator scoring, Admin approval
- Password reset flow

### Note on test methodology

During browser testing, in-tab route navigation repeatedly showed the app's loading
fallback. This was traced to an aborted RSC prefetch caused by rapid programmatic
navigation — **not an application defect**: the server rendered every authenticated page
in 60–80 ms, fresh tabs rendered correctly every time, and no console errors appeared.
Manual navigation should still be spot-checked in a real browser before the event.

---

## 14. Final Decision

# NOT READY

The **local build is in good shape** — every functional, scoring, security and
concurrency check passes. The blockers are all about **what is actually running in
production**.

### Blocking issues

1. **Deploy the current code.** The answer-leak fix exists only in this working tree.
   Until it ships, participants can score 35 Level 1 points by copying greyed-out
   placeholder text.

2. **Correct the production level maxima.**

   ```sql
   UPDATE "LevelState" SET "maxScore" = 100 WHERE "levelNumber" = 1;
   UPDATE "LevelState" SET "maxScore" = 200 WHERE "levelNumber" = 3;
   ```

   (`npm run db:seed` also corrects both.) Then confirm Level 1 reads **100 PTS** and
   Level 3 reads **3,700 PTS**.

3. **Run `npm install` on the production host.** With `S3_BUCKET` configured and the AWS
   SDK absent, every evidence upload and report download fails at runtime.

### Safe to defer until after the event

Portal per-IP throttle, the 11 formatting failures, the duplicated Level 2 title, and
multi-instance scaling for the 5.3 s p50.

### Re-test after deploying

Load `/event` as a real participant and confirm the three point figures read
**100 / 1,000 / 3,700**, and that a Level 1 answer field shows only
`Enter your answer here...`.
