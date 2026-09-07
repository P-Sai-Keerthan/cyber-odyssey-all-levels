-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Level3Discovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "discoveredById" TEXT,
    "awardedPoints" INTEGER NOT NULL,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Level3Discovery_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level3Discovery_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Level3Bug" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Level3Discovery_discoveredById_fkey" FOREIGN KEY ("discoveredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Level3Discovery" ("awardedPoints", "bugId", "discoveredAt", "discoveredById", "id", "teamId") SELECT "awardedPoints", "bugId", "discoveredAt", "discoveredById", "id", "teamId" FROM "Level3Discovery";
DROP TABLE "Level3Discovery";
ALTER TABLE "new_Level3Discovery" RENAME TO "Level3Discovery";
CREATE INDEX "Level3Discovery_teamId_idx" ON "Level3Discovery"("teamId");
CREATE INDEX "Level3Discovery_bugId_idx" ON "Level3Discovery"("bugId");
CREATE INDEX "Level3Discovery_discoveredById_idx" ON "Level3Discovery"("discoveredById");
CREATE UNIQUE INDEX "Level3Discovery_teamId_bugId_key" ON "Level3Discovery"("teamId", "bugId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

