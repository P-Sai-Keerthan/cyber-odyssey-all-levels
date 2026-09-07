/**
 * Phase 18 — Authentication Approval Flow + Hydration Hardening Test Suite
 *
 * Tests the complete state machine:
 * Registration -> PENDING_APPROVAL -> Session retention -> Creator review
 * -> APPROVED/ACTIVE -> Notification -> Role portal entry.
 * Also validates concurrency, rejection, blocking, RBAC guards, and deterministic hydration.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import {
  registerParticipantAction,
  loginAction,
  getAccountApprovalStatusAction,
} from '@/lib/actions/auth-actions';
import {
  approveStaffAction,
  rejectStaffAction,
  getPendingStaffAction,
  blockAccountAction,
} from '@/lib/actions/creator-actions';
import {
  requireParticipant,
  requireEvaluator,
  requireAdmin,
  requireCreator,
} from '@/lib/auth/guards';
import {
  formatDate,
  formatNumericDate,
  formatTime,
  formatShortTime,
  formatDateTime,
  formatShortDateTime,
} from '@/lib/utils/date-formatter';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

let creatorUser: { id: string; email: string; username: string };
let testCookieToken: string | null = null;

// Mock next/headers cookies
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    get: vi.fn().mockImplementation((name: string) => {
      if (name === 'cyber_session' && testCookieToken) {
        return { value: testCookieToken };
      }
      return undefined;
    }),
    set: vi.fn().mockImplementation((name: string, value: string) => {
      if (name === 'cyber_session') {
        testCookieToken = value;
      }
    }),
    delete: vi.fn().mockImplementation((name: string) => {
      if (name === 'cyber_session') {
        testCookieToken = null;
      }
    }),
  })),
}));

// Mock next/navigation redirect to capture redirects
const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe('Phase 18 — Staff Approval Lifecycle & Hydration Hardening', () => {
  beforeAll(async () => {
    // Create Creator user fixture
    const pwd = await hashPassword('CreatorSecurePassword123!');
    creatorUser = await prisma.user.upsert({
      where: { email: 'phase18_creator@example.com' },
      update: { status: 'ACTIVE', role: 'CREATOR' },
      create: {
        email: 'phase18_creator@example.com',
        username: 'p18_creator',
        passwordHash: pwd,
        role: 'CREATOR',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Cleanup users created during test
    await prisma.notification.deleteMany({
      where: { user: { email: { contains: 'p18_' } } },
    });
    await prisma.auditLog.deleteMany({
      where: { details: { contains: 'p18_' } },
    });
    await prisma.session.deleteMany({
      where: { user: { email: { contains: 'p18_' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: 'p18_' } },
    });
  });

  describe('1. Registration & Initial Pending Session Attachment', () => {
    it('registers an Evaluator -> creates PENDING_APPROVAL user with session cookie', async () => {
      testCookieToken = null;
      const formData = new FormData();
      formData.append('email', 'p18_evaluator1@example.com');
      formData.append('username', 'p18_eval1');
      formData.append('password', 'ValidPassw0rd1234!');
      formData.append('confirmPassword', 'ValidPassw0rd1234!');
      formData.append('accountType', 'EVALUATOR');

      const result = await registerParticipantAction(formData);

      expect(result.success).toBe(true);
      expect(result.redirectTo).toContain('/auth/pending-approval');
      expect(testCookieToken).toBeTruthy();

      const user = await prisma.user.findUnique({
        where: { email: 'p18_evaluator1@example.com' },
      });
      expect(user).toBeTruthy();
      expect(user?.role).toBe('EVALUATOR');
      expect(user?.status).toBe('PENDING_APPROVAL');

      // Session in database
      const dbSession = await prisma.session.findUnique({
        where: { token: testCookieToken! },
      });
      expect(dbSession).toBeTruthy();
      expect(dbSession?.userId).toBe(user?.id);
    });

    it('registers an Admin -> creates PENDING_APPROVAL user with session cookie', async () => {
      testCookieToken = null;
      const formData = new FormData();
      formData.append('email', 'p18_admin1@example.com');
      formData.append('username', 'p18_admin1');
      formData.append('password', 'ValidPassw0rd1234!');
      formData.append('confirmPassword', 'ValidPassw0rd1234!');
      formData.append('accountType', 'ADMIN');

      const result = await registerParticipantAction(formData);

      expect(result.success).toBe(true);
      expect(result.redirectTo).toContain('/auth/pending-approval');
      expect(testCookieToken).toBeTruthy();

      const user = await prisma.user.findUnique({
        where: { email: 'p18_admin1@example.com' },
      });
      expect(user?.role).toBe('ADMIN');
      expect(user?.status).toBe('PENDING_APPROVAL');
    });

    it('registers a Participant -> creates ACTIVE user and routes to /team/onboarding', async () => {
      testCookieToken = null;
      const formData = new FormData();
      formData.append('email', 'p18_participant1@example.com');
      formData.append('username', 'p18_part1');
      formData.append('password', 'ValidPassw0rd1234!');
      formData.append('confirmPassword', 'ValidPassw0rd1234!');
      formData.append('accountType', 'PARTICIPANT');

      const result = await registerParticipantAction(formData);

      expect(result.success).toBe(true);
      expect(result.redirectTo).toBe('/team/onboarding');

      const user = await prisma.user.findUnique({
        where: { email: 'p18_participant1@example.com' },
      });
      expect(user?.role).toBe('PARTICIPANT');
      expect(user?.status).toBe('ACTIVE');
    });
  });

  describe('2. Pending Account Login & Status Probe', () => {
    it('allows a pending Evaluator to log in with valid credentials and attaches pending session', async () => {
      testCookieToken = null;
      const formData = new FormData();
      formData.append('identifier', 'p18_evaluator1@example.com');
      formData.append('password', 'ValidPassw0rd1234!');

      const result = await loginAction(formData);

      expect(result.success).toBe(true);
      expect(result.redirectTo).toContain('/auth/pending-approval');
      expect(testCookieToken).toBeTruthy();
    });

    it('getAccountApprovalStatusAction returns PENDING_APPROVAL for pending staff session', async () => {
      const probe = await getAccountApprovalStatusAction();
      expect(probe.success).toBe(true);
      expect(probe.data?.status).toBe('PENDING_APPROVAL');
      expect(probe.data?.role).toBe('EVALUATOR');
    });
  });

  describe('3. Route Guards Reject Pending Accounts from Protected Portals', () => {
    it('requireEvaluator() redirects pending Evaluator to /auth/pending-approval', async () => {
      redirectMock.mockClear();
      await expect(requireEvaluator()).rejects.toThrow(
        'REDIRECT:/auth/pending-approval?role=Evaluator',
      );
    });

    it('requireAdmin() redirects pending Evaluator to /auth/pending-approval', async () => {
      redirectMock.mockClear();
      await expect(requireAdmin()).rejects.toThrow('REDIRECT:/auth/pending-approval?role=Admin');
    });

    it('requireParticipant() redirects pending Evaluator to /auth/pending-approval', async () => {
      redirectMock.mockClear();
      await expect(requireParticipant()).rejects.toThrow('REDIRECT:/auth/pending-approval');
    });

    it('requireCreator() redirects pending Evaluator to /auth/pending-approval', async () => {
      redirectMock.mockClear();
      await expect(requireCreator()).rejects.toThrow('REDIRECT:/auth/pending-approval');
    });
  });

  describe('4. Creator Staff Approval Flow & Notification Generation', () => {
    let pendingEvaluatorUser: { id: string; email: string; username: string };

    beforeAll(async () => {
      pendingEvaluatorUser = (await prisma.user.findUnique({
        where: { email: 'p18_evaluator1@example.com' },
      }))!;
    });

    it('Creator retrieves pending staff list including the new Evaluator and Admin', async () => {
      testCookieToken = await createSession(creatorUser.id);
      const pendingList = await getPendingStaffAction();

      expect(pendingList.success).toBe(true);
      const ids = pendingList.data?.map((u) => u.id);
      expect(ids).toContain(pendingEvaluatorUser.id);
    });

    it('Creator approves Evaluator: status becomes ACTIVE, Notification is generated, and AuditLog is created', async () => {
      testCookieToken = await createSession(creatorUser.id);

      const approval = await approveStaffAction(pendingEvaluatorUser.id);
      expect(approval.success).toBe(true);

      // Verify User status in DB
      const user = await prisma.user.findUnique({
        where: { id: pendingEvaluatorUser.id },
      });
      expect(user?.status).toBe('ACTIVE');

      // Verify Notification created with required role & portal information (Part 7)
      const notification = await prisma.notification.findFirst({
        where: { userId: pendingEvaluatorUser.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification).toBeTruthy();
      expect(notification?.title).toBe('Account Approved');
      expect(notification?.message).toContain('Evaluator');
      expect(notification?.message).toContain('Evaluator Portal');

      // Verify AuditLog created
      const audit = await prisma.auditLog.findFirst({
        where: { targetId: pendingEvaluatorUser.id, action: 'STAFF_APPROVED' },
      });
      expect(audit).toBeTruthy();
      expect(audit?.actorId).toBe(creatorUser.id);
    });

    it('Evaluator session immediately detects ACTIVE status via getAccountApprovalStatusAction and routes to /evaluator', async () => {
      // Switch active session to the Evaluator
      testCookieToken = await createSession(pendingEvaluatorUser.id);

      const probe = await getAccountApprovalStatusAction();
      expect(probe.success).toBe(true);
      expect(probe.data?.status).toBe('ACTIVE');
      expect(probe.data?.role).toBe('EVALUATOR');
      expect(probe.data?.destination).toBe('/evaluator');
    });

    it('Evaluator can now enter /evaluator through requireEvaluator() guard', async () => {
      testCookieToken = await createSession(pendingEvaluatorUser.id);
      const user = await requireEvaluator();
      expect(user).toBeTruthy();
      expect(user.id).toBe(pendingEvaluatorUser.id);
      expect(user.role).toBe('EVALUATOR');
      expect(user.status).toBe('ACTIVE');
    });

    it('Active Evaluator is strictly rejected from /creator and /admin', async () => {
      testCookieToken = await createSession(pendingEvaluatorUser.id);

      redirectMock.mockClear();
      await expect(requireCreator()).rejects.toThrow('REDIRECT:/evaluator');

      redirectMock.mockClear();
      await expect(requireAdmin()).rejects.toThrow('REDIRECT:/evaluator');
    });
  });

  describe('5. Creator Admin Approval Flow', () => {
    let pendingAdminUser: { id: string; email: string };

    beforeAll(async () => {
      pendingAdminUser = (await prisma.user.findUnique({
        where: { email: 'p18_admin1@example.com' },
      }))!;
    });

    it('Creator approves Admin: status becomes ACTIVE and Notification is generated', async () => {
      testCookieToken = await createSession(creatorUser.id);

      const approval = await approveStaffAction(pendingAdminUser.id);
      expect(approval.success).toBe(true);

      const user = await prisma.user.findUnique({
        where: { id: pendingAdminUser.id },
      });
      expect(user?.status).toBe('ACTIVE');

      const notification = await prisma.notification.findFirst({
        where: { userId: pendingAdminUser.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification).toBeTruthy();
      expect(notification?.title).toBe('Account Approved');
      expect(notification?.message).toContain('Administrator');
      expect(notification?.message).toContain('Admin Portal');
    });

    it('Admin session immediately detects ACTIVE status and allows /admin access', async () => {
      testCookieToken = await createSession(pendingAdminUser.id);

      const probe = await getAccountApprovalStatusAction();
      expect(probe.success).toBe(true);
      expect(probe.data?.status).toBe('ACTIVE');
      expect(probe.data?.role).toBe('ADMIN');
      expect(probe.data?.destination).toBe('/admin');

      const user = await requireAdmin();
      expect(user.id).toBe(pendingAdminUser.id);
      expect(user.role).toBe('ADMIN');
    });

    it('Active Admin is strictly rejected from /creator', async () => {
      testCookieToken = await createSession(pendingAdminUser.id);
      redirectMock.mockClear();
      await expect(requireCreator()).rejects.toThrow('REDIRECT:/admin');
    });
  });

  describe('6. Rejection, Blocking & Session Invalidation', () => {
    it('Creator rejects a pending staff account -> status becomes REJECTED, session invalidated', async () => {
      // Create new pending user to reject
      const pwd = await hashPassword('RejectPassw0rd123!');
      const rejectUser = await prisma.user.create({
        data: {
          email: 'p18_reject_test@example.com',
          username: 'p18_reject_user',
          passwordHash: pwd,
          role: 'EVALUATOR',
          status: 'PENDING_APPROVAL',
        },
      });

      const userSessionToken = await createSession(rejectUser.id);

      // Creator rejects
      testCookieToken = await createSession(creatorUser.id);
      const res = await rejectStaffAction(
        rejectUser.id,
        'Qualifications do not meet event criteria.',
      );
      expect(res.success).toBe(true);

      const updated = await prisma.user.findUnique({ where: { id: rejectUser.id } });
      expect(updated?.status).toBe('REJECTED');

      // Old session was deleted in database
      const dbSession = await prisma.session.findUnique({ where: { token: userSessionToken } });
      expect(dbSession).toBeNull();

      // Login attempt is rejected
      const formData = new FormData();
      formData.append('identifier', 'p18_reject_test@example.com');
      formData.append('password', 'RejectPassw0rd123!');
      const loginRes = await loginAction(formData);
      expect(loginRes.success).toBe(false);
      expect(loginRes.error).toContain('not approved');
    });

    it('Creator blocks an active user -> session is deleted immediately and login is refused', async () => {
      const activeUser = (await prisma.user.findUnique({
        where: { email: 'p18_evaluator1@example.com' },
      }))!;

      const userToken = await createSession(activeUser.id);

      // Creator blocks
      testCookieToken = await createSession(creatorUser.id);
      const blockRes = await blockAccountAction(activeUser.id, 'Security violation.');
      expect(blockRes.success).toBe(true);

      // Session row deleted
      const sessionRow = await prisma.session.findUnique({ where: { token: userToken } });
      expect(sessionRow).toBeNull();

      // User status is BLOCKED
      const dbUser = await prisma.user.findUnique({ where: { id: activeUser.id } });
      expect(dbUser?.status).toBe('BLOCKED');

      // Login is refused
      const formData = new FormData();
      formData.append('identifier', 'p18_evaluator1@example.com');
      formData.append('password', 'ValidPassw0rd1234!');
      const loginRes = await loginAction(formData);
      expect(loginRes.success).toBe(false);
      expect(loginRes.error).toContain('blocked');
    });
  });

  describe('7. Concurrency & Double Approval Protection', () => {
    it('prevents double approval on already active account', async () => {
      const activeAdmin = (await prisma.user.findUnique({
        where: { email: 'p18_admin1@example.com' },
      }))!;

      testCookieToken = await createSession(creatorUser.id);
      const secondApproval = await approveStaffAction(activeAdmin.id);

      expect(secondApproval.success).toBe(false);
      expect(secondApproval.error).toBe('Account is already active and approved.');
    });

    it('non-Creator cannot approve staff accounts', async () => {
      const partUser = (await prisma.user.findUnique({
        where: { email: 'p18_participant1@example.com' },
      }))!;

      testCookieToken = await createSession(partUser.id);
      const unauthApproval = await approveStaffAction(partUser.id);

      expect(unauthApproval.success).toBe(false);
      expect(unauthApproval.error).toContain('Unauthorized');
    });
  });

  describe('8. Deterministic Date/Time Formatting & Hydration Safety', () => {
    const fixedUtcTime = new Date('2026-08-31T18:30:00.000Z');

    it('formatDate outputs exact deterministic string regardless of local machine timezone', () => {
      expect(formatDate(fixedUtcTime)).toBe('Aug 31, 2026');
    });

    it('formatNumericDate outputs exact deterministic MM/DD/YYYY', () => {
      expect(formatNumericDate(fixedUtcTime)).toBe('08/31/2026');
    });

    it('formatTime outputs exact deterministic 24-hour time in UTC', () => {
      expect(formatTime(fixedUtcTime)).toBe('18:30:00');
    });

    it('formatShortTime outputs exact deterministic HH:MM in UTC', () => {
      expect(formatShortTime(fixedUtcTime)).toBe('18:30');
    });

    it('formatDateTime outputs exact deterministic timestamp in UTC', () => {
      expect(formatDateTime(fixedUtcTime)).toBe('Aug 31, 2026, 18:30:00');
    });

    it('formatShortDateTime outputs exact deterministic short timestamp in UTC', () => {
      expect(formatShortDateTime(fixedUtcTime)).toBe('Aug 31, 2026, 18:30');
    });

    it('handles null and invalid dates gracefully with deterministic fallbacks', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatDate('invalid-date')).toBe('—');
      expect(formatDateTime(undefined, 'N/A')).toBe('N/A');
    });
  });
});
