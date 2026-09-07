'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, destroySession } from '@/lib/auth/session';

export interface ActionResult<T = unknown> {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
  redirectTo?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,40}$/;

/**
 * Brute-force lockout policy (Phase 17 / SEC-17-02).
 *
 * When `FAILED_LOGIN_THRESHOLD` consecutive failures are recorded, the account is
 * locked for `LOCKOUT_DURATION_MS` by stamping an absolute `lockedUntil`. The
 * expiry is fixed at the moment of lockout and is NOT affected by anything the
 * account owner subsequently does — see the field comment in prisma/schema.prisma
 * for why the previous activity-derived window was exploitable.
 */
const FAILED_LOGIN_THRESHOLD = 10;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Uniform failure message for every credential rejection.
 * Identical for "no such account" and "wrong password" so the login form cannot
 * be used to enumerate which emails and usernames are registered for the event.
 */
const INVALID_CREDENTIALS_MESSAGE =
  'That email/username and password combination was not recognised. ' +
  'Check for typos — passwords are case-sensitive — and try again.';

/**
 * Server Action: Registers a new user account.
 * - PARTICIPANT: Account status is ACTIVE; automatically logged in and routed to /team/onboarding.
 * - EVALUATOR / ADMIN: Account status is PENDING_APPROVAL; logs STAFF_SIGNUP_REQUESTED in AuditLog; routed to /auth/pending-approval.
 */
export async function registerParticipantAction(
  formData: FormData,
): Promise<ActionResult<{ userId: string }>> {
  const email = (formData.get('email') as string)?.trim().toLowerCase();
  const username = (formData.get('username') as string)?.trim();
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;
  const roleInput = (formData.get('accountType') as string)?.trim().toUpperCase() || 'PARTICIPANT';

  // Allowed public signup roles (CREATOR is strictly excluded)
  const role = roleInput === 'EVALUATOR' || roleInput === 'ADMIN' ? roleInput : 'PARTICIPANT';

  const fieldErrors: Record<string, string> = {};

  if (!email || !EMAIL_REGEX.test(email)) {
    fieldErrors['email'] = 'A valid email address is required.';
  }

  if (!username) {
    fieldErrors['username'] = 'Username is required.';
  } else if (!USERNAME_REGEX.test(username)) {
    fieldErrors['username'] =
      'Username must be 2-40 characters and can include letters, numbers, hyphens, and underscores.';
  }

  if (!password || password.length < 12) {
    fieldErrors['password'] = 'Password must be at least 12 characters.';
  }

  if (password !== confirmPassword) {
    fieldErrors['confirmPassword'] = 'Passwords do not match.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  try {
    // 1. Check if email already registered (case-insensitive)
    const existingEmail = await prisma.user.findUnique({
      where: { email },
    });
    if (existingEmail) {
      return {
        success: false,
        fieldErrors: { email: 'An account with this email already exists.' },
      };
    }

    // 2. Check if username already taken (case-insensitive)
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });
    if (existingUsername) {
      return {
        success: false,
        fieldErrors: { username: 'This username is already taken.' },
      };
    }

    // 3. Secure password hash
    const passwordHash = await hashPassword(password);

    // 4. Determine initial account status
    // Participants are ACTIVE immediately. Evaluator and Admin require Creator approval.
    const isStaff = role === 'EVALUATOR' || role === 'ADMIN';
    const status = isStaff ? 'PENDING_APPROVAL' : 'ACTIVE';

    let newUser;
    if (isStaff) {
      newUser = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email,
            username,
            passwordHash,
            role,
            status,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: u.id,
            targetId: u.id,
            action: 'STAFF_SIGNUP_REQUESTED',
            details: `Requested ${role} role clearance for ${email} (@${username})`,
          },
        });

        return u;
      });
    } else {
      newUser = await prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          role,
          status,
        },
      });
    }

    // 5. Handle post-registration flow
    if (isStaff) {
      // Attach authenticated pending session so status checking works seamlessly
      await createSession(newUser.id);
      const roleLabel = role === 'EVALUATOR' ? 'Evaluator' : 'Admin';
      return {
        success: true,
        redirectTo: `/auth/pending-approval?role=${encodeURIComponent(roleLabel)}`,
        data: { userId: newUser.id },
      };
    }

    // Participant: Automatically create authenticated session and route to team onboarding
    await createSession(newUser.id);

    return {
      success: true,
      redirectTo: '/team/onboarding',
      data: { userId: newUser.id },
    };
  } catch (err) {
    console.error('Registration error:', err);
    return {
      success: false,
      error: 'Unable to complete registration. Please verify your details and try again.',
    };
  }
}

