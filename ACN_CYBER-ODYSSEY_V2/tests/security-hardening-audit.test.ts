import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import * as sessionModule from '@/lib/auth/session';
import * as portalSettingsModule from '@/lib/event/portal-settings';
import { loginAction } from '@/lib/actions/auth-actions';
import { submitInvestigationAction } from '@/lib/actions/submission-actions';
import { saveEvaluationAction } from '@/lib/actions/evaluator-actions';
import {
  blockAccountAction,
  deleteAccountAction,
  getAccountsAction,
  getTeamsAction,
} from '@/lib/actions/creator-actions';
import { uploadOrReplaceLevelResourceAction } from '@/lib/actions/creator-resource-actions';
import { createAnnouncementAction } from '@/lib/actions/admin-actions';
import { saveSubmissionFile, validateSubmissionMagicBytes } from '@/lib/storage/submission-storage';
import { sanitizeResourceFilename } from '@/lib/event/level-resources';
import { hashPassword } from '@/lib/auth/password';
import { resetEvaluationCriteria } from './helpers/evaluation-criteria';

/**
 * A Level 2 final answer that satisfies the server-side rule.
 *
 * Level 2 submissions now require an attacker and a proof of at least 50 words,
 * validated in `performSubmission` rather than only in the browser — so a test
 * that posts files alone is correctly rejected. These constants keep every
 * existing case exercising the path it was written to exercise.
 */
const LEVEL2_ATTACKER = 'Jordan Bowen';
const LEVEL2_PROOF =
  'The attacker authenticated from 10.24.20.14 at 2026-09-05T11:42:03Z using the harvested account nexora/jbowen, then failed nine consecutive login attempts against DC-PRIMARY before succeeding, mounted the ORION share, copied the dataset to a removable USB device registered to the same workstation, and finally cleared the security event log; CCTV places the same badge in the lab during that exact window.';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

interface TestUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: string;
  status: string;
}

interface TestTeam {
  id: string;
  name: string;
  code: string;
  passwordHash: string;
  creatorId: string;
}

type SessionUser = Awaited<ReturnType<typeof sessionModule.getSessionUser>>;

