'use server';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateTeamCode, normalizeTeamCode } from '@/lib/team/code-generator';
import { generateExternalTeamRef } from '@/lib/team/external-ref';
import { MAX_TEAM_SIZE, TEAM_SLOTS, JOIN_SLOT_MAX_ATTEMPTS } from '@/lib/team/constants';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import type { ActionResult } from './auth-actions';

export interface CreatedTeamData {
  id: string;
  name: string;
  code: string;
  memberCount: number;
}

/** Prisma error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
}

/**
 * Server Action: Creates a new team with the current participant as squad head.
 *
 * Concurrency: team name and join code uniqueness are enforced by database unique
 * indexes, and the creator's membership by TeamMember.userId being unique. Two
 * participants racing to create the same team name means one receives a field
 * error rather than a duplicate row.
 */
export async function createTeamAction(formData: FormData): Promise<ActionResult<CreatedTeamData>> {
  const { getPortalStatus } = await import('@/lib/event/portal-settings');
  const { isOnline } = await getPortalStatus();
  if (!isOnline) {
    return {
      success: false,
      error:
        'The Cyber Odyssey portal is currently offline, so squads cannot be created right now. ' +
        'The operations desk takes the portal offline between phases — please stand by and try again shortly.',
    };
  }

  const user = await getSessionUser();
  if (!user) {
    return {
      success: false,
      error: 'Your session has expired. Please sign in again to create a squad.',
    };
  }

  if (user.role !== 'PARTICIPANT') {
    return {
      success: false,
      error: 'Only event participants can create squads. Staff accounts do not join teams.',
    };
  }

  if (user.membership) {
    return {
      success: false,
      error:
        'You already belong to a squad. Each participant can be on exactly one squad — ' +
        'leave your current squad through an event marshal before creating a new one.',
    };
  }

  const teamName = (formData.get('teamName') as string)?.trim();
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  const fieldErrors: Record<string, string> = {};

  if (!teamName || teamName.length < 2 || teamName.length > 50) {
    fieldErrors['teamName'] = 'Team name must be between 2 and 50 characters.';
  }

  if (!password || password.length < 6) {
    fieldErrors['password'] = 'Team password must be at least 6 characters.';
  }

  if (password !== confirmPassword) {
    fieldErrors['confirmPassword'] = 'Team passwords do not match.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  try {
    const passwordHash = await hashPassword(password);

    // Generate a join code, retrying on the (rare) collision. The database unique
    // index is the real guarantee — this loop only avoids surfacing an error for
    // an outcome we can cheaply retry.
    let created: { id: string; name: string; code: string } | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const code = generateTeamCode();
      // Minted in the SAME transaction as the squad, so a squad cannot exist
      // without an external reference — the external bridges resolve squads by
      // this value, and a squad missing one is invisible to Level 1 and ORION.
      const externalRef = generateExternalTeamRef();
      try {
        created = await prisma.$transaction(async (tx) => {
          const team = await tx.team.create({
            data: {
              name: teamName!,
              code,
              passwordHash,
              creatorId: user.id,
              externalRef,
            },
            select: { id: true, name: true, code: true },
          });

          // Squad head always occupies slot 1.
          await tx.teamMember.create({
            data: {
              teamId: team.id,
              userId: user.id,
              slot: 1,
              role: 'HEAD',
            },
          });

          await tx.auditLog.create({
            data: {
              actorId: user.id,
              targetId: user.id,
              action: 'TEAM_CREATED',
              details: `Participant @${user.username} created squad "${team.name}".`,
            },
          });

          return team;
        }, CRITICAL_WRITE_TX);
      } catch (err) {
        lastError = err;
        if (!isUniqueViolation(err)) throw err;

        const target = String(err.meta?.['target'] ?? '');
        // Name and membership collisions are terminal; only a code collision retries.
        if (target.includes('name')) {
          return {
            success: false,
            fieldErrors: {
              teamName: 'A squad with this name already exists. Choose a different name.',
            },
          };
        }
        if (target.includes('userId')) {
          return {
            success: false,
            error:
              'You were added to a squad in another tab or device while this form was open. ' +
              'Refresh the page to see your squad.',
          };
        }
        // Otherwise it was the join code or the external reference, both of
        // which are regenerated at the top of the loop — retry.
      }
    }

    if (!created) {
      console.error('Create team error: exhausted join-code attempts', lastError);
      return {
        success: false,
        error:
          'Could not allocate a unique squad joining code. Please try again — ' +
          'if this repeats, contact an event marshal.',
      };
    }

    return {
      success: true,
      data: {
        id: created.id,
        name: created.name,
        code: created.code,
        memberCount: 1,
      },
    };
  } catch (err: unknown) {
    console.error('Create team error:', err);
    return {
      success: false,
      error: 'Could not create your squad because of a server error. Please try again.',
    };
  }
}

/**
 * Server Action: Concurrency-safe atomic team joining.
 *
 * CAPACITY GUARANTEE (Phase 17 / DB-17-03)
 * -----------------------------------------
 * The squad cap is enforced by the database, not by a count. Each membership row
 * occupies a numbered slot in 1..MAX_TEAM_SIZE and `@@unique([teamId, slot])`
 * rejects a second row for the same slot.
 *
 * When N participants submit a join for the same squad simultaneously:
 *   - each transaction reads the taken slots and claims the lowest free one;
 *   - if two claim the same slot, exactly one commits and the other fails P2002;
 *   - the loser retries against a now-smaller set of free slots;
 *   - once every slot is taken there is no free slot to claim, so the join is
 *     refused with TEAM_FULL.
 *
 * There is no interleaving under any isolation level in which a fourth member is
 * admitted, because admission requires winning a unique index the database owns.
 */
