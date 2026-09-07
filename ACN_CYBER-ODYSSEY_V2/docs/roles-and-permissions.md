# Roles & Permissions — Creator, Admin, Evaluator

Implementation record for the three role specifications, including the points
where the specifications and the existing architecture did not line up.

---

## 1. Specification vs. architecture — where they differed, and how it was resolved

Parts of the three specifications are written for a **multi-event, multi-creator
platform**. This codebase is a **single-event platform**. Rather than silently
reinterpret the specs or fabricate models to satisfy their wording, each
difference is recorded here with the decision taken.

One item (§1.2, evaluator assignment) was subsequently confirmed as **out of
scope** rather than a gap, and is documented as such.

### 1.1 There is no `Event` model — CONFLICT, resolved by explicit scope layer

The specs repeatedly refer to "the Creator's own event", "another Creator's event"
and "cross-event access". No `Event` table exists. The event is represented by
three `LevelState` rows and one `PortalSetting` row, and the Creator is a single
seeded account.

**Decision.** No `Event` model was invented. Inventing one would have produced
authorization checks that are structurally always-true — security theatre that
reads as protection while enforcing nothing.

Instead the permission layer models scope explicitly
(`src/lib/auth/permissions.ts`): every scoped check routes through
`isWithinScope()`, which today compares against `EVENT_SCOPE_SINGLETON`. Call
sites already pass the actor and the resource, so introducing a real `Event` model
later changes exactly one function.

**Practical consequence:** Creator scope covers the whole (single) event, so
"another Creator's event" cannot be tested — there is no second event to test
against. **This is NOT VERIFIED and cannot be until multi-event exists.**

### 1.2 Evaluator assignment — OUT OF SCOPE by product decision

The Evaluator specification mentioned "Evaluator A + Team Y assigned to Evaluator
B = DENIED". **This is explicitly not a requirement for this project** and no
manual evaluator-assignment system exists in the architecture. No
`EvaluatorAssignment` model, table, UI or Admin assignment workflow was built,
and none should be added.

**The intended workflow is:**

```
Team → Evaluation → Evaluator
```

Any active evaluator may evaluate any Level 2/3 submission. What matters is that
the evaluation record **captures who performed it**, and that this association
survives every subsequent state change.

`Evaluation.evaluatorId` is written when the evaluation is created or saved, and
is **never modified** by `approveEvaluationAction` or `rejectEvaluationAction` —
those read it (for the separation-of-duties check) but never write it. The
association is therefore structural, not merely conventional.

**Admin visibility.** `getEvaluationQueueAction` returns, per evaluation: team,
level, evaluator, score and maximum, evaluation status, approval status, and
evaluation timestamp — the full set the Admin console needs:

```
Team:      Cyber Wolves
Level:     Level 2
Evaluator: @evaluator_a
Score:     82 / 100
Status:    Pending Admin Approval
```

TEST VERIFIED: evaluator identity persists through submission → rejection →
resubmission → approval, and the Admin queue surfaces all seven fields.

**Also enforced:**

- Level 1 submissions can never be evaluated (§1.3 below).
- An evaluator can never approve any evaluation, including their own.
- Only ACTIVE evaluators may evaluate at all.

### 1.3 Naming mismatches — resolved by mapping to the real sections

| Spec name                       | Actual section in this codebase           | Action                     |
| ------------------------------- | ----------------------------------------- | -------------------------- |
| Creator "Activity Stations"     | `/creator/activity` ("Activity")          | Removed from Creator nav   |
| Admin "Event Contest"           | `/admin/event` ("Event & Portal Control") | Removed from Admin nav     |
| Admin "Activity Management"     | `/admin/activity`                         | Removed from Admin nav     |
| Evaluator "Activity Management" | `/evaluator/activity`                     | Removed from Evaluator nav |

**Note on Admin Event Control:** removing it from the Admin nav also removes the
Admin's _only_ UI route to the portal online/offline toggle. The underlying page,
route guard and action are untouched and the Creator retains full portal control
at `/creator/portal-control`, so no capability was deleted — only unlinked, as
§8 and §16 of the master instruction require.

