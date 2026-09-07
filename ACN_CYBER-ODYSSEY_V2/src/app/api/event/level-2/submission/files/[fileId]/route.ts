import { NextResponse } from 'next/server';
import { removeSubmissionFile } from '@/lib/submissions/remove-file';

const LEVEL = 2;

interface RouteContext {
  params: Promise<{ fileId: string }>;
}

/**
 * HTTP status for each removal outcome.
 *
 * `LAST_FILE` is 409 rather than 400: the request is well formed and the caller
 * is allowed to make it — it conflicts with the state of the submission, which
 * currently has exactly one deliverable attached.
 */
const STATUS_BY_CODE: Record<string, number> = {
  PORTAL_OFFLINE: 503,
  UNAUTHENTICATED: 401,
  FORBIDDEN_ROLE: 403,
  NO_TEAM: 403,
  TEAM_BLOCKED: 403,
  LEVEL_CLOSED: 403,
  FILE_NOT_FOUND: 404,
  LAST_FILE: 409,
  EVALUATION_IN_PROGRESS: 409,
  SERVER_ERROR: 500,
};

/**
 * Detach one file from the squad's current Level 2 submission.
 *
 * The file id in the path is the ONLY thing the client supplies, and it is
 * resolved against the signed-in participant's own squad submission before
 * anything is deleted — an id belonging to another squad is reported as 404,
 * because from this caller's position it does not exist.
 *
 * Refused after the deadline, refused while an evaluator holds the submission,
 * and refused when it would leave the submission with nothing attached.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const { fileId } = await context.params;

  if (!fileId) {
    return NextResponse.json(
      { error: 'No file was named for removal.', code: 'FILE_NOT_FOUND' },
      { status: 404 },
    );
  }

  const outcome = await removeSubmissionFile(LEVEL, fileId);

  if (outcome.ok) {
    return NextResponse.json({ submission: outcome.data }, { status: 200 });
  }

  return NextResponse.json(
    { error: outcome.error, code: outcome.code },
    { status: STATUS_BY_CODE[outcome.code] ?? 500 },
  );
}
