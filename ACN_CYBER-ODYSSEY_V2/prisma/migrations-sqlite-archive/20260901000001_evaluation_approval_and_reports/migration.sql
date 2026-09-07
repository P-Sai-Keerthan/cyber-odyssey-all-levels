-- =============================================================================
-- Roles phase / EVAL-01 — Admin approval gate on evaluations, and Admin→Creator
-- issue reports.
-- =============================================================================
--
-- BACKFILL DECISION (important — read before applying to a live database)
-- -----------------------------------------------------------------------
-- Adding `approvalStatus` with the column default `NOT_SUBMITTED` would make
-- every evaluation that has ALREADY been completed and scored disappear from the
-- leaderboard the moment this migration lands, because the leaderboard now sums
-- only APPROVED evaluations. Squads would watch their points vanish.
--
-- Evaluations already in status 'EVALUATED' represent work an evaluator finished
-- under the previous rules, where finishing WAS publication. They are therefore
-- backfilled to 'APPROVED' so the leaderboard is unchanged by this deployment.
-- `approvedAt` is set to the evaluation's own submittedAt/updatedAt so the audit
-- trail stays truthful about when the score became official; `approvedById` is
-- left NULL because no Admin actually approved them — a NULL approver is honest,
-- a fabricated one is not.
--
-- Everything else (drafts, in-review, returned) becomes NOT_SUBMITTED and must go
-- through the new Evaluator → Admin flow.
--
-- Safe to run against a populated database. Non-destructive.
-- =============================================================================

-- AlterTable: Evaluation approval gate
ALTER TABLE "Evaluation" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE "Evaluation" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "Evaluation" ADD COLUMN "rejectedById" TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "rejectedAt" DATETIME;
ALTER TABLE "Evaluation" ADD COLUMN "rejectionReason" TEXT;

-- Backfill: preserve the leaderboard for work already completed and scored.
UPDATE "Evaluation"
SET "approvalStatus" = 'APPROVED',
    "approvedAt" = COALESCE("submittedAt", "updatedAt")
WHERE "status" = 'EVALUATED';

-- CreateIndex
CREATE INDEX "Evaluation_teamId_approvalStatus_idx" ON "Evaluation"("teamId", "approvalStatus");
CREATE INDEX "Evaluation_approvalStatus_submittedAt_idx" ON "Evaluation"("approvalStatus", "submittedAt");

-- CreateTable: Admin → Creator issue reports
CREATE TABLE "CreatorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT NOT NULL,
    "teamId" TEXT,
    "targetUserId" TEXT,
    "issueType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreatorReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreatorReport_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CreatorReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CreatorReport_status_createdAt_idx" ON "CreatorReport"("status", "createdAt");
CREATE INDEX "CreatorReport_authorId_idx" ON "CreatorReport"("authorId");
CREATE INDEX "CreatorReport_teamId_idx" ON "CreatorReport"("teamId");

-- Recompute every squad score from APPROVED evaluations only, so Team.score and
-- the new approval gate agree from the first request after deployment.
UPDATE "Team"
SET "score" = COALESCE(
    (SELECT SUM("score") FROM "Evaluation"
     WHERE "Evaluation"."teamId" = "Team"."id"
       AND "Evaluation"."approvalStatus" = 'APPROVED'),
    0
);