---

## 2. Permission model

`ROLE + PERMISSION + RESOURCE SCOPE + ACTION`, implemented in
`src/lib/auth/permissions.ts`. Bare `role === 'X'` comparisons are replaced by
`checkPermission(actor, permission, scope)` / `assertPermission(...)`.

**Roles are separate authorities, not a hierarchy.** Creator is deliberately
denied `EVALUATION_APPROVE` and `EVALUATION_SCORE`; Admin is denied Creator
governance. The approval gate only means something if the authority that approves
is distinct from the authority that creates content and the authority that scores.

| Capability group                                | PARTICIPANT | EVALUATOR | ADMIN            | CREATOR         |
| ----------------------------------------------- | ----------- | --------- | ---------------- | --------------- |
| Event & level content, level resources          | —           | —         | —                | **ALLOW**       |
| Staff approval, accounts, squads, portal, audit | —           | —         | —                | **ALLOW**       |
| Credential recovery (account / squad)           | —           | —         | —                | **ALLOW**       |
| Participant & squad visibility                  | —           | ALLOW     | **ALLOW**        | ALLOW           |
| Level lifecycle control                         | —           | —         | **ALLOW**        | —               |
| Evaluation scoring (Level 2 & 3)                | —           | **ALLOW** | —                | —               |
| Evaluation approve / reject                     | —           | —         | **ALLOW**        | —               |
| Report to Creator                               | —           | —         | **ALLOW** (send) | ALLOW (receive) |
| Announcements                                   | —           | —         | ALLOW            | ALLOW           |

---

## 3. The evaluation approval gate

### Before

`saveEvaluationAction` with status `EVALUATED` summed the score straight into
`Team.score`, which `/leaderboard` renders. **An evaluator published to the
official standings unilaterally; there was no approval step at all.**

### After

```
Team → Submission → Evaluator scores → PENDING_APPROVAL
                                            │
                                   Admin reviews
                                    ┌───────┴───────┐
                                 APPROVE          REJECT
                                    │               │
                            Official leaderboard   Back to evaluator
```

**The rule, and how it is enforced.** `Team.score` is never incremented or set
from a client value. It is _recomputed_ as `SUM(score) WHERE approvalStatus =
'APPROVED'`, by the database, inside the same transaction as any approval-state
change (`recomputeTeamScore`, `src/lib/evaluation/approval.ts`). Recomputing
rather than applying a delta is deliberate: a delta can be lost or replayed and
the resulting drift is silent and permanent; a recompute is idempotent.

A pending or rejected score therefore cannot reach the leaderboard even if a
client claims otherwise, because the client never supplies the number.

**Transitions** are encoded as data, not scattered conditionals:

```
NOT_SUBMITTED    → PENDING_APPROVAL          (evaluator submits)
PENDING_APPROVAL → APPROVED | REJECTED       (admin decides)
REJECTED         → PENDING_APPROVAL          (evaluator corrects)
APPROVED         → terminal
```

`APPROVED` is terminal by design: silently pulling back a published score would
change standings participants have already seen.

**Concurrency.** Both decisions use a conditional `updateMany` with the current
approval state in the `WHERE` clause, so two Admins deciding simultaneously
produce exactly one decision — the loser matches zero rows. TEST VERIFIED.

**Separation of duties.** `canApproveEvaluation` refuses when
`actor.id === evaluation.evaluatorId`, regardless of any other permission held.

---

## 4. Level 1 has no evaluation

Enforced in one place (`isEvaluableLevel`, permissions module) and applied at
both `startEvaluationAction` and `saveEvaluationAction`. A crafted request naming
a Level 1 submission is refused server-side regardless of what the UI offered.
TEST VERIFIED, including that no evaluation row is created.

`EVALUABLE_LEVELS = [2, 3]`. The three-level structure is otherwise unchanged.

---

## 5. Credential recovery — replace, never reveal

