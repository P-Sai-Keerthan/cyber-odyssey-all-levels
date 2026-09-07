# Phase 14 — Security Audit

## Executive Summary

A comprehensive defensive security audit, vulnerability hunt, and code hardening review of the entire **ACN Cyber Odyssey V2** application was conducted. The application is designed to support 100–200 concurrent participants, evaluators, event admins, and creator operations in an offline, high-integrity cyber competition environment.

All architectural layers—including authentication, session management, role-based authorization (RBAC), multi-tenant squad isolation, server action validation, file upload pipelines, magic-byte inspection, streaming downloads, optimistic concurrency control, and audit logging—were systematically audited, hardened, and verified with 199 passing automated tests.

---

## Application Threat Model

The security boundaries protect against the following threat actors and vectors:

1. **Unauthenticated Visitors**: Blocked from all event levels, submissions, leaderboards, admin/evaluator/creator interfaces, and protected APIs.
2. **Standard Participants**: Restricted strictly to their own squad, team submissions, and released level content. Forbidden from inspecting other teams' deliverables, internal evaluator notes, or escalating to Evaluator/Admin/Creator.
3. **Cross-Team Participant Adversaries**: Prevented via transactional boundaries and relational filters (`where: { teamId, id }`) from accessing, modifying, or overwriting another squad's submission or roster.
4. **Malicious Staff / Privilege Escalation**: Admins and Evaluators cannot perform Creator-only actions (such as account deletion, staff approvals, or Level 2 resource mutation).
5. **Session Replay / Hijacking / Stale Sessions**: Sessions for blocked or deleted users are invalidated immediately in the database and purged on access.
6. **File Upload Spoofing & Path Traversal**: Executables, scripts, and spoofed archives disguised with false extensions or headers are rejected via signature/magic-byte inspection and sanitized filenames.
7. **Score / Timer Tampering**: Client-side countdowns and inputs are untrusted; timers and rubric evaluations are strictly server-authoritative and aggregate atomically.

---

## Authentication Audit

- **Password Storage**: Passwords are never stored in plaintext. They are hashed using robust adaptive one-way cryptographic hashing before persisting to the database.
- **Credential Privacy**: Password hashes are never selected or returned in DTOs or server action responses.
- **Brute-Force & Credential Stuffing Defense**:
  - Implemented automatic temporary account lockout (15-minute cool-down) after 10 consecutive failed authentication attempts.
  - Uniform generic error messages (`"Invalid credentials. Please verify your email/username and password."`) prevent username/email enumeration.
- **Account State Verification**:
  - `PENDING_APPROVAL`: Staff accounts awaiting Creator clearance are denied access until explicitly approved.
  - `BLOCKED` / `SUSPENDED` / `REJECTED`: Blocked users are immediately rejected at authentication and their active sessions are purged.
  - `DELETED`: Deleted accounts are removed transactionally; stale session tokens fail lookup.

---

## Authorization / RBAC Audit

Strict server-side role enforcement is maintained across all 4 system tiers:

```
CREATOR (System Authority & Governance)
   ↓
ADMIN (Event Operations & Level Controls)
   ↓
EVALUATOR (Submission Scoring & Feedback)
   ↓
PARTICIPANT (Squad Competition)
```

- **Guard Functions**: `requireAuth()`, `requireParticipant()`, `requireCreator()`, `requireAdmin()`, and `requireEvaluator()` validate active database session and role before serving any route or executing server actions.
- **URL Tampering Protection**: Direct URL manipulation (e.g. `/dashboard` → `/evaluator` or `/creator`) is intercepted and redirected immediately.
- **Server Action Independence**: Every server action independently enforces role verification and session ownership without relying on client-side state or button disabling.

---

## Creator Security

- **Exclusive Capabilities**: Only the `CREATOR` role can approve/reject staff accounts, block/unblock accounts and teams, delete accounts and teams, manage system-wide portal online/offline status, and upload/replace/remove Level 2 resources (`EVIDENCE_PACKAGE`, `SAMPLE_REPORT`).
- **Self-Lockout Protection**: Creator cannot block or delete their own active account.
- **Destructive Operation Safety**: Account and squad deletion are wrapped in atomic database transactions (`prisma.$transaction`) with session purging and structured `AuditLog` records.

---

## Admin Security

- **Operational Scope**: Admins manage level state progression (READY, LIVE, PAUSED, COMPLETED), level timers, announcements, and operational views.
- **Creator Isolation**: Admins are strictly forbidden from Creator control center actions (`blockAccountAction`, `deleteAccountAction`, `approveStaffAction`, resource mutation).
- **Data Protection**: Admins cannot view team join codes, team passwords, or user password hashes.

---

## Evaluator Security

- **Submission Evaluation**: Evaluators can review assigned squad submissions, inspect uploaded deliverables, and award scores within rubric bounds (0–100).
- **Optimistic Concurrency**: Evaluation saves use version-increment locking (`version: { increment: 1 }`) to prevent concurrent evaluation overwrite conflicts.
- **Score Recalculation**: Team total scores are atomically aggregated across evaluated levels inside the transaction boundary.
- **Privacy Boundary**: Evaluator internal notes (`notes`) are reserved for staff and never exposed to participants.

