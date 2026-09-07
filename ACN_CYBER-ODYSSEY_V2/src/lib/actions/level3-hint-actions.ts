'use server';

import { prisma } from '@/lib/prisma';
import { requireParticipant } from '@/lib/auth/guards';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import { safeRevalidate } from '@/lib/utils/revalidate';
import { hintPenaltyFor, isValidHintNumber } from '@/lib/level3/scoring-policy';
import type { ActionResult } from '@/lib/actions/auth-actions';

/**
 * Level 3 hint unlocking.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT MAY SAY
 * ---------------------------------------------------------------------------
 * Which bug, and which hint number. Nothing else. It cannot name a squad (read
 * from the session), and it cannot name a price — `hintPenaltyFor` is the only
 * authority on what a hint costs. A request claiming `points: 0` is charged the
 * full amount.
 *
 * ---------------------------------------------------------------------------
 * WHY A SQUAD IS NEVER CHARGED TWICE
 * ---------------------------------------------------------------------------
 * Two teammates pressing Unlock on the same hint at the same instant both pass
 * any "already unlocked?" read. The guarantee is
 * `@@unique([teamId, bugId, hintNumber])`: one insert commits, the other takes
 * P2002 and is served the hint content having been charged nothing.
 *
 * This is also why the content is returned from the SAME call that records the
 * charge. Splitting them would create a window in which a squad is charged and
 * then fails to receive what it paid for.
 */

export interface HintUnlockResult {
  bugId: string;
  hintNumber: number;
  content: string;
  /** What this call charged. 0 when the squad already held the hint. */
  chargedPoints: number;
  alreadyUnlocked: boolean;
  /** Squad's Level 3 penalty total after this call. */
  penaltyPoints: number;
}

export async function unlockLevel3HintAction(
  formData: FormData,
): Promise<ActionResult<HintUnlockResult>> {
  const user = await requireParticipant();

  const teamId = user.membership?.teamId;
  const teamName = user.membership?.team?.name ?? 'unknown squad';
  if (!teamId) {
    return { success: false, error: 'You must belong to an active squad to unlock hints.' };
  }

  const bugId = (formData.get('bugId') as string | null)?.trim();
  const hintNumber = Number(formData.get('hintNumber'));

  if (!bugId) {
    return { success: false, error: 'No hint was specified.' };
  }
  if (!isValidHintNumber(hintNumber)) {
    return { success: false, error: 'That hint does not exist.' };
  }

  // Hints cost points, so they may only be bought while the level is open.
  // Without this a squad could keep spending after the level closed, or before it
  // opened, by calling the action directly.
  const access = await checkAuthoritativeLevelAccess(3, true);
  if (!access.allowed) {
    return {
      success: false,
      error: access.reason ?? 'Level 3 is not currently open.',
    };
  }

  try {
    const hint = await prisma.level3Hint.findUnique({
      where: { bugId_hintNumber: { bugId, hintNumber } },
      select: { content: true, bug: { select: { id: true, code: true, isActive: true } } },
    });

    if (!hint || !hint.bug.isActive) {
      return { success: false, error: 'That hint does not exist.' };
    }

    // Price is resolved here, from policy. The request never supplies it.
    const price = hintPenaltyFor(hintNumber);

    const outcome = await prisma.$transaction(async (tx) => {
      // INSERT ... ON CONFLICT DO NOTHING, not create-and-catch.
      //
      // WHY THIS SHAPE (PostgreSQL): a statement that RAISES inside a
      // transaction aborts the WHOLE transaction. Every later statement then
      // fails with `current transaction is aborted, commands ignored until end
      // of transaction block`. Catching P2002 rescues nothing — the aggregate
      // two lines down still fails, and an unlock that should have been a
      // harmless "already bought" returns a 500 to a participant who is simply
      // clicking the same hint twice.
      //
      // SQLite hid this completely: it does not abort the transaction on a
      // constraint error, so create-and-catch behaved as intended right up to
      // the database migration. `createMany` with skipDuplicates compiles to
      // ON CONFLICT DO NOTHING, which raises nothing at all, and `count` reports
      // whether the row was new. The unique index still guarantees one charge.
      const inserted = await tx.level3Penalty.createMany({
        data: [
          {
            teamId,
            bugId,
            hintNumber,
            points: price,
            unlockedById: user.id,
          },
        ],
        skipDuplicates: true,
      });

      const aggregate = await tx.level3Penalty.aggregate({
        where: { teamId },
        _sum: { points: true },
      });

      return {
        charged: inserted.count === 1,
        penaltyPoints: aggregate._sum.points ?? 0,
      };
    }, CRITICAL_WRITE_TX);

    if (outcome.charged) {
      await prisma.auditLog
        .create({
          data: {
            actorId: user.id,
            targetId: user.id,
            action: 'LEVEL3_HINT_UNLOCKED',
            // Never the hint content: the audit log is readable by Creator and
            // Admin, and a hint is challenge material.
            details: `Squad "${teamName}" unlocked hint ${hintNumber} for Level 3 bug ${hint.bug.code} (−${price} pts).`,
          },
        })
        .catch(() => {});

      safeRevalidate('/event/level-3', '/leaderboard', '/dashboard');
    }

    return {
      success: true,
      data: {
        bugId,
        hintNumber,
        content: hint.content,
        chargedPoints: outcome.charged ? price : 0,
        alreadyUnlocked: !outcome.charged,
        penaltyPoints: outcome.penaltyPoints,
      },
    };
  } catch (err) {
    console.error('Level 3 hint unlock error:', err);
    return { success: false, error: 'Could not unlock that hint right now. Please try again.' };
  }
}

/**
 * Hint content the squad has ALREADY paid for.
 *
 * Separate from the unlock action so a page reload does not look like a purchase
 * attempt, and so the participant page can render previously-bought hints without
 * any write at all.
 */
export async function getUnlockedLevel3HintsAction(): Promise<
  ActionResult<{ bugId: string; hintNumber: number; content: string }[]>
> {
  const user = await requireParticipant();
  const teamId = user.membership?.teamId;
  if (!teamId) return { success: true, data: [] };

  try {
    const penalties = await prisma.level3Penalty.findMany({
      where: { teamId },
      select: { bugId: true, hintNumber: true },
    });
    if (penalties.length === 0) return { success: true, data: [] };

    // One query for the content, keyed by what this squad actually bought. A
    // participant cannot widen this: the filter is built from their own rows.
    const hints = await prisma.level3Hint.findMany({
      where: {
        OR: penalties.map((p) => ({ bugId: p.bugId, hintNumber: p.hintNumber })),
      },
      select: { bugId: true, hintNumber: true, content: true },
    });

    return { success: true, data: hints };
  } catch (err) {
    console.error('Level 3 hint fetch error:', err);
    return { success: false, error: 'Could not load your unlocked hints.' };
  }
}
