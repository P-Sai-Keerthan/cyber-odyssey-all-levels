-- =============================================================================
-- Phase 17 / DB-17-03 — Database-level enforcement of the 3-member team cap.
-- =============================================================================
--
-- Adds TeamMember.slot and a UNIQUE(teamId, slot) index so that team
-- over-capacity becomes impossible at the database level rather than relying on
-- a count-then-insert check inside an application transaction.
--
-- IMPORTANT: the migration Prisma generates for this change backfills every
-- existing row with the column default (slot = 1), which violates the new unique
-- index for any team that already has two or more members. This hand-written
-- version backfills deterministically with ROW_NUMBER() over joinedAt instead,
-- so existing rosters are preserved and renumbered 1..n in join order.
--
-- Safe to run against a populated database.
-- =============================================================================

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill: number each team's existing members 1..n in join order.
INSERT INTO "new_TeamMember" ("id", "teamId", "userId", "slot", "role", "joinedAt")
SELECT
    "id",
    "teamId",
    "userId",
    ROW_NUMBER() OVER (PARTITION BY "teamId" ORDER BY "joinedAt" ASC, "id" ASC) AS "slot",
    "role",
    "joinedAt"
FROM "TeamMember";

DROP TABLE "TeamMember";
ALTER TABLE "new_TeamMember" RENAME TO "TeamMember";

CREATE UNIQUE INDEX "TeamMember_userId_key" ON "TeamMember"("userId");
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");
CREATE UNIQUE INDEX "TeamMember_teamId_slot_key" ON "TeamMember"("teamId", "slot");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
