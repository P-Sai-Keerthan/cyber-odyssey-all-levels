/**
 * Evaluation approval states and the rule that defines a leaderboard-eligible score.
 *
 * Split out of `approval.ts` so that it carries NO `server-only` marker and no
 * Prisma import. Two things needed that:
 *
 *   - `lib/leaderboard/team-total.ts` needs APPROVAL_STATUS, and `approval.ts`
 *     needs team-total to compute a squad's stored score. Left in one file that
 *     is an import cycle; split, it is a plain dependency.
 *   - These constants describe a lifecycle, not a server capability. Anything
 *     that renders an approval state can read them without pulling a database
 *     client toward a bundle.
 *
 * `approval.ts` re-exports every name here, so existing imports are unchanged.
 */

export const APPROVAL_STATUS = {
  /** Evaluator is still drafting; nothing has been submitted for review. */
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  /** Evaluator has finalised a score; awaiting Admin decision. Does NOT score. */
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /** Admin accepted. This is the ONLY state that contributes to the leaderboard. */
  APPROVED: 'APPROVED',
  /** Admin returned it for revision. Does NOT score. Never deleted. */
  RETURNED_FOR_REVISION: 'RETURNED_FOR_REVISION',
  /** Legacy alias for returned for correction. Does NOT score. Never deleted. */
  REJECTED: 'REJECTED',
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

export const APPROVAL_STATUS_VALUES: readonly ApprovalStatus[] = Object.values(APPROVAL_STATUS);

export function isApprovalStatus(value: string): value is ApprovalStatus {
  return (APPROVAL_STATUS_VALUES as readonly string[]).includes(value);
}

/** Human-readable label for the UI. Kept beside the constants so they cannot drift. */
export function approvalStatusLabel(status: string): string {
  switch (status) {
    case APPROVAL_STATUS.NOT_SUBMITTED:
      return 'Draft';
    case APPROVAL_STATUS.PENDING_APPROVAL:
      return 'Pending Admin Approval';
    case APPROVAL_STATUS.APPROVED:
      return 'Approved';
    case APPROVAL_STATUS.RETURNED_FOR_REVISION:
    case APPROVAL_STATUS.REJECTED:
      return 'Returned for Revision';
    default:
      return status;
  }
}

/**
 * The `where` clause that defines a leaderboard-eligible evaluation.
 * Exported so that no call site has to restate the rule and risk getting it wrong.
 */
export function leaderboardEligibleWhere(teamId?: string) {
  return {
    ...(teamId ? { teamId } : {}),
    approvalStatus: APPROVAL_STATUS.APPROVED,
  };
}
