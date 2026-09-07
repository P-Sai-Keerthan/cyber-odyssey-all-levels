import 'server-only';
import type { Prisma } from '@prisma/client';

/**
 * Evaluation approval lifecycle and the leaderboard gate.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * --------------------------------------
 * Only an APPROVED evaluation may contribute to the official leaderboard.
 *
 * The leaderboard renders `Team.score`. `Team.score` is therefore never
 * incremented, decremented, or set from a client-supplied value — it is
 * RECOMPUTED from the sum of that squad's APPROVED evaluations, by the database,
 * inside the same transaction as whatever changed the approval state.
 *
 * Recomputing rather than applying a delta is deliberate: a delta can be lost or
 * replayed, and the resulting drift is silent and permanent. A recompute is
 * idempotent — running it twice produces the same answer — so a retry can never
 * corrupt a standing.
 *
 * Every mutation path (evaluator submits, admin approves, admin rejects, evaluator
 * resubmits) funnels through `recomputeTeamScore`, so there is exactly one
 * definition of what a squad's score means.
 */

// Approval states live in their own module (see approval-status.ts) so that the
// score computation can import them without an import cycle. Re-exported here so
// every existing `from '@/lib/evaluation/approval'` import keeps working.
export {
  APPROVAL_STATUS,
  APPROVAL_STATUS_VALUES,
  isApprovalStatus,
  approvalStatusLabel,
  leaderboardEligibleWhere,
} from './approval-status';
export type { ApprovalStatus } from './approval-status';

import {
  APPROVAL_STATUS,
  approvalStatusLabel,
  isApprovalStatus,
  type ApprovalStatus,
} from './approval-status';
import { computeTeamOfficialTotal } from '@/lib/leaderboard/team-total';

/** Minimal transaction-client surface this module needs. */
type TxClient = Prisma.TransactionClient;

/**
 * Recomputes and persists a squad's official score from its APPROVED evaluations.
 *
 * MUST be called inside the same transaction as any change to an evaluation's
 * approval state, so that the score and the state can never disagree — not even
 * momentarily, and not if the process dies between the two writes.
 *
 * Returns the newly stored score.
 */
/**
 * Takes the exclusive row lock on one squad, and MUST be the first statement in
 * any transaction that will both write a score component and recompute the total.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ORDER MATTERS — this caused a deadlock under load
 * ---------------------------------------------------------------------------
 * Inserting a `Level1Result` takes an implicit FK lock (`FOR KEY SHARE`) on the
 * referenced `Team` row. If the recompute then asks for `FOR UPDATE` on that same
 * row, it is a lock UPGRADE. Two concurrent deliveries for the same squad both
 * hold KEY SHARE and both wait for the other to release it:
 *
 *   ERROR: deadlock detected
 *   Process A waits for ShareLock on transaction N; blocked by process B.
 *   Process B waits for ShareLock on transaction M; blocked by process A.
 *
 * The HTTP load harness reproduced it immediately — 64 of 300 concurrent score
 * callbacks returned 500 and 38 squads finished with a wrong total. SQLite could
 * never show this: it serialises writers, so there was nothing to deadlock.
 *
 * Acquiring the exclusive lock BEFORE the insert removes the upgrade entirely.
 * The second transaction simply waits at the door, then proceeds. Re-acquiring
 * it later in the same transaction (as `recomputeTeamScore` does) is free — a
 * transaction already holding the lock is not upgrading anything.
 *
 * PostgreSQL-specific by design: the portal's datasource is PostgreSQL, and this
 * is the mechanism that makes read-then-write atomic per squad.
 */
