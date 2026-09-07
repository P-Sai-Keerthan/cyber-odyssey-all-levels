import 'server-only';

import { prisma } from '@/lib/prisma';
import type { StructuredInvestigationAnswers, SubmissionResponseData } from './submit-core';

/**
 * Reads a squad's CURRENT submission for one level.
 *
 * "Current" is not a heuristic here. The unique index on (teamId, level) means
 * there is exactly one Submission row per squad per level and it always holds the
 * latest accepted write — `SubmissionAttempt` carries the history beside it. So
 * the row this returns is, by construction, the one the evaluator judges and the
 * one the leaderboard reflects. Nothing has to sort by timestamp and hope.
 *
 * Shared by the Level 2 page, the submission API's GET, and the file-removal
 * path, so all three describe the submission identically.
 */
export async function readCurrentSubmission(
  teamId: string,
  level: number,
): Promise<SubmissionResponseData | null> {
  const submission = await prisma.submission.findUnique({
    where: { teamId_level: { teamId, level } },
    select: {
      id: true,
      level: true,
      status: true,
      answers: true,
      attemptCount: true,
      submittedAt: true,
      files: {
        select: { id: true, originalName: true, fileSize: true },
        orderBy: { createdAt: 'asc' },
      },
      evaluation: { select: { feedback: true, score: true, status: true } },
    },
  });

  if (!submission) return null;

  // `answers` is spread in rather than assigned. Under this project's
  // `exactOptionalPropertyTypes`, an optional property may be ABSENT but may not
  // be present-and-undefined, so writing `answers: undefined` for a submission
  // with no stored answers is a type error. Omitting the key is what "no answers"
  // actually means.
  const answers = parseAnswers(submission.answers);

  return {
    id: submission.id,
    level: submission.level,
    status: submission.status,
    submittedAt: submission.submittedAt.toISOString(),
    attemptCount: submission.attemptCount,
    files: submission.files,
    ...(answers ? { answers } : {}),
    feedback: submission.evaluation?.feedback ?? null,
    score: submission.evaluation?.score ?? null,
  };
}

/**
 * Answers are stored as a JSON string. A row written before the Level 2 rebuild,
 * or corrupted by hand, must not take the page down — an unreadable answer is
 * reported as "no answers", which is what the participant sees anyway.
 */
export function parseAnswers(raw: string | null): StructuredInvestigationAnswers | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StructuredInvestigationAnswers;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
