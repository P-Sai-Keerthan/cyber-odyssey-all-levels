-- CreateTable
CREATE TABLE "Level3Bug" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'WEB',
    "points" INTEGER NOT NULL DEFAULT 0,
    "flagHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Level3Discovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "discoveredById" TEXT NOT NULL,
    "awardedPoints" INTEGER NOT NULL,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Level3Discovery_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level3Discovery_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Level3Bug" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level3Discovery_discoveredById_fkey" FOREIGN KEY ("discoveredById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Level3Bug_code_key" ON "Level3Bug"("code");

-- CreateIndex
CREATE INDEX "Level3Bug_isActive_idx" ON "Level3Bug"("isActive");

-- CreateIndex
CREATE INDEX "Level3Discovery_teamId_idx" ON "Level3Discovery"("teamId");

-- CreateIndex
CREATE INDEX "Level3Discovery_bugId_idx" ON "Level3Discovery"("bugId");

-- CreateIndex
CREATE INDEX "Level3Discovery_discoveredById_idx" ON "Level3Discovery"("discoveredById");

-- CreateIndex
CREATE UNIQUE INDEX "Level3Discovery_teamId_bugId_key" ON "Level3Discovery"("teamId", "bugId");
