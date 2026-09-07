-- CreateTable
CREATE TABLE "Level3Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "challengeUrl" TEXT,
    "challengeLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Level3Hint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bugId" TEXT NOT NULL,
    "hintNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Level3Hint_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Level3Bug" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Level3Penalty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "hintNumber" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "unlockedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Level3Penalty_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level3Penalty_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Level3Bug" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level3Penalty_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Level3Bug" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "externalRef" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'WEB',
    "points" INTEGER NOT NULL DEFAULT 0,
    "flagHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stationId" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'EASY',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Level3Bug_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Level3Station" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Level3Bug" ("category", "code", "createdAt", "externalRef", "flagHash", "id", "isActive", "points", "title", "updatedAt") SELECT "category", "code", "createdAt", "externalRef", "flagHash", "id", "isActive", "points", "title", "updatedAt" FROM "Level3Bug";
DROP TABLE "Level3Bug";
ALTER TABLE "new_Level3Bug" RENAME TO "Level3Bug";
CREATE UNIQUE INDEX "Level3Bug_code_key" ON "Level3Bug"("code");
CREATE UNIQUE INDEX "Level3Bug_externalRef_key" ON "Level3Bug"("externalRef");
CREATE INDEX "Level3Bug_isActive_idx" ON "Level3Bug"("isActive");
CREATE INDEX "Level3Bug_stationId_sortOrder_idx" ON "Level3Bug"("stationId", "sortOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Level3Station_isActive_sortOrder_idx" ON "Level3Station"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Level3Hint_bugId_idx" ON "Level3Hint"("bugId");

-- CreateIndex
CREATE UNIQUE INDEX "Level3Hint_bugId_hintNumber_key" ON "Level3Hint"("bugId", "hintNumber");

-- CreateIndex
CREATE INDEX "Level3Penalty_teamId_idx" ON "Level3Penalty"("teamId");

-- CreateIndex
CREATE INDEX "Level3Penalty_bugId_idx" ON "Level3Penalty"("bugId");

-- CreateIndex
CREATE UNIQUE INDEX "Level3Penalty_teamId_bugId_hintNumber_key" ON "Level3Penalty"("teamId", "bugId", "hintNumber");

