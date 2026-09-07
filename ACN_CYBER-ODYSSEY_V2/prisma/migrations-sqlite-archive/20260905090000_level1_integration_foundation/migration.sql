-- Phase 1 — Portal <-> Level 1 integration foundation.
--
-- ADDITIVE ONLY. No column is dropped, no type is narrowed, no existing table is
-- recreated. The one statement that touches existing rows is the Team.externalRef
-- backfill at the end, which only ever fills in NULLs and is safe to re-run.
--
-- Team.externalRef and its unique index already exist (added by
-- 20260904090000_level3_orion_integration for the ORION bridge). Level 1 reuses
-- that one reference rather than introducing a second per-level identity.

-- ---------------------------------------------------------------------------
-- Level 1 challenge catalogue. The portal's own authority on what a solve is
-- worth; the Level 1 application never sends a point value.
-- ---------------------------------------------------------------------------
CREATE TABLE "Level1Challenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "track" TEXT NOT NULL DEFAULT 'A',
    "points" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Level1Challenge_code_key" ON "Level1Challenge"("code");
CREATE UNIQUE INDEX "Level1Challenge_externalRef_key" ON "Level1Challenge"("externalRef");
CREATE INDEX "Level1Challenge_isActive_idx" ON "Level1Challenge"("isActive");
CREATE INDEX "Level1Challenge_track_sortOrder_idx" ON "Level1Challenge"("track", "sortOrder");

-- ---------------------------------------------------------------------------
-- Verified solves. The unique index is the anti-double-scoring mechanism: a
-- redelivered or concurrent duplicate collides here rather than awarding twice.
-- ---------------------------------------------------------------------------
CREATE TABLE "Level1Result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "awardedPoints" INTEGER NOT NULL,
    "solvedAt" DATETIME,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Level1Result_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level1Result_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Level1Challenge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Level1Result_teamId_challengeId_key" ON "Level1Result"("teamId", "challengeId");
CREATE INDEX "Level1Result_teamId_idx" ON "Level1Result"("teamId");
CREATE INDEX "Level1Result_challengeId_idx" ON "Level1Result"("challengeId");

-- ---------------------------------------------------------------------------
-- Hint deductions. Separate from the award so a hint bought on an unsolved
-- question still costs, and so the reason a score changed stays on the record.
-- ---------------------------------------------------------------------------
CREATE TABLE "Level1Penalty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "hintNumber" INTEGER NOT NULL DEFAULT 1,
    "points" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Level1Penalty_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level1Penalty_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Level1Challenge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Level1Penalty_teamId_challengeId_hintNumber_key" ON "Level1Penalty"("teamId", "challengeId", "hintNumber");
CREATE INDEX "Level1Penalty_teamId_idx" ON "Level1Penalty"("teamId");
CREATE INDEX "Level1Penalty_challengeId_idx" ON "Level1Penalty"("challengeId");

-- ---------------------------------------------------------------------------
-- One-time access tickets. Only the SHA-256 of the ticket is stored, so a
-- database read never yields a redeemable value.
-- ---------------------------------------------------------------------------
CREATE TABLE "IntegrationTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "issuedToUserId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "redeemedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationTicket_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "IntegrationTicket_tokenHash_key" ON "IntegrationTicket"("tokenHash");
CREATE INDEX "IntegrationTicket_expiresAt_idx" ON "IntegrationTicket"("expiresAt");
CREATE INDEX "IntegrationTicket_teamId_level_idx" ON "IntegrationTicket"("teamId", "level");

-- ---------------------------------------------------------------------------
-- BACKFILL — existing squads get an external reference.
--
-- 128 bits from SQLite's CSPRNG-backed randomblob(), hex-encoded, with a source
-- prefix so the value is self-identifying in logs on both sides of the bridge.
-- NOT derived from the team id, name or join code: a reference computed from the
-- private join code would leak it, and one computed from the name would change
-- when a squad is renamed.
--
-- Only fills NULLs, so it is safe to re-run and cannot disturb a squad that
-- already has a reference. The unique index above catches the (vanishingly
-- unlikely) collision by failing the migration rather than silently colliding.
-- ---------------------------------------------------------------------------
UPDATE "Team"
   SET "externalRef" = 'co_' || lower(hex(randomblob(16)))
 WHERE "externalRef" IS NULL;
