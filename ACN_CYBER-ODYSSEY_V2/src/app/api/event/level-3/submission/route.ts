import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import { readCurrentSubmission } from '@/lib/submissions/read-current';
import {
  performSubmission,
  type SubmissionFailureCode,
  type SubmissionOutcome,
} from '@/lib/submissions/submit-core';

const LEVEL = 3;

/**
 * Outcome code to HTTP status.
 */
const STATUS_BY_CODE: Record<SubmissionFailureCode, number> = {
  PORTAL_OFFLINE: 503,
  UNAUTHENTICATED: 401,
  FORBIDDEN_ROLE: 403,
  NO_TEAM: 403,
  TEAM_BLOCKED: 403,
  LEVEL_CLOSED: 403,
  NO_FILES: 400,
  INVALID_ANSWERS: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  INVALID_FILE: 400,
  UNKNOWN_FILE_REFERENCE: 409,
  EVALUATION_IN_PROGRESS: 409,
  DUPLICATE_SUBMISSION: 409,
  SERVER_ERROR: 500,
};

function respond(outcome: SubmissionOutcome): NextResponse {
  if (outcome.ok) {
    return NextResponse.json({ submission: outcome.data }, { status: outcome.created ? 201 : 200 });
  }

  return NextResponse.json(
    {
      error: outcome.error,
      code: outcome.code,
      ...(outcome.fieldErrors ? { fieldErrors: outcome.fieldErrors } : {}),
    },
    { status: STATUS_BY_CODE[outcome.code] },
  );
}

/**
 * Current submission state for the signed-in participant's own squad.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'Sign in to view your squad’s submission.', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  if (user.role !== 'PARTICIPANT' || !user.membership) {
    return NextResponse.json(
      {
        error: 'Only participants in a squad have a Level 3 submission.',
        code: 'NO_TEAM',
      },
      { status: 403 },
    );
  }

  const access = await checkAuthoritativeLevelAccess(LEVEL, true);
  if (!access.allowed && !access.isCompleted) {
    return NextResponse.json(
      { error: 'Level 3 is not open.', code: 'LEVEL_CLOSED' },
      { status: 403 },
    );
  }

  const current = await readCurrentSubmission(user.membership.teamId, LEVEL);
  return NextResponse.json({ submission: current });
}

/**
 * Accept a new or updated Level 3 investigation submission.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: 'The submission could not be read. Please choose your files and try again.',
        code: 'INVALID_FILE',
      },
      { status: 400 },
    );
  }

  const files: File[] = [];
  for (const item of form.getAll('files')) {
    if (item instanceof File && item.size > 0) files.push(item);
  }
  if (files.length === 0) {
    const single = form.get('file');
    if (single instanceof File && single.size > 0) files.push(single);
  }

  const keepFileIds: string[] = [];
  for (const item of form.getAll('keepFileIds')) {
    if (typeof item === 'string' && item.length > 0) keepFileIds.push(item);
  }

  const outcome = await performSubmission({
    level: LEVEL,
    files,
    keepFileIds: keepFileIds.length > 0 ? keepFileIds : undefined,
  });

  return respond(outcome);
}
