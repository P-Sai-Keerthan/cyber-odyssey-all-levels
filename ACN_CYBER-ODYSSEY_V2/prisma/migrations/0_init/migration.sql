-- ACN Cyber Odyssey Portal — PostgreSQL baseline.
--
-- WHY THIS REPLACES A 14-STEP HISTORY
-- -----------------------------------
-- The portal ran on SQLite, which admits exactly ONE writer at a time. WAL mode
-- and a raised busy_timeout lifted that ceiling far enough to rehearse on, but
-- 100 squads submitting and being scored inside the same few minutes is a
-- write-concurrency problem SQLite cannot solve — every interactive transaction
-- serialises behind a single lock.
--
-- A Prisma migration directory is provider-specific: migration_lock.toml names
-- the provider, and the previous history is SQLite dialect throughout
-- (PRAGMA defer_foreign_keys, the table-rebuild pattern for altering a column,
-- DATETIME). None of it executes on PostgreSQL. The supported path for a
-- provider switch is a fresh baseline generated from the schema, which is what
-- this file is. The retired history is kept, unedited, in
-- prisma/migrations-sqlite-archive/.
--
-- The data model itself did not change. The schema was already portable — no
-- native column types, no enums, no Json/Bytes/Decimal — so this produces the
-- same 29 models, the same relations, the same unique constraints and the same
-- indexes, expressed in PostgreSQL.
--
-- Generated with `prisma migrate diff --from-empty --to-schema-datamodel`, so it
-- is the schema itself rather than anything hand-written.

