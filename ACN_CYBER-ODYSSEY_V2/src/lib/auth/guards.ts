import { redirect } from 'next/navigation';
import { getSessionUser, getSessionUserWithTeamRoster } from './session';

/**
 * Ensures user is authenticated. Redirects to /login if not.
 */
export async function requireAuth() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

/**
 * Ensures user is an authenticated participant with ACTIVE status and redirects based on team state:
 * - If pending approval -> redirects to /auth/pending-approval
 * - If not a participant, routes to the user's authorized portal (/admin, /creator, /evaluator, or /login)
 * - If on dashboard but has no team -> redirects to /team/onboarding
 */
export async function requireParticipant() {
  const user = await requireAuth();

  if (user.status === 'PENDING_APPROVAL') {
    const roleLabel =
      user.role === 'EVALUATOR' ? 'Evaluator' : user.role === 'ADMIN' ? 'Admin' : 'Staff';
    redirect(`/auth/pending-approval?role=${encodeURIComponent(roleLabel)}`);
  }

  if (user.status !== 'ACTIVE') {
    redirect('/login');
  }

  if (user.role !== 'PARTICIPANT') {
    if (user.role === 'CREATOR') {
      redirect('/creator');
    }
    if (user.role === 'ADMIN') {
      redirect('/admin');
    }
    if (user.role === 'EVALUATOR') {
      redirect('/evaluator');
    }
    redirect('/login');
  }

  // Check if portal is taken offline by Creator/Admin
  const { getPortalStatus } = await import('@/lib/event/portal-settings');
  const { isOnline } = await getPortalStatus();
  if (!isOnline) {
    redirect('/offline');
  }

  return user;
}

/**
 * As `requireParticipant`, but the returned user carries the full squad roster.
 *
 * Use ONLY on routes that actually render teammate details (/team). Every other
 * participant route uses `requireParticipant`, which omits the roster join —
 * see PERF-17-03 in src/lib/auth/session.ts.
 */
export async function requireParticipantWithRoster() {
  const user = await getSessionUserWithTeamRoster();

  if (!user) {
    redirect('/login');
  }

  if (user.status === 'PENDING_APPROVAL') {
    const roleLabel =
      user.role === 'EVALUATOR' ? 'Evaluator' : user.role === 'ADMIN' ? 'Admin' : 'Staff';
    redirect(`/auth/pending-approval?role=${encodeURIComponent(roleLabel)}`);
  }

  if (user.status !== 'ACTIVE') {
    redirect('/login');
  }

  if (user.role !== 'PARTICIPANT') {
    if (user.role === 'CREATOR') redirect('/creator');
    if (user.role === 'ADMIN') redirect('/admin');
    if (user.role === 'EVALUATOR') redirect('/evaluator');
    redirect('/login');
  }

  const { getPortalStatus } = await import('@/lib/event/portal-settings');
  const { isOnline } = await getPortalStatus();
  if (!isOnline) {
    redirect('/offline');
  }

  return user;
}

/**
 * Ensures user is an authenticated Creator with ACTIVE status.
 * Rejects unauthorized users (participants, evaluators, admins, or non-active accounts).
 */
export async function requireCreator() {
  const user = await requireAuth();

  if (user.status === 'PENDING_APPROVAL') {
    redirect('/auth/pending-approval?role=Staff');
  }

  if (user.status !== 'ACTIVE' || user.role !== 'CREATOR') {
    if (user.role === 'ADMIN') redirect('/admin');
    if (user.role === 'EVALUATOR') redirect('/evaluator');
    if (user.role === 'PARTICIPANT') redirect('/dashboard');
    redirect('/login');
  }

  return user;
}

/**
 * Ensures user is an authenticated Admin with ACTIVE status.
 * Rejects unauthorized users (participants, evaluators, creators, or non-active accounts).
 */
export async function requireAdmin() {
  const user = await requireAuth();

  if (user.status === 'PENDING_APPROVAL') {
    redirect('/auth/pending-approval?role=Admin');
  }

  if (user.status !== 'ACTIVE' || user.role !== 'ADMIN') {
    if (user.role === 'CREATOR') {
      redirect('/creator');
    }
    if (user.role === 'EVALUATOR') {
      redirect('/evaluator');
    }
    if (user.role === 'PARTICIPANT') {
      redirect('/dashboard');
    }
    redirect('/login');
  }

  return user;
}

/**
 * Ensures user is an authenticated Evaluator with ACTIVE status.
 * Rejects unauthorized users (participants, admins, creators, or non-active accounts).
 */
export async function requireEvaluator() {
  const user = await requireAuth();

  if (user.status === 'PENDING_APPROVAL') {
    redirect('/auth/pending-approval?role=Evaluator');
  }

  if (user.status !== 'ACTIVE' || user.role !== 'EVALUATOR') {
    if (user.role === 'CREATOR') redirect('/creator');
    if (user.role === 'ADMIN') redirect('/admin');
    if (user.role === 'PARTICIPANT') redirect('/dashboard');
    redirect('/login');
  }

  return user;
}