describe('Phase 14 — Security Hardening, Bug Hunt & Vulnerability Audit Test Suite', () => {
  let creatorUser: TestUser;
  let adminUser: TestUser;
  let evaluatorUser: TestUser;
  let participant1: TestUser;
  let participant2: TestUser;
  let team1: TestTeam;
  let team2: TestTeam;

  beforeEach(async () => {
    // The criteria table is global state that decides a level's maximum score,
    // and other suites replace it. Establish it here rather than inherit it.
    await resetEvaluationCriteria();
    vi.restoreAllMocks();

    // Clean DB
    await prisma.notification.deleteMany();
    await prisma.announcement.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.evaluation.deleteMany();
    await prisma.submissionFile.deleteMany();
    await prisma.submission.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.team.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.levelResource.deleteMany();

    const pwdHash = await hashPassword('CyberOdysseySecure2026!');

    // 1. Creator
    creatorUser = await prisma.user.create({
      data: {
        email: 'creator_sec@acn.org',
        username: 'creator_sec',
        passwordHash: pwdHash,
        role: 'CREATOR',
        status: 'ACTIVE',
      },
    });

    // 2. Admin
    adminUser = await prisma.user.create({
      data: {
        email: 'admin_sec@acn.org',
        username: 'admin_sec',
        passwordHash: pwdHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    // 3. Evaluator
    evaluatorUser = await prisma.user.create({
      data: {
        email: 'evaluator_sec@acn.org',
        username: 'evaluator_sec',
        passwordHash: pwdHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });

    // 4. Participant 1
    participant1 = await prisma.user.create({
      data: {
        email: 'part1_sec@acn.org',
        username: 'part1_sec',
        passwordHash: pwdHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    // 5. Participant 2 (different squad)
    participant2 = await prisma.user.create({
      data: {
        email: 'part2_sec@acn.org',
        username: 'part2_sec',
        passwordHash: pwdHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    // 6. Team 1
    team1 = await prisma.team.create({
      data: {
        name: 'Cyber Sentinel Squad',
        code: 'SNTL-1111',
        passwordHash: pwdHash,
        creatorId: participant1.id,
      },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team1.id,
        userId: participant1.id,
        role: 'CREATOR',
      },
    });

    // 7. Team 2
    team2 = await prisma.team.create({
      data: {
        name: 'Dark Matter Squad',
        code: 'DARK-2222',
        passwordHash: pwdHash,
        creatorId: participant2.id,
      },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team2.id,
        userId: participant2.id,
        role: 'CREATOR',
      },
    });

    // Ensure Level 2 is ready
    await prisma.levelState.upsert({
      where: { levelNumber: 2 },
      update: { status: 'READY', remainingSeconds: 3600 },
      create: {
        levelNumber: 2,
        name: "LEVEL 2 — THE BOAR'S MARK",
        codename: 'THE_BOARS_MARK',
        status: 'READY',
        remainingSeconds: 3600,
      },
    });
  });

  // =========================================================================
  // 1. AUTHENTICATION & BRUTE-FORCE DEFENSE
  // =========================================================================
  describe('1. Authentication & Brute-Force Defense', () => {
    it('rejects unauthenticated requests safely', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(null);
      const fd = new FormData();
      fd.append('level', '2');
      fd.append('attacker', LEVEL2_ATTACKER);
      fd.append('proof', LEVEL2_PROOF);
      fd.append('file', new File(['%PDF-1.4 sample'], 'report.pdf', { type: 'application/pdf' }));

      const res = await submitInvestigationAction(fd);
      expect(res.success).toBe(false);
      expect(res.error).toContain('session has expired');
    });

    it('locks account after 10 consecutive failed login attempts', async () => {
      // Simulate 10 failed login attempts
      for (let i = 0; i < 10; i++) {
        const fd = new FormData();
        fd.append('identifier', participant1.email);
        fd.append('password', 'WrongPassword123!');
        const res = await loginAction(fd);
        expect(res.success).toBe(false);
      }

      // Verify failed login count in DB
      const userAfterFails = await prisma.user.findUnique({
        where: { id: participant1.id },
      });
      expect(userAfterFails?.failedLoginCount).toBe(10);

      // The lockout must carry its own absolute expiry (SEC-17-02), not be
      // derived from activity timestamps.
      expect(userAfterFails?.lockedUntil).toBeInstanceOf(Date);
      expect(userAfterFails!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // Attempt 11th login (even with correct password) -> should be locked
      const fdValid = new FormData();
      fdValid.append('identifier', participant1.email);
      fdValid.append('password', 'CyberOdysseySecure2026!');
      const lockedRes = await loginAction(fdValid);

      expect(lockedRes.success).toBe(false);
      expect(lockedRes.error).toContain('temporarily locked');
    });

    it('does not extend an active lockout when the account owner stays active (SEC-17-02)', async () => {
      // Lock the account.
      for (let i = 0; i < 10; i++) {
        const fd = new FormData();
        fd.append('identifier', participant1.email);
        fd.append('password', 'WrongPassword123!');
        await loginAction(fd);
      }

      const locked = await prisma.user.findUniqueOrThrow({ where: { id: participant1.id } });
      const originalExpiry = locked.lockedUntil!.getTime();

      // Simulate ordinary session activity, which refreshes lastActivityAt.
      // Under the previous activity-derived window this renewed the lockout,
      // letting an attacker keep a participant out of the event indefinitely.
      await prisma.user.update({
        where: { id: participant1.id },
        data: { lastActivityAt: new Date(Date.now() + 10 * 60 * 1000) },
      });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: participant1.id } });
      expect(after.lockedUntil!.getTime()).toBe(originalExpiry);
    });

    it('clears the lockout and failure counter after a successful sign-in', async () => {
      // Five failures, then a correct password.
      for (let i = 0; i < 5; i++) {
        const fd = new FormData();
        fd.append('identifier', participant1.email);
        fd.append('password', 'WrongPassword123!');
        await loginAction(fd);
      }

      const fdValid = new FormData();
      fdValid.append('identifier', participant1.email);
      fdValid.append('password', 'CyberOdysseySecure2026!');
      const res = await loginAction(fdValid);
      expect(res.success).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: participant1.id } });
      expect(user.failedLoginCount).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });

    it('expired lockouts grant a fresh attempt window rather than re-locking immediately', async () => {
      // Lock, then move the expiry into the past.
      for (let i = 0; i < 10; i++) {
        const fd = new FormData();
        fd.append('identifier', participant1.email);
        fd.append('password', 'WrongPassword123!');
        await loginAction(fd);
      }
      await prisma.user.update({
        where: { id: participant1.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });

      // One more wrong password must NOT immediately re-lock the account: the
      // counter restarts from the expired lock.
      const fd = new FormData();
      fd.append('identifier', participant1.email);
      fd.append('password', 'WrongPassword123!');
      const res = await loginAction(fd);

      expect(res.success).toBe(false);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: participant1.id } });
      expect(user.failedLoginCount).toBe(1);
      expect(user.lockedUntil).toBeNull();
    });

    it('rejects blocked accounts at login', async () => {
      await prisma.user.update({
        where: { id: participant1.id },
        data: { status: 'BLOCKED' },
      });

      const fd = new FormData();
      fd.append('identifier', participant1.email);
      fd.append('password', 'CyberOdysseySecure2026!');
      const res = await loginAction(fd);

      expect(res.success).toBe(false);
      expect(res.error).toContain('currently blocked');
    });

    it('routes pending staff accounts to pending approval portal on authentication', async () => {
      const pendingStaff = await prisma.user.create({
        data: {
          email: 'pending_eval@acn.org',
          username: 'pending_eval',
          passwordHash: await hashPassword('CyberOdysseySecure2026!'),
          role: 'EVALUATOR',
          status: 'PENDING_APPROVAL',
        },
      });

      const fd = new FormData();
      fd.append('identifier', pendingStaff.email);
      fd.append('password', 'CyberOdysseySecure2026!');
      const res = await loginAction(fd);

      expect(res.success).toBe(true);
      expect(res.redirectTo).toContain('/auth/pending-approval');
    });
  });

  // =========================================================================
  // 2. STRICT ROLE-BASED ACCESS CONTROL & PRIVILEGE ESCALATION PREVENTION
  // =========================================================================
  describe('2. Strict RBAC & Privilege Escalation Prevention', () => {
    it('prevents Participant from executing Creator actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participant1 as unknown as SessionUser,
      );

      const blockRes = await blockAccountAction(participant2.id);
      expect(blockRes.success).toBe(false);
      expect(blockRes.error).toContain('Unauthorized. Creator privileges required');

      const deleteRes = await deleteAccountAction(participant2.id);
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toContain('Unauthorized. Creator privileges required');
    });

    it('prevents Admin from executing Creator-only actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );

      const blockRes = await blockAccountAction(participant1.id);
      expect(blockRes.success).toBe(false);
      expect(blockRes.error).toContain('Unauthorized. Creator privileges required');
    });

    it('prevents Evaluator from executing Creator-only actions', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluatorUser as unknown as SessionUser,
      );

      const deleteRes = await deleteAccountAction(participant1.id);
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toContain('Unauthorized. Creator privileges required');
    });

    it('prevents Participant from submitting evaluations or modifying scores', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participant1 as unknown as SessionUser,
      );

      const res = await saveEvaluationAction({
        submissionId: 'fake_sub_id',
        score: 100,
        status: 'EVALUATED',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('does not have permission to access the evaluation console');
    });

    it('prevents non-Creators from managing Level 2 resources', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );

      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd.append('file', new File(['PK\x03\x04 zip'], 'evidence.zip', { type: 'application/zip' }));

      const res = await uploadOrReplaceLevelResourceAction(fd);
      expect(res.success).toBe(false);
      expect(res.error).toContain('does not have permission to manage competition resources');
    });
  });

  // =========================================================================
  // 3. INFORMATION EXPOSURE & SENSITIVE DATA PRIVACY
  // =========================================================================
  describe('3. Information Exposure & Sensitive Data Privacy', () => {
    it('never leaks passwordHash in getAccountsAction', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const res = await getAccountsAction();
      expect(res.success).toBe(true);
      const accounts = res.data?.accounts || [];

      for (const acc of accounts) {
        const item = acc as unknown as Record<string, unknown>;
        expect(item['passwordHash']).toBeUndefined();
        expect(item['password']).toBeUndefined();
      }
    });

    it('never leaks team joining code or passwordHash in public team queries', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const res = await getTeamsAction();
      expect(res.success).toBe(true);
      const teams = res.data?.teams || [];

      for (const t of teams) {
        const item = t as unknown as Record<string, unknown>;
        expect(item['passwordHash']).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // 4. FILE UPLOAD SECURITY, MAGIC BYTE VALIDATION & PATH TRAVERSAL DEFENSE
  // =========================================================================
  describe('4. File Upload Security & Magic Byte Validation', () => {
    it('validates authentic PDF magic bytes (%PDF)', () => {
      const validPdfBuffer = Buffer.from('%PDF-1.7 standard pdf header');
      expect(validateSubmissionMagicBytes(validPdfBuffer, '.pdf')).toBe(true);

      const fakePdfBuffer = Buffer.from('MZ\x90\x00 executable payload disguised as pdf');
      expect(validateSubmissionMagicBytes(fakePdfBuffer, '.pdf')).toBe(false);
    });

    it('validates authentic ZIP / DOCX magic bytes (PK\\x03\\x04)', () => {
      const validZipBuffer = Buffer.from('PK\x03\x04 zip file content');
      expect(validateSubmissionMagicBytes(validZipBuffer, '.zip')).toBe(true);
      expect(validateSubmissionMagicBytes(validZipBuffer, '.docx')).toBe(true);

      const fakeZipBuffer = Buffer.from('#!/bin/bash\nrm -rf /');
      expect(validateSubmissionMagicBytes(fakeZipBuffer, '.zip')).toBe(false);
    });

    it('rejects spoofed file upload with invalid magic bytes in saveSubmissionFile', async () => {
      const spoofedPdf = new File(
        ['MZ\x90\x00\x03\x00\x00\x00 binary executable disguised as pdf'],
        'malware.pdf',
        { type: 'application/pdf' },
      );

      const result = await saveSubmissionFile(spoofedPdf, 2, team1.id);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not match the');
    });

    it('neutralizes path traversal attempts in uploaded filenames', () => {
      const traversal1 = '../../../../etc/shadow';
      const clean1 = sanitizeResourceFilename(traversal1);
      expect(clean1).not.toContain('..');
      expect(clean1).not.toContain('/');
      expect(clean1).toBe('shadow');

      const traversal2 = '..\\..\\Windows\\System32\\cmd.exe';
      const clean2 = sanitizeResourceFilename(traversal2);
      expect(clean2).not.toContain('..');
      expect(clean2).not.toContain('\\');
      expect(clean2).toBe('cmd.exe');
    });
  });

  // =========================================================================
  // 5. EVALUATION, SCORING & DEADLINE INTEGRITY
  // =========================================================================
  describe('5. Evaluation, Scoring & Deadline Integrity', () => {
    it('rejects out-of-bounds evaluation scores (> 100 or < 0)', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluatorUser as unknown as SessionUser,
      );

      // Create submission for team 1
      const submission = await prisma.submission.create({
        data: {
          teamId: team1.id,
          userId: participant1.id,
          level: 2,
          status: 'SUBMITTED',
        },
      });

      // Score > dynamic maxScore (1000)
      const resHigh = await saveEvaluationAction({
        submissionId: submission.id,
        score: 1500,
        status: 'EVALUATED',
      });
      expect(resHigh.success).toBe(false);
      expect(resHigh.error).toContain('permitted range');

      // Score < 0
      const resLow = await saveEvaluationAction({
        submissionId: submission.id,
        score: -10,
        status: 'EVALUATED',
      });
      expect(resLow.success).toBe(false);
      expect(resLow.error).toContain('permitted range');
    });

    it('recalculates squad total score atomically on evaluation completion', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluatorUser as unknown as SessionUser,
      );

      const submission = await prisma.submission.create({
        data: {
          teamId: team1.id,
          userId: participant1.id,
          level: 2,
          status: 'SUBMITTED',
        },
      });

      const res = await saveEvaluationAction({
        submissionId: submission.id,
        score: 88,
        status: 'EVALUATED',
      });

      expect(res.success).toBe(true);

      // APPROVAL GATE: finalising an evaluation no longer publishes to the
      // leaderboard. The score is recorded on the evaluation and held at
      // PENDING_APPROVAL until an Admin approves it.
      const storedEval = await prisma.evaluation.findUniqueOrThrow({
        where: { submissionId: submission.id },
      });
      expect(storedEval.score).toBe(88);
      expect(storedEval.approvalStatus).toBe('PENDING_APPROVAL');

      const updatedTeam = await prisma.team.findUnique({
        where: { id: team1.id },
      });
      expect(updatedTeam?.score).toBe(0);
    });
  });

  // =========================================================================
  // 6. PORTAL OFFLINE ENFORCEMENT & ANNOUNCEMENT AUDIENCE INTEGRITY
  // =========================================================================
  describe('6. Portal Offline Enforcement & Announcement Audience Integrity', () => {
    it('strictly blocks participant submissions when portal is OFFLINE', async () => {
      vi.spyOn(portalSettingsModule, 'getPortalStatus').mockResolvedValue({
        isOnline: false,
        updatedAt: new Date(),
        updatedBy: null,
      });

      const participantUserObj = await prisma.user.findUnique({
        where: { id: participant1.id },
        include: {
          membership: {
            include: { team: true },
          },
        },
      });

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUserObj as unknown as SessionUser,
      );

      const fd = new FormData();
      fd.append('level', '2');
      fd.append('attacker', LEVEL2_ATTACKER);
      fd.append('proof', LEVEL2_PROOF);
      fd.append('file', new File(['%PDF-1.4 report'], 'report.pdf', { type: 'application/pdf' }));

      const res = await submitInvestigationAction(fd);
      expect(res.success).toBe(false);
      expect(res.error).toContain('offline');
    });

    it('delivers targeted notifications only to the specified audience', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );

      // Create Admin-targeted announcement
      const res = await createAnnouncementAction({
        title: 'Evaluator Briefing',
        content: 'Forensics scoring rubric updated for Level 2.',
        targetAudience: 'EVALUATORS',
        priority: 'HIGH',
      });

      expect(res.success).toBe(true);

      // Evaluator should have received a notification
      const evalNotif = await prisma.notification.findFirst({
        where: { userId: evaluatorUser.id },
      });
      expect(evalNotif).toBeDefined();
      expect(evalNotif?.title).toBe('Evaluator Briefing');

      // Participant should NOT have received a notification
      const partNotif = await prisma.notification.findFirst({
        where: { userId: participant1.id },
      });
      expect(partNotif).toBeNull();
    });
  });
});
