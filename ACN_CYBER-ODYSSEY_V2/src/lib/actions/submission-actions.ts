'use server';

import { performSubmission } from '@/lib/submissions/submit-core';
import type { ActionResult } from './auth-actions';

export type {
  StructuredInvestigationAnswers,
  SubmissionResponseData,
} from '@/lib/submissions/submit-core';

import type { SubmissionResponseData } from '@/lib/submissions/submit-core';

/**
 * Server Action: submit investigation deliverables.
 *
 * A THIN WRAPPER, deliberately. Every rule — session, squad, deadline, file
 * validation, replacement semantics, attempt history — lives in
 * `performSubmission`, which the Level 2 HTTP API also calls. This function's
 * only job is to translate a `FormData` payload and an outcome code into the
 * `ActionResult` shape the Level 3 workspace expects.
 *
 * WHY LEVEL 2 NO LONGER USES THIS PATH
 * ------------------------------------
 * Server Actions cap their request body at 1 MB by default, and Next throws
 * before the action body ever runs. A squad attaching a 1.7 MB report therefore
 * saw the client's generic catch — "An unexpected error occurred during
 * submission" — with nothing in the action to explain it. Level 2 now posts to a
 * route handler, which has no such cap and can answer 413 when a file really is
 * too large. `next.config.ts` also raises the Server Action limit so this path,
 * which Level 3 still uses, cannot fail the same way.
 */
export async function submitInvestigationAction(
  formData: FormData,
): Promise<ActionResult<SubmissionResponseData>> {
  const levelNum = parseInt((formData.get('level') as string) || '2', 10);

  const files: File[] = [];
  for (const item of formData.getAll('files')) {
    if (item instanceof File && item.size > 0) files.push(item);
  }
  if (files.length === 0) {
    const single = formData.get('file');
    if (single instanceof File && single.size > 0) files.push(single);
  }

  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : '';
  };

  const outcome = await performSubmission({
    level: levelNum,
    files,
    answers: {
      attacker: text('attacker'),
      proof: text('proof'),
      q1_intrusionVector: text('q1_intrusionVector'),
      q2_decryptedHash: text('q2_decryptedHash'),
      q3_persistenceMechanism: text('q3_persistenceMechanism'),
    },
  });

  if (!outcome.ok) {
    return outcome.fieldErrors
      ? { success: false, error: outcome.error, fieldErrors: outcome.fieldErrors }
      : { success: false, error: outcome.error };
  }

  return { success: true, data: outcome.data };
}