export async function joinTeamAction(
  formData: FormData,
): Promise<ActionResult<{ redirectTo: string }>> {
  const { getPortalStatus } = await import('@/lib/event/portal-settings');
  const { isOnline } = await getPortalStatus();
  if (!isOnline) {
    return {
      success: false,
      error:
        'The Cyber Odyssey portal is currently offline, so squads cannot be joined right now. ' +
        'The operations desk takes the portal offline between phases — please stand by and try again shortly.',
    };
  }

  const user = await getSessionUser();
  if (!user) {
    return {
      success: false,
      error: 'Your session has expired. Please sign in again to join a squad.',
    };
  }

  if (user.role !== 'PARTICIPANT') {
    return {
      success: false,
      error: 'Only event participants can join squads. Staff accounts do not join teams.',
    };
  }

  if (user.membership) {
    return {
      success: false,
      error:
        'You already belong to a squad. Each participant can be on exactly one squad — ' +
        'ask an event marshal if you need to be reassigned.',
    };
  }

  const rawCode = (formData.get('teamCode') as string)?.trim();
  const password = formData.get('password') as string;

  if (!rawCode) {
    return { success: false, fieldErrors: { teamCode: 'Team ID or joining code is required.' } };
  }

  if (!password) {
    return { success: false, fieldErrors: { password: 'Team password is required.' } };
  }

  const normalizedCode = normalizeTeamCode(rawCode);

  try {
    const team = await prisma.team.findUnique({
      where: { code: normalizedCode },
      select: { id: true, name: true, status: true, passwordHash: true },
    });

    if (!team) {
      return {
        success: false,
        fieldErrors: {
          teamCode:
            'No squad matches that joining code. Check the code with your squad lead — ' +
            'it looks like CYB-XXXXX and is case-insensitive.',
        },
      };
    }

    if (team.status === 'BLOCKED' || team.status === 'DISQUALIFIED') {
      return {
        success: false,
        error:
          'This squad has been blocked or disqualified from the event, so it cannot accept new members. ' +
          'Please contact an event marshal.',
      };
    }

    const isPasswordValid = await verifyPassword(password, team.passwordHash);
    if (!isPasswordValid) {
      return {
        success: false,
        fieldErrors: {
          password: 'Incorrect squad password. Ask your squad lead for the password they set.',
        },
      };
    }

    // Slot-claiming loop. Bounded by MAX_TEAM_SIZE: every retry follows a lost
    // race, which means one more slot is now provably taken.
    let joined = false;
    for (let attempt = 0; attempt < JOIN_SLOT_MAX_ATTEMPTS && !joined; attempt++) {
      try {
        await prisma.$transaction(async (tx) => {
          // Re-verify inside the transaction: the participant may have joined
          // elsewhere between the session read and here.
          const existingMembership = await tx.teamMember.findUnique({
            where: { userId: user.id },
            select: { id: true },
          });
          if (existingMembership) {
            throw new Error('ALREADY_IN_TEAM');
          }

          const taken = await tx.teamMember.findMany({
            where: { teamId: team.id },
            select: { slot: true },
          });
          const takenSlots = new Set(taken.map((m) => m.slot));
          const freeSlot = TEAM_SLOTS.find((s) => !takenSlots.has(s));

          if (freeSlot === undefined) {
            throw new Error('TEAM_FULL');
          }

          // The insert below is the decision point. If a concurrent transaction
          // already claimed `freeSlot`, this throws P2002 and we retry.
          await tx.teamMember.create({
            data: {
              teamId: team.id,
              userId: user.id,
              slot: freeSlot,
              role: 'MEMBER',
            },
          });

          await tx.auditLog.create({
            data: {
              actorId: user.id,
              targetId: user.id,
              action: 'TEAM_JOINED',
              details: `Participant @${user.username} joined squad "${team.name}" in slot ${freeSlot}.`,
            },
          });
        }, CRITICAL_WRITE_TX);
        joined = true;
      } catch (err) {
        if (
          err instanceof Error &&
          (err.message === 'TEAM_FULL' || err.message === 'ALREADY_IN_TEAM')
        ) {
          throw err;
        }
        if (!isUniqueViolation(err)) throw err;

        const target = String(err.meta?.['target'] ?? '');
        if (target.includes('userId')) {
          throw new Error('ALREADY_IN_TEAM');
        }
        // Lost the slot race — loop and claim the next free slot.
      }
    }

    if (!joined) {
      // Every slot was contested and taken across all attempts: the squad is full.
      throw new Error('TEAM_FULL');
    }

    return {
      success: true,
      redirectTo: '/dashboard',
      data: { redirectTo: '/dashboard' },
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === 'TEAM_FULL') {
        return {
          success: false,
          error:
            `This squad already has its full roster of ${MAX_TEAM_SIZE} participants, so no further members can join. ` +
            'Ask your squad lead to confirm the roster, or create your own squad instead.',
        };
      }
      if (err.message === 'ALREADY_IN_TEAM') {
        return {
          success: false,
          error:
            'You were added to a squad in another tab or device while this form was open. ' +
            'Refresh the page to see your squad.',
        };
      }
    }
    console.error('Join team error:', err);
    return {
      success: false,
      error: 'Could not join the squad because of a server error. Please try again.',
    };
  }
}
