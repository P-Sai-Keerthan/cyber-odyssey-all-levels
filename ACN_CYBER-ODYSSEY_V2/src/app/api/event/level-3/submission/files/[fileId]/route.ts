import { NextResponse } from 'next/server';
import { removeSubmissionFile } from '@/lib/submissions/remove-file';

const LEVEL = 3;

interface RouteContext {
  params: Promise<{ fileId: string }>;
}

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
 * Detach one file from the squad's current Level 3 submission.
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
