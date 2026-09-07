/**
 * Account Type guidance <-> backend behaviour contract.
 *
 * The Create Account form tells the user, before they submit, what will happen
 * to the account they are about to create:
 *
 *   Participant          -> "Use the same email address you registered with on Unstop."
 *   Any other type       -> "Creator approval is required for this account type."
 *
 * A message like that is only worth showing if it is true. These tests drive the
 * REAL `registerParticipantAction` once per account type offered in the dropdown
 * and assert that the resulting account status is the one the note promised —
 * so the note cannot quietly drift away from the authorization it describes.
 *
 * They also pin the two things the note must never become: a way to skip
 * approval, and a way to self-assign CREATOR.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  ACCOUNT_TYPE_OPTIONS,
  requiresCreatorApproval,
  type AccountType,
} from '@/components/auth/account-type-selector';
import { registerParticipantAction } from '@/lib/actions/auth-actions';

const EMAIL_PREFIX = 'atg_';
const TEST_PASSWORD = 'GuidanceContract123!';

let testCookieToken: string | null = null;

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

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

async function register(accountType: string, slug: string) {
  testCookieToken = null;
  const formData = new FormData();
  formData.append('email', `${EMAIL_PREFIX}${slug}@example.com`);
  formData.append('username', `${EMAIL_PREFIX}${slug}`);
  formData.append('password', TEST_PASSWORD);
  formData.append('confirmPassword', TEST_PASSWORD);
  formData.append('accountType', accountType);
  return registerParticipantAction(formData);
}

async function cleanup() {
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: EMAIL_PREFIX } } },
  });
  await prisma.auditLog.deleteMany({
    where: { details: { contains: EMAIL_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describe('Account Type note matches the account status the server actually assigns', () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it.each(ACCOUNT_TYPE_OPTIONS.map((option) => option.type))(
    'creates a %s account in the status its note promises',
    async (type: AccountType) => {
      const slug = type.toLowerCase();
      const result = await register(type, slug);
      expect(result.success).toBe(true);

      const user = await prisma.user.findUnique({
        where: { email: `${EMAIL_PREFIX}${slug}@example.com` },
        select: { role: true, status: true },
      });

      expect(user?.role).toBe(type);

      if (requiresCreatorApproval(type)) {
        // The form said approval is required, so the account must not be usable yet.
        expect(user?.status).toBe('PENDING_APPROVAL');
        expect(user?.status).not.toBe('ACTIVE');
        expect(result.redirectTo).toContain('/auth/pending-approval');
      } else {
        // The form promised no approval step, so the account must be usable now.
        expect(user?.status).toBe('ACTIVE');
        expect(result.redirectTo).toBe('/team/onboarding');
      }
    },
  );

  it('holds every account type the note flags for approval, and only those', async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { role: true, status: true },
    });

    // Recomputed from the database rather than from the loop above, so a status
    // changed by a later step would still be caught.
    const heldForApproval = users
      .filter((u) => u.status === 'PENDING_APPROVAL')
      .map((u) => u.role)
      .sort();
    const notedForApproval = ACCOUNT_TYPE_OPTIONS.map((o) => o.type)
      .filter(requiresCreatorApproval)
      .sort();

    expect(heldForApproval).toEqual(notedForApproval);
  });

  it('refuses to let the signup form self-assign the CREATOR role', async () => {
    // The dropdown does not offer Creator, but the form field is client-supplied
    // and a crafted request can carry anything. The server must downgrade it.
    const result = await register('CREATOR', 'creator_attempt');
    expect(result.success).toBe(true);

    const user = await prisma.user.findUnique({
      where: { email: `${EMAIL_PREFIX}creator_attempt@example.com` },
      select: { role: true, status: true },
    });

    expect(user?.role).toBe('PARTICIPANT');
    expect(user?.role).not.toBe('CREATOR');
    expect(user?.status).toBe('ACTIVE');
  });

  it('ignores an unrecognised account type rather than trusting it', async () => {
    const result = await register('SUPERUSER', 'bogus');
    expect(result.success).toBe(true);

    const user = await prisma.user.findUnique({
      where: { email: `${EMAIL_PREFIX}bogus@example.com` },
      select: { role: true, status: true },
    });

    expect(user?.role).toBe('PARTICIPANT');
    expect(user?.status).toBe('ACTIVE');
  });

  it('records a Creator-reviewable request for each account held for approval', async () => {
    // The note promises a Creator will review the request; that review queue is
    // fed by status PENDING_APPROVAL plus the STAFF_SIGNUP_REQUESTED audit entry.
    const pending = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX }, status: 'PENDING_APPROVAL' },
      select: { id: true },
    });

    expect(pending.length).toBe(
      ACCOUNT_TYPE_OPTIONS.map((o) => o.type).filter(requiresCreatorApproval).length,
    );

    for (const user of pending) {
      const audit = await prisma.auditLog.findFirst({
        where: { targetId: user.id, action: 'STAFF_SIGNUP_REQUESTED' },
      });
      expect(audit).toBeTruthy();
    }
  });
});