Passwords are stored as scrypt hashes and are not recoverable by anyone,
including the Creator. There is deliberately no "show password" capability.

`generateTemporaryPassword()` uses `crypto.randomInt` (CSPRNG), a 16-character
value from an alphabet that excludes visually ambiguous characters (0/O, 1/l/I,
5/S, 2/Z) because a marshal typically reads it aloud. The plaintext is returned
to the calling action exactly once, held only in component state, and:

- **never persisted**
- **never logged**
- **never written to the audit record** — the audit says a reset happened, by whom
- never placed in a URL or browser storage

Account resets also **delete every session for that account** in the same
transaction: rotating a credential without revoking sessions leaves whoever holds
the account still logged in, which defeats the purpose when the reset is a
response to compromise.

Creator accounts cannot be reset from inside the portal — otherwise anyone
briefly holding a Creator session could lock out the real Creator. That recovery
is out-of-band (`npm run db:seed`).

---

## 6. Database changes

Migration `20260901000001_evaluation_approval_and_reports`.

**Evaluation** — added `approvalStatus`, `approvedById`, `approvedAt`,
`rejectedById`, `rejectedAt`, `rejectionReason`, plus indexes
`[teamId, approvalStatus]` (on the approval write path) and
`[approvalStatus, submittedAt]` (the Admin queue).

**CreatorReport** — new model for Admin→Creator escalations. Deliberately _not_
an overload of `Announcement`: an announcement is a one-way broadcast with no
subject and no lifecycle, whereas a report is addressed at a specific squad or
participant and has an open/resolved state. Adding a nullable `teamId`, nullable
`participantId` and a status to `Announcement` would have burdened a model that
every participant reads on every page.

### Backfill — the part that matters on a live database

Adding `approvalStatus` with its column default (`NOT_SUBMITTED`) would have made
every already-completed evaluation vanish from the leaderboard the moment the
migration landed, because the leaderboard now sums only `APPROVED`. Squads would
watch their points disappear.

The migration therefore backfills `status = 'EVALUATED'` rows to `APPROVED`, with
`approvedAt` taken from the evaluation's own `submittedAt`/`updatedAt` so the
trail stays truthful, and `approvedById` left **NULL** because no Admin actually
approved them — a null approver is honest, a fabricated one is not. It then
recomputes every `Team.score` so the stored standings and the new gate agree from
the first request.

---

## 7. Files changed

**New**

| File                                                                 | Purpose                                  |
| -------------------------------------------------------------------- | ---------------------------------------- |
| `src/lib/auth/permissions.ts`                                        | Role + permission + scope model          |
| `src/lib/evaluation/approval.ts`                                     | Approval lifecycle, `recomputeTeamScore` |
| `src/lib/auth/temporary-credential.ts`                               | CSPRNG credential generation             |
| `src/lib/reports/constants.ts`                                       | Report enums (outside `'use server'`)    |
| `src/lib/actions/evaluation-approval-actions.ts`                     | Approve / reject / queue                 |
| `src/lib/actions/credential-recovery-actions.ts`                     | Account & squad recovery                 |
| `src/lib/actions/creator-report-actions.ts`                          | Create / list / resolve reports          |
| `src/components/admin/evaluation-approval-client.tsx`                | Approval console                         |
| `src/components/admin/report-to-creator-button.tsx`                  | Escalation composer                      |
| `src/components/creator/temporary-credential-button.tsx`             | Recovery UI                              |
| `src/components/shared/creator-reports-client.tsx`                   | Reports list (both roles)                |
| `src/app/admin/reports/page.tsx`, `src/app/creator/reports/page.tsx` | Report pages                             |
| `tests/roles-evaluation-approval.test.ts`                            | 31 tests                                 |
| `prisma/migrations/20260901000001_.../migration.sql`                 | Schema + backfill                        |

