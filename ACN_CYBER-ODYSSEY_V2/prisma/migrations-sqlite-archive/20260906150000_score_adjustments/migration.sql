-- Additional points // score adjustments requested by evaluators and approved by admins.
--
-- ADDITIVE ONLY.
-- Does not modify existing submissions, evaluations, or base scoring.
-- PENDING and REJECTED adjustments contribute zero points.
-- Only APPROVED adjustments contribute to official scores and leaderboard.

CREATE TABLE "ScoreAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScoreAdjustment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreAdjustment_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreAdjustment_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ScoreAdjustment_teamId_idx" ON "ScoreAdjustment"("teamId");
CREATE INDEX "ScoreAdjustment_level_idx" ON "ScoreAdjustment"("level");
CREATE INDEX "ScoreAdjustment_status_idx" ON "ScoreAdjustment"("status");
CREATE INDEX "ScoreAdjustment_requestedByUserId_idx" ON "ScoreAdjustment"("requestedByUserId");
CREATE INDEX "ScoreAdjustment_reviewedByUserId_idx" ON "ScoreAdjustment"("reviewedByUserId");
CREATE INDEX "ScoreAdjustment_createdAt_idx" ON "ScoreAdjustment"("createdAt");
CREATE INDEX "ScoreAdjustment_teamId_level_status_idx" ON "ScoreAdjustment"("teamId", "level", "status");
CREATE INDEX "ScoreAdjustment_status_createdAt_idx" ON "ScoreAdjustment"("status", "createdAt");