---

## Participant Security

- **Squad Boundary**: Participants can only view their own squad members, submissions, and feedback.
- **IDOR Defense**: All participant queries and mutations require `where: { teamId: user.membership.teamId }`.
- **Level Access**: Enforced server-side via `checkAuthoritativeLevelAccess()`, verifying participant status, squad membership, portal online state, and authoritative level status.

---

## Team Security

- **Join Code Privacy**: Squad joining codes and passwords are required for onboarding and protected from public exposure.
- **Capacity Guarantee**: Maximum capacity of 3 participants per squad is strictly enforced inside concurrency-safe database transactions with pre- and post-condition checks.
- **Disqualification Handling**: Blocked or disqualified squads are barred from submitting deliverables or joining new members.

---

## Level Security

- **Server-Authoritative States**: Level states (`LOCKED`, `READY`, `LIVE`, `PAUSED`, `COMPLETED`) are persisted in the `LevelState` table.
- **No Client Bypasses**: Direct route access to `/event/level-1`, `/event/level-2`, or `/event/level-3` is guarded server-side against unreleased levels.

---

## Timer Security

- **Zero Trust in Client Clock**: All timers derive remaining duration from server timestamps (`startedAt`, `endsAt`, `remainingSeconds`).
- **Submission Deadlines**: Submissions submitted after level expiration are rejected at the server boundary regardless of client clock state.

---

## File Upload Security

- **Extension Allowlist**: Only `.pdf`, `.docx`, `.doc`, `.zip` for submissions; `.zip` for Evidence Package; `.pdf` for Sample Report.
- **Signature & Magic-Byte Validation**:
  - PDF: `%PDF-` signature (`0x25 0x50 0x44 0x46`).
  - ZIP / DOCX: `PK\x03\x04` / `PK\x05\x06` signature.
  - DOC: OLE Compound Binary signature (`0xD0 0xCF 0x11 0xE0`).
  - Spoofed executables (`.exe`, `.sh`, `.bat`) renamed to `.pdf` or `.zip` are immediately rejected.
