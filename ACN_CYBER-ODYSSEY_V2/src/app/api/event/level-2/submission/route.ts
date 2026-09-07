import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import { readCurrentSubmission } from '@/lib/submissions/read-current';
import {
  performSubmission,
  type SubmissionFailureCode,
  type SubmissionOutcome,
} from '@/lib/submissions/submit-core';

const LEVEL = 2;

/**
 * Level 2 final-submission API.
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION
 * -------------------------------------------
 * Two reasons, both of which the previous implementation ran into.
 *
 * 1. THE BUG. Next.js caps a Server Action request body at 1 MB by default and
 *    throws `Body exceeded 1 MB limit` before the action's own code runs. A squad
 *    attaching a 1.7 MB report got a rejected promise, the workspace's catch
 *    block turned that into "An unexpected error occurred during submission", and
 *    nothing on the server explained it — the action had never been entered.
 *    Route handlers have no such cap.
 *
 * 2. STATUS CODES. A Server Action returns a value; it cannot answer 413 for an
 *    oversized file or 415 for an unsupported one. Those distinctions matter to
 *    anything that is not the browser UI, and they matter to a participant
 *    reading a network tab during a cybersecurity event.
 *
 * Every rule lives in `performSubmission`, which the Level 3 Server Action also
 * calls. This file is transport: parse multipart, map an outcome code to a status.
 */

/**
 * Outcome code to HTTP status.
 *
 * Kept as an exhaustive table rather than an if-chain so that adding a failure
 * code to the core is a type error here until it is given a status, instead of
 * silently defaulting to 500.
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
 *
 * There is no squad parameter, so this cannot be pointed at another squad's
 * work: it reads the session, then reads that squad's row.
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
        error: 'Only participants in a squad have a Level 2 submission.',
        code: 'NO_TEAM',
      },
      { status: 403 },
    );
  }

  const [submission, access] = await Promise.all([
    readCurrentSubmission(user.membership.teamId, LEVEL),
    checkAuthoritativeLevelAccess(LEVEL, true),
  ]);

  return NextResponse.json({
    submission,
    // The window as the SERVER sees it. The workspace uses this to decide what to
    // disable, but disabling is presentation — the same check runs again on every
    // write, so a participant who ignores it gets a 403, not a saved submission.
    window: {
      open: access.allowed,
      status: access.state?.status ?? 'LOCKED',
      endsAt: access.state?.endsAt ?? null,
      reason: access.allowed ? null : (access.reason ?? null),
    },
  });
}

/**
 * Create or replace the squad's Level 2 submission.
 *
 * Body: multipart/form-data
 *   attacker     — required, non-empty
 *   proof        — required, 50+ words
 *   files        — zero or more new uploads (PDF / DOCX / DOC / ZIP, ≤ 20 MB each)
 *   keepFileIds  — repeated field; ids of already-stored files to retain
 *
 * At least one file must remain attached once new uploads and retained files are
 * taken together, so a squad correcting only its written answer does not have to
 * re-upload a report the server already holds.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // A truncated or malformed multipart body. Nothing was written, and the
    // participant needs to know it was the upload rather than their answer.
    return NextResponse.json(
      {
        error:
          'The upload did not arrive complete, so nothing was submitted. ' +
          'Check your connection and try again.',
        code: 'INVALID_FILE',
      },
      { status: 400 },
    );
  }

  const files: File[] = [];
  for (const item of form.getAll('files')) {
    if (item instanceof File && item.size > 0) files.push(item);
  }

  const keepFileIds = form
    .getAll('keepFileIds')
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const hasAnswers = form.has('attacker') || form.has('proof');
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };

  const outcome = await performSubmission({
    // The level is fixed by the route, not read from the body. A Level 2 endpoint
    // that accepted a level field would be a way to write a Level 3 submission
    // through Level 2's window checks.
    level: LEVEL,
    files,
    answers: hasAnswers ? { attacker: text('attacker'), proof: text('proof') } : undefined,
    keepFileIds,
  });

  return respond(outcome);
}
