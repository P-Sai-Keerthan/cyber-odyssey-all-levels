'use server';

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { generateTemporaryPassword } from '@/lib/auth/temporary-credential';
import { assertPermission, AuthorizationError } from '@/lib/auth/permissions';
import { safeRevalidate } from '@/lib/utils/revalidate';
import { ADMIN_WRITE_TX } from '@/lib/db/transaction';
import type { ActionResult } from './auth-actions';

/**
 * Credential recovery for accounts and squads (Creator spec §6, §10).
 *
 * These actions REPLACE a credential; they never reveal one. See
 * src/lib/auth/temporary-credential.ts for why that distinction is the whole
 * design. The generated plaintext is returned to the caller exactly once, for
 * display to the authorised Creator, and is never persisted or logged.
 */

export interface TemporaryCredentialResult {
  /** Shown once to the authorised Creator. Never stored, never logged. */
  temporaryPassword: string;
  /** Whose credential was reset, for the confirmation dialog. */
  subject: string;
  issuedAt: string;
}

function toActionError(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof AuthorizationError) {
    return { success: false, error: err.message };
  }
  console.error(fallback, err);
  return { success: false, error: fallback };
}

/**
 * Issues a new temporary password for a user account, invalidating the old one.
 *
 * Every active session for that account is destroyed in the same transaction:
 * resetting a credential without revoking sessions leaves whoever currently holds
 * the account still logged in, which defeats the point when the reset is a
 * response to suspected compromise.
 */
export async function generateTemporaryAccountPasswordAction(
  targetUserId: string,
): Promise<ActionResult<TemporaryCredentialResult>> {
  try {
    const creator = await getSessionUser();
    assertPermission(creator, 'ACCOUNT_RESET_CREDENTIAL');

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true, email: true, role: true, status: true },
    });

    if (!target) {
      return {
        success: false,
        error: 'That account no longer exists. Refresh the account list and try again.',
      };
    }

    // The Creator account is the root of trust for the whole portal. Allowing it
    // to be reset from inside the portal would mean anyone who briefly holds a
    // Creator session could lock out the real Creator. Recovery for that account
    // is deliberately an out-of-band operation (`npm run db:seed`).
    if (target.role === 'CREATOR') {
      return {
        success: false,
        error:
          'Creator accounts cannot be reset from inside the portal. ' +
          'Use the documented out-of-band seed procedure to rotate Creator credentials.',
      };
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash,
          // Clear any brute-force lockout: the credential just changed, so the
          // previous failure count no longer describes anything meaningful.
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });

      // Revoke every existing session for the account.
      await tx.session.deleteMany({ where: { userId: target.id } });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          targetId: target.id,
          action: 'ACCOUNT_CREDENTIAL_RESET',
          // NOTE: the temporary password is deliberately NOT recorded here.
          details:
            `Creator @${creator.username} issued a temporary password for ` +
            `@${target.username} (${target.role}) and revoked all active sessions.`,
        },
      });
    }, ADMIN_WRITE_TX);

    safeRevalidate('/creator/accounts', '/creator', '/creator/audit-log');

    return {
      success: true,
      data: {
        temporaryPassword,
        subject: `@${target.username}`,
        issuedAt: now.toISOString(),
      },
    };
  } catch (err) {
    return toActionError(
      err,
      'Could not issue a temporary password. No credential was changed — please try again.',
    );
  }
}

/**
 * Issues a new temporary squad password, invalidating the old one.
 *
 * The squad password is what teammates use to join via the squad code. Rotating
 * it does not disturb existing membership — members are already joined — it only
 * changes what a new joiner must present.
 */
export async function generateTemporaryTeamPasswordAction(
  teamId: string,
): Promise<ActionResult<TemporaryCredentialResult>> {
  try {
    const creator = await getSessionUser();
    assertPermission(creator, 'TEAM_RESET_CREDENTIAL');

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, code: true },
    });

    if (!team) {
      return {
        success: false,
        error: 'That squad no longer exists. Refresh the squad registry and try again.',
      };
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: team.id },
        data: { passwordHash },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          action: 'TEAM_CREDENTIAL_RESET',
          // NOTE: neither the temporary password nor the squad join code is
          // recorded here. The code is a private credential in its own right.
          details:
            `Creator @${creator.username} issued a temporary squad password for ` +
            `"${team.name}". The previous squad password no longer works.`,
        },
      });
    }, ADMIN_WRITE_TX);

    safeRevalidate('/creator/teams', '/creator', '/creator/audit-log');

    return {
      success: true,
      data: {
        temporaryPassword,
        subject: `squad "${team.name}"`,
        issuedAt: now.toISOString(),
      },
    };
  } catch (err) {
    return toActionError(
      err,
      'Could not issue a temporary squad password. No credential was changed — please try again.',
    );
  }
}
