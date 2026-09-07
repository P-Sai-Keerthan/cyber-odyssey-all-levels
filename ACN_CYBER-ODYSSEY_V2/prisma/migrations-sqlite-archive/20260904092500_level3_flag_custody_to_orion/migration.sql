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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Level3Bug" ("category", "code", "createdAt", "externalRef", "flagHash", "id", "isActive", "points", "title", "updatedAt") SELECT "category", "code", "createdAt", "externalRef", "flagHash", "id", "isActive", "points", "title", "updatedAt" FROM "Level3Bug";
DROP TABLE "Level3Bug";
ALTER TABLE "new_Level3Bug" RENAME TO "Level3Bug";
CREATE UNIQUE INDEX "Level3Bug_code_key" ON "Level3Bug"("code");
CREATE UNIQUE INDEX "Level3Bug_externalRef_key" ON "Level3Bug"("externalRef");
CREATE INDEX "Level3Bug_isActive_idx" ON "Level3Bug"("isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