-- CreateTable
CREATE TABLE "PreRegisteredParticipant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreRegisteredParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PARTICIPANT',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "lastLogoutAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isOnline" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PortalSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelState" (
    "id" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "codename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "maxScore" INTEGER NOT NULL DEFAULT 1000,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "durationSeconds" INTEGER NOT NULL DEFAULT 3600,
    "remainingSeconds" INTEGER NOT NULL DEFAULT 3600,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "targetAudience" TEXT NOT NULL DEFAULT 'ALL',
    "levelNumber" INTEGER,
    "createdBy" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "announcementId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "answers" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionAttempt" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "answers" TEXT,
    "fileManifest" TEXT NOT NULL DEFAULT '[]',
    "submittedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFile" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
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
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCriterion" (
    "id" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "maxPoints" INTEGER NOT NULL DEFAULT 250,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "guidance" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationScore" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "awardedScore" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorReport" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "teamId" TEXT,
    "targetUserId" TEXT,
    "issueType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelResource" (
    "id" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL DEFAULT 2,
    "resourceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level3Bug" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level3Bug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level3Station" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "challengeUrl" TEXT,
    "challengeLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level3Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level3Hint" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "hintNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level3Hint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level3Penalty" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "hintNumber" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "unlockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Level3Penalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level3Discovery" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "discoveredById" TEXT,
    "awardedPoints" INTEGER NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Level3Discovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level1Challenge" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "track" TEXT NOT NULL DEFAULT 'A',
    "points" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level1Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level1Result" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "awardedPoints" INTEGER NOT NULL,
    "solvedAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Level1Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level1Penalty" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "hintNumber" INTEGER NOT NULL DEFAULT 1,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Level1Penalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "issuedToUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ORION',
    "externalTeamRef" TEXT NOT NULL,
    "externalBugRef" TEXT,
    "outcome" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreAdjustment" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreRegisteredParticipant_email_key" ON "PreRegisteredParticipant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Team_externalRef_key" ON "Team"("externalRef");

-- CreateIndex
CREATE INDEX "Team_score_updatedAt_idx" ON "Team"("score", "updatedAt");

-- CreateIndex
CREATE INDEX "Team_status_score_idx" ON "Team"("status", "score");

-- CreateIndex
CREATE INDEX "Team_createdAt_idx" ON "Team"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_key" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_slot_key" ON "TeamMember"("teamId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_idx" ON "AuditLog"("targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LevelState_levelNumber_key" ON "LevelState"("levelNumber");

-- CreateIndex
CREATE INDEX "LevelState_status_idx" ON "LevelState"("status");

-- CreateIndex
CREATE INDEX "Announcement_published_createdAt_idx" ON "Announcement"("published", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_targetAudience_idx" ON "Announcement"("targetAudience");

-- CreateIndex
CREATE INDEX "Announcement_published_targetAudience_createdAt_idx" ON "Announcement"("published", "targetAudience", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_announcementId_idx" ON "Notification"("announcementId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_userId_idx" ON "Submission"("userId");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

-- CreateIndex
CREATE INDEX "Submission_level_status_idx" ON "Submission"("level", "status");

-- CreateIndex
CREATE INDEX "Submission_submittedAt_idx" ON "Submission"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_teamId_level_key" ON "Submission"("teamId", "level");

-- CreateIndex
CREATE INDEX "SubmissionAttempt_teamId_level_idx" ON "SubmissionAttempt"("teamId", "level");

-- CreateIndex
CREATE INDEX "SubmissionAttempt_submissionId_createdAt_idx" ON "SubmissionAttempt"("submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAttempt_submissionId_attemptNumber_key" ON "SubmissionAttempt"("submissionId", "attemptNumber");

-- CreateIndex
CREATE INDEX "SubmissionFile_submissionId_idx" ON "SubmissionFile"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_submissionId_key" ON "Evaluation"("submissionId");

-- CreateIndex
CREATE INDEX "Evaluation_evaluatorId_idx" ON "Evaluation"("evaluatorId");

-- CreateIndex
CREATE INDEX "Evaluation_teamId_level_idx" ON "Evaluation"("teamId", "level");

-- CreateIndex
CREATE INDEX "Evaluation_status_idx" ON "Evaluation"("status");

-- CreateIndex
CREATE INDEX "Evaluation_teamId_status_idx" ON "Evaluation"("teamId", "status");

-- CreateIndex
CREATE INDEX "Evaluation_status_level_idx" ON "Evaluation"("status", "level");

-- CreateIndex
CREATE INDEX "Evaluation_updatedAt_idx" ON "Evaluation"("updatedAt");

-- CreateIndex
CREATE INDEX "Evaluation_teamId_approvalStatus_idx" ON "Evaluation"("teamId", "approvalStatus");

-- CreateIndex
CREATE INDEX "Evaluation_approvalStatus_submittedAt_idx" ON "Evaluation"("approvalStatus", "submittedAt");

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

-- CreateIndex
CREATE INDEX "CreatorReport_status_createdAt_idx" ON "CreatorReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CreatorReport_authorId_idx" ON "CreatorReport"("authorId");

-- CreateIndex
CREATE INDEX "CreatorReport_teamId_idx" ON "CreatorReport"("teamId");

-- CreateIndex
CREATE INDEX "LevelResource_levelNumber_isPublished_idx" ON "LevelResource"("levelNumber", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "LevelResource_levelNumber_resourceKey_key" ON "LevelResource"("levelNumber", "resourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Level3Bug_code_key" ON "Level3Bug"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Level3Bug_externalRef_key" ON "Level3Bug"("externalRef");

-- CreateIndex
CREATE INDEX "Level3Bug_isActive_idx" ON "Level3Bug"("isActive");

-- CreateIndex
CREATE INDEX "Level3Bug_stationId_sortOrder_idx" ON "Level3Bug"("stationId", "sortOrder");

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

-- CreateIndex
CREATE INDEX "Level3Discovery_teamId_idx" ON "Level3Discovery"("teamId");

-- CreateIndex
CREATE INDEX "Level3Discovery_bugId_idx" ON "Level3Discovery"("bugId");

-- CreateIndex
CREATE INDEX "Level3Discovery_discoveredById_idx" ON "Level3Discovery"("discoveredById");

-- CreateIndex
CREATE UNIQUE INDEX "Level3Discovery_teamId_bugId_key" ON "Level3Discovery"("teamId", "bugId");

-- CreateIndex
CREATE UNIQUE INDEX "Level1Challenge_code_key" ON "Level1Challenge"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Level1Challenge_externalRef_key" ON "Level1Challenge"("externalRef");

-- CreateIndex
CREATE INDEX "Level1Challenge_isActive_idx" ON "Level1Challenge"("isActive");

-- CreateIndex
CREATE INDEX "Level1Challenge_track_sortOrder_idx" ON "Level1Challenge"("track", "sortOrder");

-- CreateIndex
CREATE INDEX "Level1Result_teamId_idx" ON "Level1Result"("teamId");

-- CreateIndex
CREATE INDEX "Level1Result_challengeId_idx" ON "Level1Result"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "Level1Result_teamId_challengeId_key" ON "Level1Result"("teamId", "challengeId");

-- CreateIndex
CREATE INDEX "Level1Penalty_teamId_idx" ON "Level1Penalty"("teamId");

-- CreateIndex
CREATE INDEX "Level1Penalty_challengeId_idx" ON "Level1Penalty"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "Level1Penalty_teamId_challengeId_hintNumber_key" ON "Level1Penalty"("teamId", "challengeId", "hintNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationTicket_tokenHash_key" ON "IntegrationTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "IntegrationTicket_expiresAt_idx" ON "IntegrationTicket"("expiresAt");

-- CreateIndex
CREATE INDEX "IntegrationTicket_teamId_level_idx" ON "IntegrationTicket"("teamId", "level");

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
CREATE INDEX "ScoreAdjustment_teamId_idx" ON "ScoreAdjustment"("teamId");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_level_idx" ON "ScoreAdjustment"("level");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_status_idx" ON "ScoreAdjustment"("status");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_requestedByUserId_idx" ON "ScoreAdjustment"("requestedByUserId");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_reviewedByUserId_idx" ON "ScoreAdjustment"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_createdAt_idx" ON "ScoreAdjustment"("createdAt");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_teamId_level_status_idx" ON "ScoreAdjustment"("teamId", "level", "status");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_status_createdAt_idx" ON "ScoreAdjustment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationScore" ADD CONSTRAINT "EvaluationScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationScore" ADD CONSTRAINT "EvaluationScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "EvaluationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReport" ADD CONSTRAINT "CreatorReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReport" ADD CONSTRAINT "CreatorReport_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReport" ADD CONSTRAINT "CreatorReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Bug" ADD CONSTRAINT "Level3Bug_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Level3Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Hint" ADD CONSTRAINT "Level3Hint_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Level3Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Penalty" ADD CONSTRAINT "Level3Penalty_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Penalty" ADD CONSTRAINT "Level3Penalty_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Level3Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Penalty" ADD CONSTRAINT "Level3Penalty_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Discovery" ADD CONSTRAINT "Level3Discovery_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Discovery" ADD CONSTRAINT "Level3Discovery_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Level3Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level3Discovery" ADD CONSTRAINT "Level3Discovery_discoveredById_fkey" FOREIGN KEY ("discoveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level1Result" ADD CONSTRAINT "Level1Result_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level1Result" ADD CONSTRAINT "Level1Result_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Level1Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level1Penalty" ADD CONSTRAINT "Level1Penalty_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level1Penalty" ADD CONSTRAINT "Level1Penalty_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Level1Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationTicket" ADD CONSTRAINT "IntegrationTicket_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAdjustment" ADD CONSTRAINT "ScoreAdjustment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAdjustment" ADD CONSTRAINT "ScoreAdjustment_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAdjustment" ADD CONSTRAINT "ScoreAdjustment_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