**Modified** — `prisma/schema.prisma`; `evaluator-actions.ts` (Level 1 exclusion,
approval status, gate); `admin-sidebar.tsx`, `creator-sidebar.tsx`,
`evaluator-sidebar.tsx` (removals + Reports); `admin/evaluations/page.tsx`;
`accounts-client.tsx`, `teams-client.tsx` (Creator recovery); admin
`teams-client.tsx` (escalation); evaluator `evaluations-client.tsx` (decision
column); three existing test files updated to the new rule.

**Deleted** — `src/components/admin/evaluations-client.tsx`, which became
unreachable when `/admin/evaluations` moved to the approval console. Its
capabilities are a strict subset of the replacement. `getAdminEvaluationsAction`
was **kept** (still tested, still authorized).

---

## 8. Bugs found during implementation

**BUG-ROLE-01 (build-breaking).** `'use server'` files may only export async
functions; `creator-report-actions.ts` exported constant arrays. The test suite
passed — vitest does not enforce the Next.js contract — and only `npm run build`
caught it. Constants moved to `src/lib/reports/constants.ts`.

---

## 9. Verification

| Check                  | Result                                       |
| ---------------------- | -------------------------------------------- |
| `npm run typecheck`    | **PASS**                                     |
| `npm run lint`         | **PASS**                                     |
| `npm run format:check` | **PASS**                                     |
| `npm test`             | **PASS** — 480/480 across 19 files (was 421) |
| `npm run build`        | **PASS**                                     |
| `npm run check:no-cdn` | **PASS**                                     |
| `npm run verify`       | **PASS** — exit 0                            |
| `npm audit`            | **PASS** — 0 vulnerabilities                 |
| `npm run db:doctor`    | **PASS** — 0 blocking                        |
| `git diff --check`     | **PASS**                                     |
| Browser testing        | **NOT PERFORMED**                            |

### What the 31 new tests prove

Leaderboard gate — pending contributes 0; approval publishes exactly the
evaluator's score; rejection withholds it and records the reason; resubmission
returns to pending and clears the stale decision; multi-level totals sum only
approved; approved is terminal; two simultaneous admin decisions yield one.

Evaluator association — the evaluator who scored remains attached to the
evaluation through submission, rejection, resubmission and approval; the Admin
queue surfaces team, level, evaluator, score, evaluation status, approval status
and timestamp.

Separation of duties — evaluator cannot approve own; another evaluator cannot
approve; Creator cannot approve; participant cannot approve or read the queue;
unauthenticated cannot approve; blocked Admin cannot approve.

Level 1 — start and save both refused, no evaluation row created; Levels 2 and 3
accepted.

Credential recovery — old password stops working, new one works; sessions
revoked; **temporary password absent from every audit row**; squad join code
absent from the reset audit entry; Creator accounts refused; Admin/Evaluator/
Participant all denied and the original credential untouched.

Reports — Admin can raise; Creator receives; subject and description validated;
participants and evaluators denied.

---

## 10. Remaining risks

| Risk                         | Severity   | Detail                                                                                                                                           |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-event isolation        | **MEDIUM** | Untestable — single-event platform. See §1.1.                                                                                                    |
| No browser verification      | **MEDIUM** | Every UI change here is code- and type-verified only. The approval console, recovery flow and report composer have **not been clicked through**. |
| Admin portal toggle unlinked | LOW        | Deliberate, per spec. Page and action intact; Creator retains control.                                                                           |
| Announcement double-click    | LOW        | Pre-existing; no idempotency key.                                                                                                                |

**Not risks — deliberate product decisions:**

- **Evaluator-to-team assignment** is not a requirement. The workflow is
  Team → Evaluation → Evaluator, with the evaluator captured on the evaluation
  record. No assignment model exists and none should be added. See §1.2.
- **Level 3 participant content** is intentional future work. The Level 3
  evaluation infrastructure is in place and ready for when that content is
  built; no Level 3 participant content has been invented.

**Honest summary.** The approval gate, Level 1 exclusion, evaluator-identity
persistence, credential recovery and reporting are **TEST VERIFIED** at the
database level. The portal removals and the permission matrix are **CODE
VERIFIED**. Nothing has been exercised in a browser.
