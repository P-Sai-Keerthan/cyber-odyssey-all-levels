-- AlterTable
ALTER TABLE "Level3Bug" ADD COLUMN "externalRef" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN "externalRef" TEXT;

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ORION',
    "externalTeamRef" TEXT NOT NULL,
    "externalBugRef" TEXT,
    "outcome" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_eventId_key" ON "IntegrationEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_nonce_key" ON "IntegrationEvent"("nonce");

-- CreateIndex
CREATE INDEX "IntegrationEvent_receivedAt_idx" ON "IntegrationEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_outcome_idx" ON "IntegrationEvent"("outcome");

-- CreateIndex
CREATE INDEX "IntegrationEvent_externalTeamRef_idx" ON "IntegrationEvent"("externalTeamRef");

-- CreateIndex
CREATE UNIQUE INDEX "Level3Bug_externalRef_key" ON "Level3Bug"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Team_externalRef_key" ON "Team"("externalRef");

