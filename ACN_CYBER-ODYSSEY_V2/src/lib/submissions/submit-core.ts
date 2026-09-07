import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import {
  saveSubmissionFile,
  discardSubmissionFiles,
  type SavedSubmissionFile,
} from '@/lib/storage/submission-storage';
import { safeRevalidate } from '@/lib/utils/revalidate';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import { levelRequiresStructuredAnswer, validateLevel2Answers } from './answer-validation';

/**
 * The submission pipeline, shared by every caller.
 *
 * WHY A CORE MODULE
 * -----------------
 * Two entry points now reach the same operation: the Level 2 workspace posts
 * multipart form data to `/api/event/level-2/submission`, and Level 3 still calls
 * the `submitInvestigationAction` Server Action. They need different envelopes —
 * one answers with HTTP status codes, the other with an `ActionResult` — but the
 * rules underneath (who may write, what a valid file is, what replacing a report
 * does to its evaluation) must be one implementation. Two copies would drift, and
 * the copy that drifts is the one that stops enforcing the deadline.
 *
 * Every caller therefore gets a structured `SubmissionOutcome` carrying a machine
 * `code`; mapping that code to an HTTP status or an action result is the caller's
 * only job.
 *
 * WHY THE CLIENT SUPPLIES NO IDENTITY
 * -----------------------------------
 * There is no `teamId` parameter and there never should be. The squad is read
 * from the server session, so a participant cannot submit — or replace — another
 * squad's work by editing a form field. The only client-supplied identifiers are
 * `keepFileIds`, and each one is checked to belong to this squad's own submission
 * before it is honoured.
 */

export interface StructuredInvestigationAnswers {
  /** Level 2: who the squad accuses. */
  attacker?: string;
  /** Level 2: the evidence chain, at least 50 words. */
  proof?: string;
  // Legacy keys, retained so submissions recorded before the Level 2 rebuild
  // still parse and still render in the evaluator's findings panel.
  q1_intrusionVector?: string;
  q2_decryptedHash?: string;
  q3_persistenceMechanism?: string;
}

export interface SubmissionFileView {
  id: string;
  originalName: string;
  fileSize: number;
}

export interface SubmissionResponseData {
  id: string;
  level: number;
  status: string;
  submittedAt: string;
  files: SubmissionFileView[];
  answers?: StructuredInvestigationAnswers;
  feedback?: string | null;
  score?: number | null;
  /** Which attempt the current submission is. 1 for a first submission. */
  attemptCount?: number;
}

export type SubmissionFailureCode =
  | 'PORTAL_OFFLINE'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ROLE'
  | 'NO_TEAM'
  | 'TEAM_BLOCKED'
  | 'LEVEL_CLOSED'
  | 'NO_FILES'
  | 'INVALID_ANSWERS'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'INVALID_FILE'
  | 'UNKNOWN_FILE_REFERENCE'
  | 'EVALUATION_IN_PROGRESS'
  | 'DUPLICATE_SUBMISSION'
  | 'SERVER_ERROR';

export type SubmissionOutcome =
  | { ok: true; created: boolean; data: SubmissionResponseData }
  | {
      ok: false;
      code: SubmissionFailureCode;
      error: string;
      fieldErrors?: Record<string, string>;
    };

export interface PerformSubmissionInput {
  level: number;
  /** Newly uploaded files. May be empty when the squad is only editing answers. */
  files: File[];
  /** Raw answer fields exactly as submitted. Level-scoped rules decide what matters. */
  answers?: Record<string, string> | undefined;
  /**
   * Ids of files ALREADY stored against this squad's submission that should
   * survive this write. Anything not listed is superseded and its bytes removed.
   *
   * Omitted means "keep nothing", which is the behaviour the Server Action has
   * always had: a submission replaces the previous one wholesale.
   */
  keepFileIds?: string[] | undefined;
}

function failure(
  code: SubmissionFailureCode,
  error: string,
  fieldErrors?: Record<string, string>,
): SubmissionOutcome {
  return fieldErrors ? { ok: false, code, error, fieldErrors } : { ok: false, code, error };
}

/**
 * Turns the free-text answer fields into the object that is stored.
 *
 * Only keys with content are written, so an unanswered field is absent rather
 * than an empty string — the evaluator's findings panel renders every key it
 * receives, and a column of blank headings helps nobody.
 */
function buildAnswers(raw: Record<string, string> | undefined): StructuredInvestigationAnswers {
  const pick = (key: string) => (raw?.[key] ?? '').trim();
  const attacker = pick('attacker');
  const proof = pick('proof');
  const q1 = pick('q1_intrusionVector');
  const q2 = pick('q2_decryptedHash');
  const q3 = pick('q3_persistenceMechanism');

  return {
    ...(attacker ? { attacker } : {}),
    ...(proof ? { proof } : {}),
    ...(q1 ? { q1_intrusionVector: q1 } : {}),
    ...(q2 ? { q2_decryptedHash: q2 } : {}),
    ...(q3 ? { q3_persistenceMechanism: q3 } : {}),
  };
}

