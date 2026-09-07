'use server';

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { safeRevalidate } from '@/lib/utils/revalidate';
import {
  getLevel3Config,
  updateLevel3Config,
  parseTargetIp,
  type Level3TargetConfig,
} from '@/lib/level3/target-config';
import type { ActionResult } from './auth-actions';

/**
 * Level 3 configuration — Creator-only mutations.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS TRUSTED FROM THE CLIENT
 * ---------------------------------------------------------------------------
 * The address string, and nothing else. Not a creator id, not a role, not an
 * event id, not a storage path — every one of those is re-established here from
 * the session cookie. A participant who calls this action directly gets the same
 * refusal whether or not they claim to be a Creator, because the claim is never
 * read.
 */

/**
 * Establishes an active CREATOR session, or throws.
 *
 * Mirrors `requireCreatorUser` in creator-resource-actions.ts deliberately:
 * these two files govern the same Creator surface and must refuse identically.
 * `status !== 'ACTIVE'` is part of the check, so a suspended Creator loses
 * configuration rights immediately rather than at session expiry.
 */
async function requireCreatorUser() {
  const user = await getSessionUser();
  if (!user || user.role !== 'CREATOR' || user.status !== 'ACTIVE') {
    throw new Error(
      'Your account does not have permission to change Level 3 configuration. ' +
        'The target address and sample report are owned by the event Creator; ' +
        'evaluators, admins and participants can see the published values but cannot change them.',
    );
  }
  return user;
}

/** Pages that render any part of the Level 3 configuration. */
const AFFECTED_PATHS = ['/creator/resources/level-3', '/event/level-3', '/event'] as const;

/**
 * Reads the current configuration for the Creator console.
 *
 * Creator-gated even though the same target address is visible to participants:
 * this response also carries the track ceilings and the released flag, which are
 * operational planning values, and there is no reason for the console's read
 * path to be looser than its write path.
 */
export async function getLevel3ConfigAction(): Promise<ActionResult<Level3TargetConfig>> {
  try {
    await requireCreatorUser();
    return { success: true, data: await getLevel3Config() };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to read Level 3 configuration.',
    };
  }
}

/**
 * Sets, replaces or clears the Level 3 target IP address.
 *
 * An empty string CLEARS the target — that is a real configuration state, not an
 * error. The participant page then shows a neutral "not yet assigned" panel
 * instead of an address that is no longer true.
 */
export async function setLevel3TargetIpAction(
  rawIp: string,
): Promise<ActionResult<Level3TargetConfig>> {
  try {
    const creator = await requireCreatorUser();

    // Length-cap before parsing: the field is bounded by what an IPv4 address
    // can be, and an unbounded string has no business reaching the parser.
    if (typeof rawIp !== 'string' || rawIp.length > 64) {
      return { success: false, error: 'Target address is not a valid value.' };
    }

    const parsed = parseTargetIp(rawIp);
    if (!parsed.ok) {
      return { success: false, error: parsed.error, fieldErrors: { targetIp: parsed.error } };
    }

    const before = await getLevel3Config();
    const updated = await updateLevel3Config({ targetIp: parsed.value }, creator.id);

    // Audit the CHANGE, including the previous value: a wrong target address is
    // the kind of thing that gets noticed an hour later, and "what was it
    // before, and who changed it" is the only question that matters then.
    const describe = (v: string | null) => v ?? 'none';
    await prisma.auditLog
      .create({
        data: {
          actorId: creator.id,
          action: parsed.value === null ? 'LEVEL3_TARGET_IP_CLEARED' : 'LEVEL3_TARGET_IP_UPDATED',
          details:
            `Creator @${creator.username} changed the Level 3 target IP from ` +
            `${describe(before.targetIp)} to ${describe(updated.targetIp)}.`,
        },
      })
      .catch(() => {});

    safeRevalidate(...AFFECTED_PATHS);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update the Level 3 target address.',
    };
  }
}

/**
 * Releases or withdraws Track 2.
 *
 * This moves the AVAILABLE discovery ceiling between the two configured figures.
 * It does not award anything and cannot change a score a squad already holds:
 * earned points come from `Level3Discovery` rows, which this never touches.
 */
export async function setLevel3Track2ReleasedAction(
  released: boolean,
): Promise<ActionResult<Level3TargetConfig>> {
  try {
    const creator = await requireCreatorUser();

    if (typeof released !== 'boolean') {
      return { success: false, error: 'Track 2 release state must be true or false.' };
    }

    const updated = await updateLevel3Config({ track2Released: released }, creator.id);

    await prisma.auditLog
      .create({
        data: {
          actorId: creator.id,
          action: released ? 'LEVEL3_TRACK2_RELEASED' : 'LEVEL3_TRACK2_WITHDRAWN',
          details:
            `Creator @${creator.username} ${released ? 'released' : 'withdrew'} Level 3 Track 2. ` +
            `Available discovery score is now ${updated.availableDiscoveryPoints} PTS.`,
        },
      })
      .catch(() => {});

    safeRevalidate(...AFFECTED_PATHS);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update Track 2 release state.',
    };
  }
}

/**
 * Adjusts the two track ceilings.
 *
 * Guarded so the stored pair can never express a nonsense event: Track 2 is the
 * CUMULATIVE figure, so it can never be below Track 1. Rejecting that here is
 * what makes "do not double-count" a property of the data rather than a rule the
 * UI has to remember.
 */
export async function setLevel3TrackPointsAction(input: {
  track1Points: number;
  track2Points: number;
}): Promise<ActionResult<Level3TargetConfig>> {
  try {
    const creator = await requireCreatorUser();

    const { track1Points, track2Points } = input;
    const bounded = (n: unknown): n is number =>
      typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000;

    if (!bounded(track1Points) || !bounded(track2Points)) {
      return {
        success: false,
        error: 'Track point values must be whole numbers between 0 and 1,000,000.',
      };
    }

    if (track2Points < track1Points) {
      return {
        success: false,
        error:
          'Track 2 is the CUMULATIVE available score after release, so it cannot be lower than Track 1. ' +
          `Enter the total available once Track 2 opens (currently Track 1 is ${track1Points} PTS).`,
      };
    }

    const updated = await updateLevel3Config({ track1Points, track2Points }, creator.id);

    await prisma.auditLog
      .create({
        data: {
          actorId: creator.id,
          action: 'LEVEL3_TRACK_POINTS_UPDATED',
          details:
            `Creator @${creator.username} set Level 3 track ceilings to ` +
            `Track 1 ${track1Points} PTS, Track 2 (cumulative) ${track2Points} PTS.`,
        },
      })
      .catch(() => {});

    safeRevalidate(...AFFECTED_PATHS);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update Level 3 track points.',
    };
  }
}