/**
 * Server Action: Authenticates a user by email or username and routes by account status & team state.
 */
export async function loginAction(
  formData: FormData,
): Promise<ActionResult<{ redirectTo: string }>> {
  const identifier = (formData.get('identifier') as string)?.trim();
  const password = formData.get('password') as string;

  if (!identifier) {
    return { success: false, fieldErrors: { identifier: 'Please enter your email or username.' } };
  }

  if (!password) {
    return { success: false, fieldErrors: { password: 'Password is required.' } };
  }

  try {
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await prisma.user.findUnique({
          where: { email: identifier.toLowerCase() },
          include: { membership: true },
        })
      : await prisma.user.findUnique({
          where: { username: identifier },
          include: { membership: true },
        });

    if (!user) {
      return { success: false, error: INVALID_CREDENTIALS_MESSAGE };
    }

    const now = new Date();

    // Brute-force lockout. `lockedUntil` is an absolute expiry stamped when the
    // failure threshold was crossed, so ordinary activity by the account owner
    // cannot extend it (SEC-17-02).
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      const minutesLeft = Math.max(
        1,
        Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000),
      );
      return {
        success: false,
        error:
          `This account is temporarily locked after ${FAILED_LOGIN_THRESHOLD} failed sign-in attempts. ` +
          `It unlocks automatically in about ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}. ` +
          'If it was not you, an event marshal can unlock it immediately.',
      };
    }

    // The lock has expired: clear the counter so the account starts a fresh
    // window rather than locking again on the next single mistake.
    const failuresBeforeThisAttempt = user.lockedUntil ? 0 : user.failedLoginCount;

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      const failures = failuresBeforeThisAttempt + 1;
      const nowLocked = failures >= FAILED_LOGIN_THRESHOLD;

      await prisma.user
        .update({
          where: { id: user.id },
          data: {
            failedLoginCount: failures,
            lockedUntil: nowLocked ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null,
          },
        })
        .catch(() => {});

      await prisma.auditLog
        .create({
          data: {
            targetId: user.id,
            action: nowLocked ? 'ACCOUNT_LOCKED' : 'FAILED_LOGIN',
            details: nowLocked
              ? `Account @${user.username} locked for ${LOCKOUT_DURATION_MS / 60000} minutes after ${failures} consecutive failed sign-in attempts.`
              : `Failed authentication attempt for @${user.username} (attempt ${failures} of ${FAILED_LOGIN_THRESHOLD}).`,
          },
        })
        .catch(() => {});

      if (nowLocked) {
        return {
          success: false,
          error:
            `This account has been locked for ${LOCKOUT_DURATION_MS / 60000} minutes after ` +
            `${FAILED_LOGIN_THRESHOLD} failed sign-in attempts. ` +
            'It will unlock automatically, or an event marshal can unlock it immediately.',
        };
      }

      return { success: false, error: INVALID_CREDENTIALS_MESSAGE };
    }

    // Credentials are correct — now evaluate account standing.
    if (user.status === 'REJECTED') {
      return {
        success: false,
        error:
          'This staff access request was not approved, so the account cannot sign in. ' +
          'If you believe this is a mistake, please speak to an event marshal.',
      };
    }

    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED') {
      return {
        success: false,
        error:
          'This account is currently blocked and cannot sign in. ' +
          'Please contact an event marshal to have access restored.',
      };
    }

    // Successful login or pending login: reset the failure counter and clear any expired lock.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        lastActivityAt: now,
        loginCount: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    // Session hygiene: discard this account's expired sessions so the Session
    // table does not accumulate dead rows across the event (§34).
    await prisma.session
      .deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } })
      .catch(() => {});

    // Create session
    await createSession(user.id);

    // Audit log for login
    const loginActionName = user.role === 'ADMIN' ? 'ADMIN_LOGIN' : 'LOGIN';
    await prisma.auditLog
      .create({
        data: {
          actorId: user.id,
          targetId: user.id,
          action: loginActionName,
          details: `User @${user.username} (${user.email}) authenticated. Role: ${user.role}, Status: ${user.status}`,
        },
      })
      .catch(() => {});

    // If account is awaiting approval, route to pending approval page
    if (user.status === 'PENDING_APPROVAL') {
      const roleLabel = user.role === 'EVALUATOR' ? 'Evaluator' : 'Admin';
      const redirectTo = `/auth/pending-approval?role=${encodeURIComponent(roleLabel)}`;
      return {
        success: true,
        redirectTo,
        data: { redirectTo },
      };
    }

    // Determine post-login destination based on server role and team state
    let redirectTo = '/dashboard';
    if (user.role === 'CREATOR') {
      redirectTo = '/creator';
    } else if (user.role === 'ADMIN') {
      redirectTo = '/admin';
    } else if (user.role === 'EVALUATOR') {
      redirectTo = '/evaluator';
    } else if (user.role === 'PARTICIPANT') {
      redirectTo = user.membership ? '/dashboard' : '/team/onboarding';
    }

    return {
      success: true,
      redirectTo,
      data: { redirectTo },
    };
  } catch (err) {
    console.error('Login error:', err);
    return {
      success: false,
      error: 'An unexpected authentication error occurred. Please try again.',
    };
  }
}

