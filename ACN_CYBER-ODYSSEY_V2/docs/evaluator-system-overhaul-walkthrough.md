# Walkthrough — Dynamic Evaluator System Overhaul

## Overview

The ACN Cyber Odyssey V2 evaluation engine has been completely overhauled from a rigid, hardcoded 100-point rubric into a production-ready, database-driven, 1000-point dynamic evaluation system with strict concurrency controls and an Admin approval workflow.

---

## Key Accomplishments

### 1. Database Schema & Architecture (`prisma/schema.prisma`)

- **`EvaluationCriterion` model**:
  - `id`: CUID identifier
  - `levelNumber`: `Int` (supports Level 2 Forensics and Level 3 Incident Report)
  - `title`, `description`, `guidance` (evaluator benchmark notes)
  - `maxPoints`: `Int` (configurable per criterion)
  - `sortOrder`: `Int`
  - `isActive`: `Boolean` (deactivating excludes from dynamic max score without breaking past submissions)
  - `required`: `Boolean`
  - `timestamps`
- **`EvaluationScore` model**:
  - `evaluationId`: Foreign key to `Evaluation`
  - `criterionId`: Foreign key to `EvaluationCriterion`
  - `awardedScore`: `Int` (strictly bounded $0 \le \text{awardedScore} \le \text{criterion.maxPoints}$)
  - `notes`: `String?` (criterion-specific evaluator feedback)
  - Unique composite index: `@@unique([evaluationId, criterionId])`
- **`Evaluation` updates**:
  - `maxScore`: Now stored dynamically based on the active criteria sum.
  - Linked `scores: EvaluationScore[]` with cascade delete.
  - Retained optimistic locking version counter `version: Int @default(1)`.

### 2. Seed Data Updates (`prisma/seed.ts`)

- Seeded Level 2 Forensic Criteria (4 criteria @ 250 pts = 1000 pts total):
  1. Intrusion Vector Identification & Initial Access Triage (250 pts)
  2. Payload Deobfuscation & Decrypted Artifact Verification (250 pts)
  3. Adversary Persistence Mechanism & Lateral Movement Tracking (250 pts)
  4. Chain of Custody & Forensics Investigation Report Quality (250 pts)
- Seeded Level 3 Incident Report Criteria (4 criteria @ 250 pts = 1000 pts total):
  1. Executive Summary & Business Impact Communication (250 pts)
  2. Technical Root Cause & Exploited Web Flaw Analysis (250 pts)
  3. Remediation Architecture, Patching & Hardening Roadmap (250 pts)
  4. Actionable Threat Intelligence & Detection Engineering / Sigma Rules (250 pts)

### 3. Server Actions Overhaul

- **`src/lib/actions/evaluator-actions.ts`**:
  - `getEvaluatorSubmissionDetailsAction`:
    - Queries active `EvaluationCriterion` for `submission.level`.
    - Dynamically computes `maxPossibleScore = sum(criterion.maxPoints)`.
    - Loads existing `EvaluationScore` records or initializes criteria items.
    - Resolves submitter and squad roster display names securely.
  - `saveEvaluationAction`:
    - Validates awarded marks for each criterion ($0 \le \text{marks} \le \text{maxPoints}$).
    - Calculates total score server-side; ensures total does not exceed dynamic level max.
    - Uses optimistic locking (`version` predicate in database write) to prevent silent overwrites.
    - Upserts normalized records into `tx.evaluationScore`.
    - Updates `Evaluation.score`, `Evaluation.maxScore`, and increments `version`.
    - Strict approval gate: Sets `approvalStatus: 'PENDING_APPROVAL'`.
    - Calls `recomputeTeamScore`: Isolates pending/draft evaluations from `Team.score` so unapproved scores never touch the official leaderboard.
  - `getEvaluatorSubmissionsAction`:
    - Selects dynamic `maxScore` along with `score`.
- **`src/lib/actions/evaluation-criteria-actions.ts`**:
  - `getEvaluationCriteriaAction`: Fetches active criteria and dynamic max score for a level.
  - `getAllEvaluationCriteriaAction`: Admin/Creator grouped view across levels.
  - `createEvaluationCriterionAction`: Admin/Creator creation with audit logging.
  - `updateEvaluationCriterionAction`: Admin/Creator live edits to title, description, maxPoints, guidance, active status.
  - `deleteEvaluationCriterionAction`: Smart deletion (soft-deactivates if scores exist, hard deletes if unused).

### 4. Evaluator Workspace Overhaul (`src/components/evaluator/`)

- **`evaluation-panel.tsx`**:
  - Removed legacy structured answer inputs (`Attacker`, `Proof`, etc.).
  - Replaced with dedicated **Attached Deliverables Inspection** card with secure download links to `/api/evaluator/files/[id]`.
  - Renders criteria dynamically from database configuration: title, description, evaluator guidance banner, awarded marks input, and criterion remarks.
  - Displays dynamic `TOTAL SCORE: {totalScore} / {maxPossibleScore} PTS`.
  - Preserves separate confidential internal jury notes (`notes`) and squad-visible feedback (`feedback`).
  - Graceful optimistic locking conflict detection with reload prompt.
- **`submissions-client.tsx`**:
  - Submissions queue table now displays `{sub.score} / {sub.maxScore} PTS`.

### 5. Admin & Creator Dynamic Criteria Management (`src/components/admin/`)

- Created **`evaluation-criteria-manager.tsx`**:
  - Allows Admins and Creators to view, create, edit, deactivate, and delete criteria for Level 2 and Level 3.
  - Displays live total max score for the selected level.
- Created **`evaluations-hub-client.tsx`** & updated **`src/app/admin/evaluations/page.tsx`**:
  - Provides seamless tab switching between the **Approval Queue** and **Criteria & Rubric Configuration**.

---

## Verification Results

### Automated Test Suite

- **Full Test Suite**: 28 test files, 678 tests — **100% passing**.
  - `tests/dynamic-evaluation.test.ts` (11 tests) — **PASS**
  - `tests/evaluator-portal.test.ts` (23 tests) — **PASS**
  - `tests/phase16-event-concurrency.test.ts` (32 tests) — **PASS**
  - `tests/roles-evaluation-approval.test.ts` (31 tests) — **PASS**
  - `tests/security-hardening-audit.test.ts` (22 tests) — **PASS**

### Code Integrity & Quality Checks

- `npm run typecheck`: **Zero errors** (`tsc --noEmit` clean).
- `npx eslint`: **Zero errors** across all modified and newly created files.
- `npm run check:no-cdn`: **PASS** (zero external CDN or font references).
- `npm run db:doctor`: **PASS** (0 blocking critical/high issues, WAL mode verified).
- `npm run build`: **PASS** (Next.js production build succeeded with 47/47 routes generated).
