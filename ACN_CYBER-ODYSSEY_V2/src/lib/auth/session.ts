import { cookies } from 'next/headers';
import { cache } from 'react';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';

export const SESSION_COOKIE_NAME = 'cyber_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

/**
 * How stale `User.lastActivityAt` is allowed to become before it is refreshed.
 *
 * PERF-17-02: this is a database WRITE on the read path of every authenticated
 * request. At 60s with ~210 participants it sustained roughly 3.5 writes/second
 * of pure telemetry, contending with real work for SQLite's single write lock.
 * Presence tracking does not need minute-level precision — 5 minutes cuts that
 * traffic five-fold while still driving the "online now" indicators accurately
 * enough for the Creator and Admin consoles.
 */
const ACTIVITY_REFRESH_INTERVAL_MS = Number(
  process.env['ACTIVITY_REFRESH_INTERVAL_MS'] ?? 5 * 60 * 1000,
);

/**
 * Fields every caller needs. Notably EXCLUDES passwordHash: the session object is
 * passed into React Server Components and handed to server actions, so it must
 * never carry a credential.
 */
const SESSION_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  role: true,
  status: true,
  lastLoginAt: true,
  lastLogoutAt: true,
  lastActivityAt: true,
  createdAt: true,
} as const;

/**
 * Membership shape for the common case: the squad's own attributes, without the
 * roster. Nine of the ten authenticated routes need only this.
 */
const MEMBERSHIP_SELECT = {
  id: true,
  teamId: true,
  role: true,
  joinedAt: true,
  slot: true,
  team: {
    select: {
      id: true,
      name: true,
      code: true,
      score: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

/**
 * Creates a server session in the database and sets an HTTP-only cookie.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
      expires: expiresAt,
    });
  } catch {
    // Graceful fallback when invoked outside Next.js request context
  }

  return token;
}

/** Reads the session token from the request cookie, or null. */
async function readSessionToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Applies the checks that must hold for a session to be usable, and refreshes
 * activity telemetry. Returns false if the session was rejected and destroyed.
 */
async function validateAndTouch(session: {
  token: string;
  expiresAt: Date;
  user: { id: string; status: string; lastActivityAt: Date | null };
}): Promise<boolean> {
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { token: session.token } }).catch(() => {});
    return false;
  }

  // Immediate revocation: a blocked, suspended or rejected account
  // loses its live session on its very next request rather than at expiry.
  if (
    session.user.status === 'BLOCKED' ||
    session.user.status === 'SUSPENDED' ||
    session.user.status === 'REJECTED'
  ) {
    await prisma.session.delete({ where: { token: session.token } }).catch(() => {});
    return false;
  }

  // Any other non-active, non-pending status is rejected immediately
  if (session.user.status !== 'ACTIVE' && session.user.status !== 'PENDING_APPROVAL') {
    await prisma.session.delete({ where: { token: session.token } }).catch(() => {});
    return false;
  }

  const now = new Date();
  const last = session.user.lastActivityAt;
  if (!last || now.getTime() - last.getTime() > ACTIVITY_REFRESH_INTERVAL_MS) {
    // Fire-and-forget: presence telemetry must never delay or fail a request.
    prisma.user
      .update({ where: { id: session.user.id }, data: { lastActivityAt: now } })
      .catch(() => {});
  }

  return true;
}

/**
 * Gets the validated user for the current session cookie, with squad membership
 * and squad attributes but WITHOUT the squad roster.
 *
 * PERF-17-03: this previously returned session → user → membership → team →
 * members → user, a five-table join executed on every page render and every
 * server action. Only /team renders the roster; every other route discarded it.
 * Routes that do need the roster call `getSessionUserWithTeamRoster()`.
 *
 * Returns null if the session is missing, expired, or the account is not ACTIVE.
 */
/**
 * The signed-in user for THIS request, or null.
 *
 * ---------------------------------------------------------------------------
 * REQUEST-SCOPED, NOT CACHED ACROSS REQUESTS
 * ---------------------------------------------------------------------------
 * `cache()` from React memoises for the lifetime of one server render and
 * nothing longer. It is NOT a TTL cache, is never shared between requests, and
 * is never shared between users — every new request re-reads the session row.
 * That distinction is the whole reason it is safe to apply to authentication:
 * a revoked, blocked or expired session is still caught on the very next
 * request, exactly as before.
 *
 * What it removes is repetition WITHIN one render. The staff consoles guard
 * twice — `requireAdmin()` in `admin/layout.tsx` and again in `admin/page.tsx`
 * — because a layout and its page are independent Server Components. That was
 * two identical session lookups per navigation, and the same pattern holds for
 * the creator and evaluator consoles.
 *
 * It also makes `validateAndTouch`'s presence write happen once per request
 * rather than once per guard call.
 */
export const getSessionUser = cache(async function getSessionUser() {
  try {
    const token = await readSessionToken();
    if (!token) return null;

    const session = await prisma.session.findUnique({
      where: { token },
      select: {
        token: true,
        expiresAt: true,
        user: {
          select: {
            ...SESSION_USER_SELECT,
            membership: { select: MEMBERSHIP_SELECT },
          },
        },
      },
    });

    if (!session) return null;
    if (!(await validateAndTouch(session))) return null;

    return session.user;
  } catch {
    return null;
  }
});

/**
 * As `getSessionUser`, but additionally loads the squad roster.
 * Use ONLY where the roster is actually rendered (currently /team).
 */
export async function getSessionUserWithTeamRoster() {
  try {
    const token = await readSessionToken();
    if (!token) return null;

    const session = await prisma.session.findUnique({
      where: { token },
      select: {
        token: true,
        expiresAt: true,
        user: {
          select: {
            ...SESSION_USER_SELECT,
            membership: {
              select: {
                ...MEMBERSHIP_SELECT,
                team: {
                  select: {
                    ...MEMBERSHIP_SELECT.team.select,
                    members: {
                      select: {
                        id: true,
                        userId: true,
                        role: true,
                        slot: true,
                        joinedAt: true,
                        // Roster display only — never passwordHash.
                        user: { select: { id: true, username: true, email: true } },
                      },
                      orderBy: { slot: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session) return null;
    if (!(await validateAndTouch(session))) return null;

    return session.user;
  } catch {
    return null;
  }
}

/**
 * Destroys the active server session and clears the cookie.
 */
export async function destroySession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      await prisma.session.delete({ where: { token } }).catch(() => {});
      cookieStore.delete(SESSION_COOKIE_NAME);
    }
  } catch {
    // Ignore error on teardown
  }
}
