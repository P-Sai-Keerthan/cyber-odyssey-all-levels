-- Captures schema changes that were applied to a developer database but never
-- recorded as a migration.
--
-- HOW THIS WAS FOUND
-- ------------------
-- Building the Docker image and starting the stack against an EMPTY volume runs
-- `prisma migrate deploy` — the same thing a real deployment does. The Portal
-- then 500'd on its first request:
--
--   Invalid `prisma.levelState.findUnique()` invocation:
--   The column `main.LevelState.maxScore` does not exist in the current database.
--
-- The schema declared `LevelState.maxScore`, `EvaluationCriterion`,
-- `EvaluationScore` and several `Evaluation` columns, and the local dev database
-- had them (applied with `db push` or by hand), but no migration created any of
-- them. Every existing developer machine worked; a fresh deployment could not
-- start. The event page, Level 1 score ingestion and Level 2 evidence all read
-- LevelState, so this would have been total on day one.
--
-- Generated with `prisma migrate diff --from-migrations --to-schema-datamodel`,
-- so it is exactly the delta between the recorded migration history and the
-- schema, with no hand-written guesswork.
-- CreateTable
CREATE TABLE "EvaluationCriterion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "levelNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "maxPoints" INTEGER NOT NULL DEFAULT 250,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "guidance" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EvaluationScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "awardedScore" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvaluationScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvaluationScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "EvaluationCriterion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Evaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "score" INTEGER NOT NULL DEFAULT 0,
    "maxScore" INTEGER NOT NULL DEFAULT 1000,
    "criteria" TEXT,
    "notes" TEXT,
    "feedback" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "rejectedById" TEXT,
    "rejectedAt" DATETIME,
    "rejectionReason" TEXT,
    "startedAt" DATETIME,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Evaluation_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Evaluation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Evaluation" ("approvalStatus", "approvedAt", "approvedById", "createdAt", "criteria", "evaluatorId", "feedback", "id", "level", "maxScore", "notes", "rejectedAt", "rejectedById", "rejectionReason", "score", "startedAt", "status", "submissionId", "submittedAt", "teamId", "updatedAt", "version") SELECT "approvalStatus", "approvedAt", "approvedById", "createdAt", "criteria", "evaluatorId", "feedback", "id", "level", "maxScore", "notes", "rejectedAt", "rejectedById", "rejectionReason", "score", "startedAt", "status", "submissionId", "submittedAt", "teamId", "updatedAt", "version" FROM "Evaluation";
DROP TABLE "Evaluation";
ALTER TABLE "new_Evaluation" RENAME TO "Evaluation";
CREATE UNIQUE INDEX "Evaluation_submissionId_key" ON "Evaluation"("submissionId");
CREATE INDEX "Evaluation_evaluatorId_idx" ON "Evaluation"("evaluatorId");
CREATE INDEX "Evaluation_teamId_level_idx" ON "Evaluation"("teamId", "level");
CREATE INDEX "Evaluation_status_idx" ON "Evaluation"("status");
CREATE INDEX "Evaluation_teamId_status_idx" ON "Evaluation"("teamId", "status");
CREATE INDEX "Evaluation_status_level_idx" ON "Evaluation"("status", "level");
CREATE INDEX "Evaluation_updatedAt_idx" ON "Evaluation"("updatedAt");
CREATE INDEX "Evaluation_teamId_approvalStatus_idx" ON "Evaluation"("teamId", "approvalStatus");
CREATE INDEX "Evaluation_approvalStatus_submittedAt_idx" ON "Evaluation"("approvalStatus", "submittedAt");
CREATE TABLE "new_LevelState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "levelNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "codename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "maxScore" INTEGER NOT NULL DEFAULT 1000,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "durationSeconds" INTEGER NOT NULL DEFAULT 3600,
    "remainingSeconds" INTEGER NOT NULL DEFAULT 3600,
    "startedAt" DATETIME,
    "pausedAt" DATETIME,
    "endsAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_LevelState" ("codename", "completedAt", "durationMinutes", "durationSeconds", "endsAt", "id", "levelNumber", "name", "pausedAt", "remainingSeconds", "startedAt", "status", "updatedAt") SELECT "codename", "completedAt", "durationMinutes", "durationSeconds", "endsAt", "id", "levelNumber", "name", "pausedAt", "remainingSeconds", "startedAt", "status", "updatedAt" FROM "LevelState";
DROP TABLE "LevelState";
ALTER TABLE "new_LevelState" RENAME TO "LevelState";
CREATE UNIQUE INDEX "LevelState_levelNumber_key" ON "LevelState"("levelNumber");
CREATE INDEX "LevelState_status_idx" ON "LevelState"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EvaluationCriterion_levelNumber_isActive_sortOrder_idx" ON "EvaluationCriterion"("levelNumber", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "EvaluationCriterion_levelNumber_sortOrder_idx" ON "EvaluationCriterion"("levelNumber", "sortOrder");

-- CreateIndex
CREATE INDEX "EvaluationScore_evaluationId_idx" ON "EvaluationScore"("evaluationId");

-- CreateIndex
CREATE INDEX "EvaluationScore_criterionId_idx" ON "EvaluationScore"("criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationScore_evaluationId_criterionId_key" ON "EvaluationScore"("evaluationId", "criterionId");