/**
 * Creates or replaces a squad's submission for one level.
 *
 * Ordering is deliberate and load-bearing:
 *
 *   1. Cheap rejections first (portal state, session, role, squad, level window).
 *      None of them touch the disk, so a participant submitting after the
 *      deadline never causes a write of any kind.
 *   2. Files are validated and written to disk BEFORE the transaction, because
 *      magic-byte validation has to read the bytes and we will not record a row
 *      for a file we have not inspected.
 *   3. The transaction swaps the rows over.
 *   4. Superseded bytes are unlinked only AFTER the commit. Unlinking earlier
 *      would destroy a squad's only copy if the transaction then rolled back.
 */
export async function performSubmission(input: PerformSubmissionInput): Promise<SubmissionOutcome> {
  // Hoisted so the catch block can remove bytes written for a submission that
  // did not commit (BUG-17-03).
  const savedFiles: SavedSubmissionFile[] = [];

  try {
    const { getPortalStatus } = await import('@/lib/event/portal-settings');
    const { isOnline } = await getPortalStatus();
    if (!isOnline) {
      return failure(
        'PORTAL_OFFLINE',
        'The Cyber Odyssey portal is currently offline, so submissions are not being accepted. ' +
          'The operations desk takes the portal offline between phases — your work is safe, ' +
          'please stand by and submit once it is back online.',
      );
    }

    const user = await getSessionUser();
    if (!user) {
      return failure(
        'UNAUTHENTICATED',
        'Your session has expired, so the submission was not sent. ' +
          'Sign in again and resubmit — your file is still on your device.',
      );
    }

    if (user.role !== 'PARTICIPANT' || user.status !== 'ACTIVE') {
      return failure(
        'FORBIDDEN_ROLE',
        'This account cannot submit deliverables. Only active event participants can submit, ' +
          'and staff accounts review submissions rather than making them.',
      );
    }

    if (!user.membership) {
      return failure(
        'NO_TEAM',
        'You need to be in a squad before you can submit. Submissions are recorded against a squad, ' +
          'not an individual — create or join one from the Team page first.',
      );
    }

    const team = user.membership.team;
    if (team && (team.status === 'BLOCKED' || team.status === 'DISQUALIFIED')) {
      return failure(
        'TEAM_BLOCKED',
        'Your squad has been blocked from submitting by the event organisers, so this submission was not accepted. ' +
          'Please speak to an event marshal to find out why and have it reviewed.',
      );
    }

    const levelNum = input.level;

    // THE DEADLINE. Authoritative, server-side, and checked on every write path.
    // The countdown in the browser is a courtesy and is never consulted: a
    // participant calling this directly after the deadline is stopped here.
    const access = await checkAuthoritativeLevelAccess(levelNum, Boolean(user.membership));
    if (!access.allowed) {
      return failure(
        'LEVEL_CLOSED',
        access.reason ||
          'This level is not currently accepting submissions. Check the level page for its ' +
            'status and scheduled window.',
      );
    }

    const teamId = user.membership.teamId;
    const keepFileIds = new Set(input.keepFileIds ?? []);

    // 1. Fast-path rejection if an evaluator already holds this submission. The
    //    in-transaction re-check below is what actually guarantees it.
    const existingSubmission = await prisma.submission.findUnique({
      where: { teamId_level: { teamId, level: levelNum } },
      select: {
        id: true,
        status: true,
        attemptCount: true,
        answers: true,
        files: { select: { id: true } },
      },
    });

    // Structured answers, validated per level. Level 3 posts a report file and
    // carries its own answer flow, so it is not asked for an attacker name.
    // If the submission is made without question-answer text (e.g. deliverable-only upload),
    // validation is bypassed and existing answers are preserved.
    let answers: StructuredInvestigationAnswers = {};
    if (input.answers !== undefined) {
      answers = buildAnswers(input.answers);
      if (levelRequiresStructuredAnswer(levelNum)) {
        const check = validateLevel2Answers({
          attacker: answers.attacker ?? '',
          proof: answers.proof ?? '',
        });
        if (!check.ok) {
          return failure(
            'INVALID_ANSWERS',
            check.fieldErrors.attacker ??
              check.fieldErrors.proof ??
              'Your final answer is incomplete.',
            check.fieldErrors as Record<string, string>,
          );
        }
        answers.attacker = check.normalized.attacker;
        answers.proof = check.normalized.proof;
      }
    } else if (existingSubmission?.answers) {
      try {
        answers = JSON.parse(existingSubmission.answers) as StructuredInvestigationAnswers;
      } catch {
        answers = {};
      }
    }

    // Within the window a squad may replace its own submission as often as it
    // likes. Uploading a corrected report before the deadline is ordinary
    // competition behaviour, and refusing it only teaches squads to withhold
    // their work until the last minute. What is refused is replacing a report an
    // evaluator has already picked up, which would silently invalidate work in
    // progress.
    if (
      existingSubmission &&
      (existingSubmission.status === 'UNDER_REVIEW' || existingSubmission.status === 'ACCEPTED')
    ) {
      return failure(
        'EVALUATION_IN_PROGRESS',
        'An evaluator has already picked up your submission for this level, so it can no longer be ' +
          'replaced. If it is returned for revision you will be able to submit again from this page.',
      );
    }

    // Every id the client asked to keep must belong to THIS squad's submission.
    // Without this check a participant could name a file id belonging to another
    // squad and have it re-parented onto their own submission.
    if (keepFileIds.size > 0) {
      const ownIds = new Set((existingSubmission?.files ?? []).map((f) => f.id));
      for (const id of keepFileIds) {
        if (!ownIds.has(id)) {
          return failure(
            'UNKNOWN_FILE_REFERENCE',
            'One of the files you asked to keep is no longer part of your submission. ' +
              'Reload the page to see what is currently attached, then submit again.',
          );
        }
      }
    }

    // A submission has to end up with at least one deliverable attached. New
    // uploads and retained files both count, so a squad correcting only its
    // written answer does not have to re-upload a report it already sent.
    const retainedCount = keepFileIds.size;
    const incomingFiles = input.files.filter((f) => f instanceof File && f.size > 0);
    if (incomingFiles.length === 0 && retainedCount === 0) {
      return failure(
        'NO_FILES',
        'No file was attached, so there was nothing to submit. ' +
          'Attach at least one deliverable — a PDF, Word document (.doc/.docx), or ZIP package — and submit again.',
      );
    }

    // Storage paths of files this write supersedes. Populated inside the
    // transaction, unlinked only after it commits.
    const supersededPaths: string[] = [];

    // 2. Validate and persist the new files.
    for (const file of incomingFiles) {
      const fileSaveResult = await saveSubmissionFile(file, levelNum, teamId);
      if (!fileSaveResult.valid || !fileSaveResult.file) {
        discardSubmissionFiles(savedFiles);
        const code: SubmissionFailureCode =
          fileSaveResult.reason === 'TOO_LARGE'
            ? 'FILE_TOO_LARGE'
            : fileSaveResult.reason === 'UNSUPPORTED_TYPE'
              ? 'UNSUPPORTED_FILE_TYPE'
              : 'INVALID_FILE';
        return failure(code, fileSaveResult.error || `Failed to process file "${file.name}".`);
      }
      savedFiles.push(fileSaveResult.file);
    }

    // 3. Atomically swap the submission over.
    //
    //    Two teammates can press Submit simultaneously. The checks above narrow
    //    the window; the authoritative guards are the unique index on
    //    (teamId, level) and the unique index on (submissionId, attemptNumber),
    //    so the loser of a race fails rather than interleaving.
    const submissionResult = await prisma.$transaction(async (tx) => {
      const raceCheck = await tx.submission.findUnique({
        where: { teamId_level: { teamId, level: levelNum } },
      });

      let subRecord;
      let isRevision = false;
      let attemptNumber = 1;

      if (raceCheck) {
        // Re-read INSIDE the transaction. This is where a teammate's simultaneous
        // replacement is caught, so two uploads cannot interleave into a
        // submission whose file rows came from one and whose timestamp came from
        // the other.
        if (raceCheck.status === 'UNDER_REVIEW' || raceCheck.status === 'ACCEPTED') {
          throw new Error('EVALUATION_IN_PROGRESS');
        }

        isRevision = true;
        attemptNumber = raceCheck.attemptCount + 1;

        // Capture superseded paths before the rows go, so the bytes can be
        // removed AFTER the transaction commits.
        const priorFiles = await tx.submissionFile.findMany({
          where: { submissionId: raceCheck.id },
          select: { id: true, storagePath: true },
        });
        const doomed = priorFiles.filter((f) => !keepFileIds.has(f.id));
        supersededPaths.push(...doomed.map((f) => f.storagePath));

        if (doomed.length > 0) {
          await tx.submissionFile.deleteMany({ where: { id: { in: doomed.map((f) => f.id) } } });
        }

        subRecord = await tx.submission.update({
          where: { id: raceCheck.id },
          data: {
            status: 'SUBMITTED',
            userId: user.id,
            submittedAt: new Date(),
            answers: JSON.stringify(answers),
            attemptCount: attemptNumber,
          },
        });

        // A replaced report invalidates any evaluation of the previous one, so the
        // evaluation returns to PENDING and the evaluator scores what was actually
        // submitted. Approval state is deliberately untouched here — the approval
        // workflow owns that.
        await tx.evaluation.updateMany({
          where: { submissionId: raceCheck.id },
          data: { status: 'PENDING', score: 0 },
        });
      } else {
        subRecord = await tx.submission.create({
          data: {
            teamId,
            userId: user.id,
            level: levelNum,
            status: 'SUBMITTED',
            answers: JSON.stringify(answers),
            attemptCount: 1,
            submittedAt: new Date(),
          },
        });
      }

      for (const savedFile of savedFiles) {
        await tx.submissionFile.create({
          data: {
            submissionId: subRecord.id,
            fileName: savedFile.fileName,
            originalName: savedFile.originalName,
            fileSize: savedFile.fileSize,
            mimeType: savedFile.mimeType,
            storagePath: savedFile.storagePath,
          },
        });
      }

      // The complete file set as it stands after the swap: retained files plus
      // the new ones. Read back rather than assembled from the inputs, so the
      // manifest describes what is actually attached.
      const finalFiles = await tx.submissionFile.findMany({
        where: { submissionId: subRecord.id },
        select: { id: true, originalName: true, fileSize: true, mimeType: true },
        orderBy: { createdAt: 'asc' },
      });

      // Append-only history. The unique index on (submissionId, attemptNumber)
      // rejects a duplicate step if two writes race this far.
      await tx.submissionAttempt.create({
        data: {
          submissionId: subRecord.id,
          teamId,
          level: levelNum,
          attemptNumber,
          status: subRecord.status,
          answers: JSON.stringify(answers),
          fileManifest: JSON.stringify(
            finalFiles.map((f) => ({
              originalName: f.originalName,
              fileSize: f.fileSize,
              mimeType: f.mimeType,
            })),
          ),
          submittedById: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          targetId: user.id,
          action: isRevision ? 'SUBMISSION_REPLACED' : 'SUBMISSION_SUBMITTED',
          details: `Squad "${team.name}" submitted Level ${levelNum} deliverables (attempt ${attemptNumber}, ${finalFiles.length} file(s) attached: ${finalFiles.map((f) => f.originalName).join(', ')}).`,
        },
      });

      return { record: subRecord, files: finalFiles, created: !isRevision };
    }, CRITICAL_WRITE_TX);

    // The replacement is durable, so the bytes it superseded can go. Best-effort
    // and strictly after the commit: an orphaned file only wastes disk, whereas
    // unlinking before the commit could destroy a submission that still exists.
    if (supersededPaths.length > 0) {
      discardSubmissionFiles(supersededPaths.map((storagePath) => ({ storagePath })));
    }

    // Post-commit cache invalidation. Deliberately non-fatal: the submission is
    // already durable, so a revalidation failure must not be reported as a
    // failed submission (BUG-17-04).
    safeRevalidate(
      `/event/level-${levelNum}`,
      '/event',
      '/dashboard',
      '/evaluator',
      '/evaluator/submissions',
    );

    return {
      ok: true,
      created: submissionResult.created,
      data: {
        id: submissionResult.record.id,
        level: submissionResult.record.level,
        status: submissionResult.record.status,
        submittedAt: submissionResult.record.submittedAt.toISOString(),
        attemptCount: submissionResult.record.attemptCount,
        files: submissionResult.files.map((f) => ({
          id: f.id,
          originalName: f.originalName,
          fileSize: f.fileSize,
        })),
        answers,
      },
    };
  } catch (err: unknown) {
    // The submission did not commit, so nothing references these bytes.
    discardSubmissionFiles(savedFiles);

    if (err instanceof Error && err.message === 'EVALUATION_IN_PROGRESS') {
      return failure(
        'EVALUATION_IN_PROGRESS',
        'An evaluator picked up your submission while this upload was in progress, so it could not be ' +
          'replaced. Your previously submitted report is intact and is the one being evaluated.',
      );
    }

    // Either the in-transaction check caught it, or a unique index rejected the
    // losing side of a simultaneous submission.
    const isDuplicate =
      (err instanceof Error && err.message === 'DUPLICATE_SUBMISSION') ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002');

    if (isDuplicate) {
      return failure(
        'DUPLICATE_SUBMISSION',
        "A teammate finalised your squad's submission for this level moments before you did, " +
          'so only theirs was recorded. Refresh this page to see the submission that was saved — ' +
          'your squad is not penalised, and only one submission per level is required.',
      );
    }

    // Detail stays server-side. The participant gets a sentence they can act on;
    // the stack trace goes to the server log where an operator can read it.
    console.error('[submission] failed:', err);
    return failure(
      'SERVER_ERROR',
      'Your deliverables could not be submitted because of a server error, and nothing was saved. ' +
        'Please try again. If this keeps happening, notify an event marshal before the level timer expires.',
    );
  }
}