export async function lockTeamRow(tx: TxClient, teamId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId} FOR UPDATE`;
}

export async function recomputeTeamScore(tx: TxClient, teamId: string): Promise<number> {
  // Delegates to the ONE definition of a squad's official total.
  //
  // This used to sum APPROVED evaluations and nothing else, which quietly made
  // `Team.score` a different quantity from the score on the leaderboard: Level 1
  // results, Level 3 discoveries and approved score adjustments were all
  // missing. Because it OVERWRITES the column, approving a Level 2 evaluation
  // also erased whatever Level 1 points a squad had already earned — the
  // participant dashboard, which prints this column, then showed them a total
  // that had gone DOWN after their teammate's report was approved.
  // Serialise concurrent recomputes for THIS squad.
  //
  // A recompute is read-then-write: aggregate the components, then store the
  // total. Two of them running at once for the same squad — two admins approving
  // two evaluations, or an approval landing while a Level 1 solve arrives — both
  // read before either writes, and the second write silently overwrites the
  // first with a total computed from stale input. The squad's score then sits
  // below its own evidence until something else happens to trigger another
  // recompute.
  //
  // SQLite hid this completely: it admits one writer at a time, so the two
  // transactions could not interleave. On PostgreSQL they genuinely run at once,
  // and `tests/phase16-event-concurrency` caught it immediately after the
  // migration — a squad stored 26 against approved evaluations totalling 53.
  //
  // The row lock makes the read-then-write atomic per squad. It is taken on the
  // row this function is about to update, so it also orders the UPDATE below,
  // and it is released with the surrounding transaction. Squads do not contend
  // with each other — the lock is one row, not the table.
  await lockTeamRow(tx, teamId);

  const { total } = await computeTeamOfficialTotal(tx, teamId);

  await tx.team.update({
    where: { id: teamId },
    data: { score: total },
  });

  return total;
}

/**
 * Legal approval-state transitions.
 *
 * Encoded as data rather than scattered `if` statements so the whole lifecycle is
 * readable at a glance and so an illegal transition is impossible to express.
 *
 *   NOT_SUBMITTED    → PENDING_APPROVAL            (evaluator submits)
 *   PENDING_APPROVAL → APPROVED | REJECTED         (admin decides)
 *   REJECTED         → PENDING_APPROVAL            (evaluator corrects and resubmits)
 *   APPROVED         → (terminal)
 *
 * APPROVED is terminal by design: once a score is official and visible on the
 * leaderboard, silently pulling it back would change published standings. An
 * Admin who needs to undo an approval must do so as a deliberate, audited action,
 * which is not part of this specification.
 */
const ALLOWED_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  [APPROVAL_STATUS.NOT_SUBMITTED]: [APPROVAL_STATUS.PENDING_APPROVAL],
  [APPROVAL_STATUS.PENDING_APPROVAL]: [
    APPROVAL_STATUS.APPROVED,
    APPROVAL_STATUS.REJECTED,
    APPROVAL_STATUS.RETURNED_FOR_REVISION,
  ],
  [APPROVAL_STATUS.RETURNED_FOR_REVISION]: [APPROVAL_STATUS.PENDING_APPROVAL],
  [APPROVAL_STATUS.REJECTED]: [APPROVAL_STATUS.PENDING_APPROVAL],
  [APPROVAL_STATUS.APPROVED]: [],
};

export function canTransition(from: string, to: ApprovalStatus): boolean {
  if (!isApprovalStatus(from)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Explains a refused transition in words a reviewer can act on. */
export function transitionRefusalReason(from: string, to: ApprovalStatus): string {
  if (from === APPROVAL_STATUS.APPROVED) {
    return (
      'This evaluation has already been approved and its score is published on the ' +
      'official leaderboard, so it can no longer be changed.'
    );
  }
  if (
    to === APPROVAL_STATUS.APPROVED ||
    to === APPROVAL_STATUS.REJECTED ||
    to === APPROVAL_STATUS.RETURNED_FOR_REVISION
  ) {
    return (
      'This evaluation is not awaiting approval, so it cannot be approved or returned for revision. ' +
      'Only evaluations the evaluator has submitted for review can be decided on.'
    );
  }
  return `This evaluation cannot move from ${approvalStatusLabel(from)} to ${approvalStatusLabel(to)}.`;
}
