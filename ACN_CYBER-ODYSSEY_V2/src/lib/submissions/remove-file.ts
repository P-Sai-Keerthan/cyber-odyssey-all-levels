import 'server-only';

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import { discardSubmissionFiles } from '@/lib/storage/submission-storage';
import { safeRevalidate } from '@/lib/utils/revalidate';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import type { SubmissionFailureCode, SubmissionResponseData } from './submit-core';
import { readCurrentSubmission } from './read-current';

export type RemoveFileOutcome =
  | { ok: true; data: SubmissionResponseData }
  | { ok: false; code: SubmissionFailureCode | 'FILE_NOT_FOUND' | 'LAST_FILE'; error: string };

/**
 * Detaches one file from a squad's current submission.
 *
 * WHY THIS IS ITS OWN OPERATION
 * -----------------------------
 * Removing a file could be expressed as "resubmit everything except that one",
 * but that would make a squad re-upload files the server already holds just to
 * drop a fourth one — over a conference network, at a deadline. A squad member
 * who attached the wrong file should be able to take it off in one request.
 *
 * WHAT IT REFUSES
 * ---------------
 * The last remaining file. A submission with nothing attached is not a
 * submission an evaluator can judge, and leaving one in that state silently
 * would be worse for the squad than the error. Replacing the file is the
 * supported way to change it.
 *
 * The deadline applies here exactly as it does to submitting: after the level
 * closes, the submission is what it is.
 */
export async function removeSubmissionFile(
  level: number,
  fileId: string,
): Promise<RemoveFileOutcome> {
  try {
    const { getPortalStatus } = await import('@/lib/event/portal-settings');
    const { isOnline } = await getPortalStatus();
    if (!isOnline) {
      return {
        ok: false,
        code: 'PORTAL_OFFLINE',
        error:
          'The Cyber Odyssey portal is currently offline, so your submission cannot be changed right now.',
      };
    }

    const user = await getSessionUser();
    if (!user) {
      return {
        ok: false,
        code: 'UNAUTHENTICATED',
        error: 'Your session has expired. Sign in again to change your submission.',
      };
    }

    if (user.role !== 'PARTICIPANT' || user.status !== 'ACTIVE') {
      return {
        ok: false,
        code: 'FORBIDDEN_ROLE',
        error: 'Only active event participants can change a squad submission.',
      };
    }

    if (!user.membership) {
      return {
        ok: false,
        code: 'NO_TEAM',
        error: 'You need to be in a squad before you can change a submission.',
      };
    }

    const team = user.membership.team;
    if (team && (team.status === 'BLOCKED' || team.status === 'DISQUALIFIED')) {
      return {
        ok: false,
        code: 'TEAM_BLOCKED',
        error: 'Your squad has been blocked by the event organisers, so its submission is locked.',
      };
    }

    const access = await checkAuthoritativeLevelAccess(level, true);
    if (!access.allowed) {
      return {
        ok: false,
        code: 'LEVEL_CLOSED',
        error: access.reason || 'This level is closed, so its submission can no longer be changed.',
      };
    }

    const teamId = user.membership.teamId;

    const submission = await prisma.submission.findUnique({
      where: { teamId_level: { teamId, level } },
      select: {
        id: true,
        status: true,
        attemptCount: true,
        files: { select: { id: true, storagePath: true } },
      },
    });

    if (!submission) {
      return {
        ok: false,
        code: 'FILE_NOT_FOUND',
        error: 'Your squad has no submission for this level yet, so there is no file to remove.',
      };
    }

    if (submission.status === 'UNDER_REVIEW' || submission.status === 'ACCEPTED') {
      return {
        ok: false,
        code: 'EVALUATION_IN_PROGRESS',
        error:
          'An evaluator has already picked up your submission, so its files can no longer be changed.',
      };
    }

    // Scoped to THIS squad's submission. A file id belonging to another squad
    // simply is not in this list, so it reads as "not found" and never as a
    // permitted delete.
    const target = submission.files.find((f) => f.id === fileId);
    if (!target) {
      return {
        ok: false,
        code: 'FILE_NOT_FOUND',
        error:
          'That file is not part of your squad’s current submission. ' +
          'Reload the page to see what is attached.',
      };
    }

    if (submission.files.length <= 1) {
      return {
        ok: false,
        code: 'LAST_FILE',
        error:
          'This is the only file attached to your submission, so it cannot be removed — a submission ' +
          'with no deliverable cannot be judged. Upload a replacement instead, which swaps this file out.',
      };
    }

    const attemptNumber = submission.attemptCount + 1;

    await prisma.$transaction(async (tx) => {
      // Re-scoped by submissionId as well as id: between the read above and this
      // write the file could already have gone, and this makes the delete a
      // no-op rather than a cross-submission write.
      const deleted = await tx.submissionFile.deleteMany({
        where: { id: fileId, submissionId: submission.id },
      });
      if (deleted.count === 0) {
        throw new Error('FILE_ALREADY_GONE');
      }

      const finalFiles = await tx.submissionFile.findMany({
        where: { submissionId: submission.id },
        select: { originalName: true, fileSize: true, mimeType: true },
        orderBy: { createdAt: 'asc' },
      });

      const record = await tx.submission.update({
        where: { id: submission.id },
        data: { attemptCount: attemptNumber, userId: user.id },
        select: { answers: true, status: true },
      });

      await tx.submissionAttempt.create({
        data: {
          submissionId: submission.id,
          teamId,
          level,
          attemptNumber,
          status: record.status,
          answers: record.answers,
          fileManifest: JSON.stringify(finalFiles),
          submittedById: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          targetId: user.id,
          action: 'SUBMISSION_FILE_REMOVED',
          details: `Squad "${team.name}" removed a file from its Level ${level} submission (attempt ${attemptNumber}; ${finalFiles.length} file(s) remain).`,
        },
      });
    }, CRITICAL_WRITE_TX);

    // Bytes go only after the row is durably gone.
    discardSubmissionFiles([{ storagePath: target.storagePath }]);

    safeRevalidate(`/event/level-${level}`, '/evaluator', '/evaluator/submissions');

    const refreshed = await readCurrentSubmission(teamId, level);
    if (!refreshed) {
      return {
        ok: false,
        code: 'SERVER_ERROR',
        error: 'The file was removed but the submission could not be read back. Reload the page.',
      };
    }

    return { ok: true, data: refreshed };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'FILE_ALREADY_GONE') {
      return {
        ok: false,
        code: 'FILE_NOT_FOUND',
        error: 'That file had already been removed. Reload the page to see what is attached.',
      };
    }
    console.error('[submission] file removal failed:', err);
    return {
      ok: false,
      code: 'SERVER_ERROR',
      error: 'The file could not be removed because of a server error. Please try again.',
    };
  }
}