- **Path Traversal Defense**: All filenames pass through `sanitizeResourceFilename()` / `path.basename()`, stripping directory traversal (`../`, `..\`), null bytes (`\0`), and illegal filesystem characters.
- **Storage Isolation**: Files are stored with cryptographically random UUID tokens inside `uploads/` with no direct web-root execution capability.

---

## API Security

- **Endpoint Protection**: All API routes (`/api/evaluator/files/[id]`, `/api/event/level-2/evidence`, `/api/event/level-2/sample-report`) require authenticated sessions and verify role authorization before streaming files.
- **Audit Logging**: Successful deliverable access generates `FILE_ACCESSED` audit entries.

---

## Server Action Security

- Every server action in `auth-actions.ts`, `team-actions.ts`, `submission-actions.ts`, `evaluator-actions.ts`, `creator-actions.ts`, `admin-actions.ts`, and `creator-resource-actions.ts` independently executes:
  1. Portal online status check.
  2. Session validation via `getSessionUser()`.
  3. Role and account status verification.
  4. Input bounds and schema validation.
  5. Transactional execution with audit logging.

---

## Database Security

- **ORM & Injection Defense**: All database queries use Prisma Client with parameterized SQL queries, eliminating SQL injection vectors.
- **Relational Integrity**: Foreign keys and unique constraints (`@@unique([levelNumber, resourceKey])`, `userId` unique on `TeamMember`) prevent orphan records and duplicate memberships.

---

## Session Security

- **Cookie Flags**:
  - `HttpOnly: true` (prevents JavaScript/XSS session access).
  - `Secure: true` in production environments.
  - `SameSite: 'lax'` (prevents cross-site request forgery).
  - `Path: '/'`.
  - `MaxAge: 7 days`.
- **Session Revocation**: User deletion or status changes (blocking) immediately execute `prisma.session.deleteMany({ where: { userId } })`.

---

## Audit Logging

- **Immutable Trail**: System generates audit logs for all security-critical events:
  - `LOGIN`, `LOGOUT`, `FAILED_LOGIN`
  - `ACCOUNT_BLOCKED`, `ACCOUNT_UNBLOCKED`, `ACCOUNT_DELETED`
  - `STAFF_SIGNUP_REQUESTED`, `STAFF_APPROVED`, `STAFF_REJECTED`
  - `SUBMISSION_SUBMITTED`, `SUBMISSION_REPLACED`, `SUBMISSION_OPENED`
  - `EVALUATION_STARTED`, `EVALUATION_SUBMITTED`, `EVALUATION_RETURNED`, `SCORE_UPDATED`
  - `LEVEL2_RESOURCE_ADDED`, `LEVEL2_RESOURCE_REPLACED`, `LEVEL2_RESOURCE_REMOVED`, `LEVEL2_RESOURCE_UPDATED`
  - `PORTAL_STATUS_CHANGED`, `LEVEL_STATE_CHANGED`
- **Integrity**: Actor ID and Target ID are derived exclusively from the authenticated session and validated database records. Sensitive secrets and passwords are never logged.

---

## Information Disclosure

- **DTO Filtering**: Server actions explicitly map return objects using select projections, ensuring `passwordHash`, internal tokens, or unrelated team identifiers are never sent over the wire.
- **Production Error Masking**: Generic user-friendly error messages are returned in production, avoiding stack trace or internal filesystem path leakage.

---

## XSS / CSRF Review

- **XSS**: Zero occurrences of `dangerouslySetInnerHTML`, `eval()`, or `new Function()`. All user-supplied content (team names, usernames, announcement text) is escaped by React JSX.
- **CSRF**: Server actions execute over POST requests with SameSite session cookies and origin verification.

---

## Rate Limiting & Abuse Prevention

- **Brute-Force Lockout**: 10 failed login attempts triggers a 15-minute account lockout window.
- **Duplicate Submission Lock**: Submissions in `SUBMITTED`, `UNDER_REVIEW`, or `ACCEPTED` status are locked against concurrent multi-tab resubmissions.

---

## Dependency Security

- `npm audit` returned **0 vulnerabilities** across all direct and transitive dependencies.

---

## Security Headers

Applied globally via `next.config.ts`:

- `Content-Security-Policy`: Self-contained policy forbidding third-party scripts, styles, and CDNs.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

---

## Environment & Secrets Review

- Verified `.env` and `.env.example` configurations. No hardcoded production credentials, private keys, or API tokens exist in version control.

---

## Vulnerabilities Found & Fixed

### SEC-01: File Signature & Magic-Byte Validation Missing in Deliverables

- **Severity**: HIGH
- **Component**: `src/lib/storage/submission-storage.ts`
- **Root Cause**: Upload validation relied solely on client-reported MIME type and filename extension.
- **Impact**: Attackers could disguise executable scripts or binaries as `.pdf` or `.docx`.
- **Fix Applied**: Added `validateSubmissionMagicBytes()` inspecting raw file header bytes (`%PDF`, `PK\x03\x04`, OLE Compound headers).
- **Regression Test**: `tests/security-hardening-audit.test.ts` ("File Upload Security & Magic Byte Validation").

### SEC-02: File Signature & Magic-Byte Validation Missing in Creator Level Resources

- **Severity**: HIGH
- **Component**: `src/lib/event/level-resources.ts`
- **Root Cause**: Resource management allowed file uploads based on extension without verifying binary file headers.
- **Impact**: Potential upload of non-archive files as Evidence Package or non-PDF as Sample Report.
- **Fix Applied**: Implemented `validateLevelResourceMagicBytes()` enforcing `%PDF` for Sample Reports and `PK\x03\x04` for Evidence ZIP packages.
- **Regression Test**: `tests/security-hardening-audit.test.ts` ("prevents non-Creators from managing Level 2 resources").

### SEC-03: Lack of Automated Account Lockout on Failed Login Attempts

- **Severity**: MEDIUM
- **Component**: `src/lib/actions/auth-actions.ts`
- **Root Cause**: `failedLoginCount` was tracked but did not trigger an automated lockout delay.
- **Impact**: Vulnerable to sustained brute-force credential attacks.
- **Fix Applied**: Added automatic 15-minute account lockout when `failedLoginCount >= 10`.
- **Regression Test**: `tests/security-hardening-audit.test.ts` ("locks account after 10 consecutive failed login attempts").

---

## Remaining Risks

- **Network-Level Layer 7 DDoS**: Application-level rate limiting protects login actions; for full network volumetric DDoS mitigation at 100–200 concurrent users, the host reverse proxy (e.g. Nginx or Cloudflare) should enforce IP-level connection rate limiting.

---

## Verification Results

| Check                         | Tool / Command                  | Result                                              |
| ----------------------------- | ------------------------------- | --------------------------------------------------- |
| **TypeScript Typecheck**      | `tsc --noEmit`                  | **PASS (0 errors)**                                 |
| **ESLint**                    | `eslint .`                      | **PASS (0 errors, 0 warnings)**                     |
| **Prettier Formatting**       | `prettier --check .`            | **PASS (100% formatted)**                           |
| **Automated Tests**           | `vitest run`                    | **PASS (11 test suites, 199 tests)**                |
| **Next.js Production Build**  | `next build`                    | **PASS (42 routes compiled)**                       |
| **Offline Zero-CDN Check**    | `node scripts/check-no-cdn.mjs` | **PASS (604 files scanned, 0 external references)** |
| **Dependency Security Audit** | `npm audit`                     | **PASS (0 vulnerabilities found)**                  |
| **Git Diff Cleanliness**      | `git diff --check`              | **PASS (clean whitespace & diffs)**                 |