/**
 * Server Action: Logs out the current user, records logout activity, and clears session.
 */
export async function logoutAction() {
  const { getSessionUser } = await import('@/lib/auth/session');
  const user = await getSessionUser();

  if (user) {
    const now = new Date();
    await prisma.user
      .update({
        where: { id: user.id },
        data: {
          lastLogoutAt: now,
          lastActivityAt: now,
        },
      })
      .catch(() => {});

    const logoutActionName = user.role === 'ADMIN' ? 'ADMIN_LOGOUT' : 'LOGOUT';
    await prisma.auditLog
      .create({
        data: {
          actorId: user.id,
          targetId: user.id,
          action: logoutActionName,
          details: `User @${user.username} (${user.email}) logged out.`,
        },
      })
      .catch(() => {});
  }

  await destroySession();
  redirect('/login');
}

export interface AccountApprovalStatus {
  status:
    | 'ACTIVE'
    | 'PENDING_APPROVAL'
    | 'REJECTED'
    | 'BLOCKED'
    | 'SUSPENDED'
    | 'UNAUTHENTICATED'
    | 'DELETED';
  role?: string;
  destination?: string;
}

/**
 * Server Action: Lightweight account approval status probe.
 * Invoked by /auth/pending-approval to detect real-time Creator approvals without manual re-registration.
 */
export async function getAccountApprovalStatusAction(): Promise<
  ActionResult<AccountApprovalStatus>
> {
  try {
    const { getSessionUser } = await import('@/lib/auth/session');
    const user = await getSessionUser();

    if (!user) {
      return { success: true, data: { status: 'UNAUTHENTICATED' } };
    }

    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED' || user.status === 'REJECTED') {
      return {
        success: true,
        data: { status: user.status as AccountApprovalStatus['status'], role: user.role },
      };
    }

    if (user.status === 'ACTIVE') {
      let destination = '/dashboard';
      if (user.role === 'CREATOR') {
        destination = '/creator';
      } else if (user.role === 'ADMIN') {
        destination = '/admin';
      } else if (user.role === 'EVALUATOR') {
        destination = '/evaluator';
      } else if (user.role === 'PARTICIPANT') {
        destination = user.membership ? '/dashboard' : '/team/onboarding';
      }

      return {
        success: true,
        data: {
          status: 'ACTIVE',
          role: user.role,
          destination,
        },
      };
    }

    return {
      success: true,
      data: {
        status: 'PENDING_APPROVAL',
        role: user.role,
      },
    };
  } catch (err) {
    console.error('Error fetching account approval status:', err);
    return {
      success: false,
      error: 'Failed to retrieve account status.',
    };
  }
}
