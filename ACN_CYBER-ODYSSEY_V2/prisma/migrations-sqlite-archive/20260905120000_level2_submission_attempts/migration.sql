-- Level 2 rebuild — submission attempt history.
--
-- ADDITIVE ONLY. Nothing is dropped, nothing is recreated, no existing row is
-- rewritten except to give it the default attempt count it already implies.
--
-- Submission stays the single current submission per (team, level): the unique
-- index on (teamId, level) is untouched, and every consumer of it — the
-- evaluator queue, the approval workflow, the leaderboard aggregation — keeps
-- reading exactly the row it read before. SubmissionAttempt is an append-only
-- trail beside it, so a replaced report leaves evidence that the earlier one
-- existed.

-- ---------------------------------------------------------------------------
-- Submission.attemptCount
--
-- Backfilled to 1 rather than 0: a Submission row that already exists is, by
-- definition, the result of at least one attempt. Rows created before this
-- migration have no SubmissionAttempt history, which is honest — the portal did
-- not record any — and `attemptCount = 1` keeps "current attempt number" well
-- defined for them.
-- ---------------------------------------------------------------------------
ALTER TABLE "Submission" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- SubmissionAttempt
--
-- The unique index on (submissionId, attemptNumber) is the real guarantee: two
-- teammates resubmitting at the same instant cannot both write "attempt 3".
-- Whichever loses that race fails the transaction and is told to retry, rather
-- than producing a history with a duplicated step.
--
-- submittedById is a plain column, NOT a foreign key to User. Removing a
-- participant from the event must not cascade away the record that they
-- submitted at 12:40 — that record is exactly what a dispute would need.
-- ---------------------------------------------------------------------------
CREATE TABLE "SubmissionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "answers" TEXT,
    "fileManifest" TEXT NOT NULL DEFAULT '[]',
    "submittedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubmissionAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SubmissionAttempt_submissionId_attemptNumber_key" ON "SubmissionAttempt"("submissionId", "attemptNumber");
CREATE INDEX "SubmissionAttempt_teamId_level_idx" ON "SubmissionAttempt"("teamId", "level");
CREATE INDEX "SubmissionAttempt_submissionId_createdAt_idx" ON "SubmissionAttempt"("submissionId", "createdAt");
