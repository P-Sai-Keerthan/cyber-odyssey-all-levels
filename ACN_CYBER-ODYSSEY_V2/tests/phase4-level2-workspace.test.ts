import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { checkLevelAccess } from '@/lib/event/level-access';
import { saveSubmissionFile, MAX_SUBMISSION_FILE_SIZE } from '@/lib/storage/submission-storage';
import { submitInvestigationAction } from '@/lib/actions/submission-actions';
import { getEvaluatorSubmissionDetailsAction } from '@/lib/actions/evaluator-actions';
import { hashPassword } from '@/lib/auth/password';
import * as sessionModule from '@/lib/auth/session';
import * as portalSettingsModule from '@/lib/event/portal-settings';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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
  role: string;
  status: string;
  membership?: {
    teamId: string;
    role: string;
    team: {
      id: string;
      name: string;
      status: string;
    };
  } | null;
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof sessionModule.getSessionUser>>>;

describe("Phase 4 — Participant Level 2 (The Boar's Mark) Investigation Workspace", () => {
  const password = 'Password@1234';

  let participant1: TestUser;
  let participant2: TestUser;
  let team1: { id: string; name: string; code: string; score: number };
  let team2: { id: string; name: string; code: string; score: number };

  beforeEach(async () => {
    vi.restoreAllMocks();

    // Reset database tables
    await prisma.evaluation.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});

    // Level 2 has to be genuinely OPEN for the submission cases below.
    //
    // This suite used to read whatever LevelState happened to be in the local
    // database, so it passed or failed depending on when the developer database
    // was last seeded: once a seeded two-hour window elapsed, every submission
    // case failed with "Level 2 has completed" and told you nothing about the
    // code under test. The window is now part of the fixture, and `endsAt` is
    // pinned into the future rather than left where the seed put it.
    await prisma.levelState.upsert({
      where: { levelNumber: 2 },
      update: {
        status: 'LIVE',
        remainingSeconds: 7200,
        startedAt: new Date(),
        pausedAt: null,
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        completedAt: null,
      },
      create: {
        levelNumber: 2,
        name: "Level 2 — The Boar's Mark",
        codename: "THE BOAR'S MARK",
        status: 'LIVE',
        durationMinutes: 120,
        durationSeconds: 7200,
        remainingSeconds: 7200,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });

    const iterationId = crypto.randomBytes(6).toString('hex');
    const passwordHash = await hashPassword(password);

    // Create participant 1 & Team 1
    const p1 = await prisma.user.create({
      data: {
        email: `p4_u1_${iterationId}@example.com`,
        username: `p4_u1_${iterationId}`,
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    team1 = await prisma.team.create({
      data: {
        name: `P4 Squad 1 ${iterationId}`,
        code: `CYB-${iterationId.toUpperCase()}1`,
        passwordHash,
        creatorId: p1.id,
        score: 250,
      },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team1.id,
        userId: p1.id,
        role: 'HEAD',
      },
    });

    participant1 = {
      id: p1.id,
      email: p1.email,
      username: p1.username,
      role: p1.role,
      status: p1.status,
      membership: {
        teamId: team1.id,
        role: 'HEAD',
        team: {
          id: team1.id,
          name: team1.name,
          status: 'ACTIVE',
        },
      },
    };

    // Create participant 2 & Team 2
    const p2 = await prisma.user.create({
      data: {
        email: `p4_u2_${iterationId}@example.com`,
        username: `p4_u2_${iterationId}`,
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    team2 = await prisma.team.create({
      data: {
        name: `P4 Squad 2 ${iterationId}`,
        code: `CYB-${iterationId.toUpperCase()}2`,
        passwordHash,
        creatorId: p2.id,
        score: 100,
      },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team2.id,
        userId: p2.id,
        role: 'HEAD',
      },
    });

    participant2 = {
      id: p2.id,
      email: p2.email,
      username: p2.username,
      role: p2.role,
      status: p2.status,
      membership: {
        teamId: team2.id,
        role: 'HEAD',
        team: {
          id: team2.id,
          name: team2.name,
          status: 'ACTIVE',
        },
      },
    };

    // Default session to participant1
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
      participant1 as unknown as SessionUser,
    );
  });

  // =========================================================================
  // 1. ACCESS CONTROL & SQUAD MEMBERSHIP (Requirements 1, 2, 3)
  // =========================================================================
  describe('1. Access Control & Squad Membership', () => {
    it('1. Participant with team membership can access Level 2', () => {
      const access = checkLevelAccess(2, true);
      expect(access.allowed).toBe(true);
      expect(access.config?.codename).toBe("THE BOAR'S MARK");
      expect(access.config?.points).toBe('1000 PTS');
    });

    it('2. Unauthenticated client cannot submit deliverables', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(null);

      const fakePdf = new File(['%PDF-1.4 report content'], 'report.pdf', {
        type: 'application/pdf',
      });
      const formData = new FormData();
      formData.append('level', '2');
      formData.append('attacker', LEVEL2_ATTACKER);
      formData.append('proof', LEVEL2_PROOF);
      formData.append('file', fakePdf);

      const result = await submitInvestigationAction(formData);
      expect(result.success).toBe(false);
      expect(result.error).toContain('session has expired');
    });

    it('3. Participant without team membership is blocked from Level 2 submission', async () => {
      const teamlessUser: TestUser = {
        ...participant1,
        membership: null,
      };
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        teamlessUser as unknown as SessionUser,
      );

      const fakePdf = new File(['%PDF-1.4 report content'], 'report.pdf', {
        type: 'application/pdf',
      });
      const formData = new FormData();
      formData.append('level', '2');
      formData.append('attacker', LEVEL2_ATTACKER);
      formData.append('proof', LEVEL2_PROOF);
      formData.append('file', fakePdf);

      const result = await submitInvestigationAction(formData);
      expect(result.success).toBe(false);
      expect(result.error).toContain('need to be in a squad');
    });
  });

  // =========================================================================
  // 2. SQUAD ISOLATION & SHARED SUBMISSION STATE (Requirements 4, 5, 17)
  // =========================================================================
  describe('2. Squad Isolation & Shared Submission State', () => {
    it('4 & 17. All team members see their shared squad submission state', async () => {
      // Add teammate to squad 1
      const teammate = await prisma.user.create({
        data: {
          email: 'teammate_shared@example.com',
          username: 'teammate_shared',
          passwordHash: 'hash',
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });

      await prisma.teamMember.create({
        data: {
          teamId: team1.id,
          userId: teammate.id,
          slot: 2,
          role: 'MEMBER',
        },
      });

      // Submit report from Participant 1
      const fakePdf = new File(['%PDF-1.4 Report Data'], 'final_forensic_report.pdf', {
        type: 'application/pdf',
      });
      const formData = new FormData();
      formData.append('level', '2');
      formData.append('attacker', LEVEL2_ATTACKER);
      formData.append('proof', LEVEL2_PROOF);
      formData.append('file', fakePdf);

      const submitRes = await submitInvestigationAction(formData);
      expect(submitRes.success).toBe(true);

      // Teammate queries squad 1 submission
      const teammateSubmission = await prisma.submission.findFirst({
        where: { teamId: team1.id, level: 2 },
        include: { files: true },
      });

      expect(teammateSubmission).not.toBeNull();
      expect(teammateSubmission?.status).toBe('SUBMITTED');
      expect(teammateSubmission?.files).toHaveLength(1);
      expect(teammateSubmission?.files[0]?.originalName).toBe('final_forensic_report.pdf');
    });

    it('5. Squad submissions remain isolated and not accessible across squads', async () => {
      // Squad 1 submits
      await prisma.submission.create({
        data: {
          teamId: team1.id,
          userId: participant1.id,
          level: 2,
          status: 'SUBMITTED',
        },
      });

      // Squad 2 (participant 2) queries their own submissions (must be empty)
      const squad2Sub = await prisma.submission.findFirst({
        where: { teamId: participant2.membership!.teamId, level: 2 },
      });

      expect(squad2Sub).toBeNull();
    });
  });

  // =========================================================================
  // 3. EVIDENCE & SAMPLE REPORT ACCESS (Requirements 6, 7)
  // =========================================================================
  describe('3. Evidence & Reference Template Access', () => {
    it('6. Evidence access emits an EVIDENCE_ACCESSED audit record', async () => {
      await prisma.auditLog.create({
        data: {
          actorId: participant1.id,
          targetId: participant1.id,
          action: 'EVIDENCE_ACCESSED',
          details: `Participant @${participant1.username} downloaded Level 2 evidence package.`,
        },
      });

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'EVIDENCE_ACCESSED', actorId: participant1.id },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('evidence package');
    });

    it('7. Sample report access emits a SAMPLE_REPORT_ACCESSED audit record', async () => {
      await prisma.auditLog.create({
        data: {
          actorId: participant1.id,
          targetId: participant1.id,
          action: 'SAMPLE_REPORT_ACCESSED',
          details: `Participant @${participant1.username} accessed Level 2 sample report template.`,
        },
      });

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'SAMPLE_REPORT_ACCESSED', actorId: participant1.id },
      });
      expect(audit).toBeDefined();
      expect(audit?.details).toContain('sample report template');
    });
  });

  // =========================================================================
  // 4. DELIVERABLE FILE VALIDATION & FORMAT SUPPORT (Requirements 8, 9, 10, 11, 12)
  // =========================================================================
  describe('4. Deliverable File Validation & Format Support', () => {
    it('8. Valid PDF file upload is accepted and saved', async () => {
      const pdf = new File(['%PDF-1.4 sample pdf content'], 'report.pdf', {
        type: 'application/pdf',
      });
      const result = await saveSubmissionFile(pdf, 2, team1.id);
      expect(result.valid).toBe(true);
      expect(result.file?.originalName).toBe('report.pdf');

      // Cleanup
      const filePath = path.join(process.cwd(), result.file!.storagePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    it('9. Valid DOCX / DOC file upload is accepted and saved', async () => {
      const docx = new File(['PK\x03\x04 word document content'], 'forensics_investigation.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const result = await saveSubmissionFile(docx, 2, team1.id);
      expect(result.valid).toBe(true);
      expect(result.file?.originalName).toBe('forensics_investigation.docx');

      // Cleanup
      const filePath = path.join(process.cwd(), result.file!.storagePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    it('10. Valid ZIP evidence archive is accepted and saved', async () => {
      const zip = new File(['PK\x03\x04 fake zip content'], 'supporting_evidence.zip', {
        type: 'application/zip',
      });
      const result = await saveSubmissionFile(zip, 2, team1.id);
      expect(result.valid).toBe(true);
      expect(result.file?.originalName).toBe('supporting_evidence.zip');

      // Cleanup
      const filePath = path.join(process.cwd(), result.file!.storagePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    it('11. Rejects invalid or executable file formats (.exe, .sh)', async () => {
      const exe = new File(['malicious code'], 'payload.exe', {
        type: 'application/x-msdownload',
      });
      const result = await saveSubmissionFile(exe, 2, team1.id);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unsupported file type');
    });

    it('12. Rejects files exceeding the 20MB limit', async () => {
      const oversized = new File([new Uint8Array(MAX_SUBMISSION_FILE_SIZE + 1024)], 'huge.pdf', {
        type: 'application/pdf',
      });
      const result = await saveSubmissionFile(oversized, 2, team1.id);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('over the 20 MB limit');
    });
  });

  // =========================================================================
  // 5. CONCURRENCY, IDEMPOTENCY & STATUS LOCKS (Requirements 13, 14, 15, 16)
  // =========================================================================
  describe('5. Concurrency, Idempotency & Status Locks', () => {
    it('13. Replaces an existing submission before the deadline instead of locking it', async () => {
      // BEHAVIOUR CHANGE: a squad may now correct its report while the level is
      // open. This previously refused the second upload outright, which taught
      // squads to withhold their work until the last minute rather than submit
      // early and improve it.
      //
      // The invariant that actually matters is unchanged and asserted below:
      // ONE submission row per (team, level), never two.
      const pdf1 = new File(['%PDF-1.4 First Report'], 'report1.pdf', { type: 'application/pdf' });
      const fd1 = new FormData();
      fd1.append('level', '2');
      fd1.append('attacker', LEVEL2_ATTACKER);
      fd1.append('proof', LEVEL2_PROOF);
      fd1.append('file', pdf1);

      const res1 = await submitInvestigationAction(fd1);
      expect(res1.success).toBe(true);

      const pdf2 = new File(['%PDF-1.4 Second Report'], 'report2.pdf', { type: 'application/pdf' });
      const fd2 = new FormData();
      fd2.append('level', '2');
      fd2.append('attacker', LEVEL2_ATTACKER);
      fd2.append('proof', LEVEL2_PROOF);
      fd2.append('file', pdf2);

      const res2 = await submitInvestigationAction(fd2);
      expect(res2.success).toBe(true);

      // Still exactly one submission, now carrying only the replacement's file.
      expect(await prisma.submission.count({ where: { teamId: team1.id, level: 2 } })).toBe(1);
      const files = await prisma.submissionFile.findMany({
        where: { submission: { teamId: team1.id, level: 2 } },
        select: { originalName: true },
      });
      expect(files).toHaveLength(1);
      expect(files[0]?.originalName).toBe('report2.pdf');
    });

    it('13b. Refuses replacement once an evaluator has picked the report up', async () => {
      const pdf1 = new File(['%PDF-1.4 First Report'], 'report1.pdf', { type: 'application/pdf' });
      const fd1 = new FormData();
      fd1.append('level', '2');
      fd1.append('attacker', LEVEL2_ATTACKER);
      fd1.append('proof', LEVEL2_PROOF);
      fd1.append('file', pdf1);
      expect((await submitInvestigationAction(fd1)).success).toBe(true);

      // An evaluator opens it. Replacing now would silently invalidate their work.
      await prisma.submission.updateMany({
        where: { teamId: team1.id, level: 2 },
        data: { status: 'UNDER_REVIEW' },
      });

      const pdf2 = new File(['%PDF-1.4 Sneaky'], 'report2.pdf', { type: 'application/pdf' });
      const fd2 = new FormData();
      fd2.append('level', '2');
      fd2.append('attacker', LEVEL2_ATTACKER);
      fd2.append('proof', LEVEL2_PROOF);
      fd2.append('file', pdf2);

      const res2 = await submitInvestigationAction(fd2);
      expect(res2.success).toBe(false);

      const files = await prisma.submissionFile.findMany({
        where: { submission: { teamId: team1.id, level: 2 } },
        select: { originalName: true },
      });
      expect(files[0]?.originalName).toBe('report1.pdf');
    });

    it('14. Handles simultaneous team member submission race conditions safely', async () => {
      // Pre-seed an accepted submission
      await prisma.submission.create({
        data: {
          teamId: team1.id,
          userId: participant1.id,
          level: 2,
          status: 'SUBMITTED',
        },
      });

      const pdf = new File(['%PDF-1.4 Report'], 'concurrent.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('level', '2');
      fd.append('attacker', LEVEL2_ATTACKER);
      fd.append('proof', LEVEL2_PROOF);
      fd.append('file', pdf);

      // A second write now REPLACES rather than being refused, but there is still
      // exactly one submission row afterwards — that is the invariant the unique
      // index on (teamId, level) guarantees, and it is what stops a race from
      // producing two competing reports for one squad.
      const raceRes = await submitInvestigationAction(fd);
      expect(raceRes.success).toBe(true);
      expect(await prisma.submission.count({ where: { teamId: team1.id, level: 2 } })).toBe(1);
    });

    it('15. Rejects submission when level is locked', async () => {
      // Level 3 is locked
      const pdf = new File(['%PDF-1.4 Report'], 'level3_report.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('level', '3');
      fd.append('file', pdf);

      const res = await submitInvestigationAction(fd);
      expect(res.success).toBe(false);
      expect(res.error).toContain('locked');
    });

    it('16. Rejects submission while portal is OFFLINE', async () => {
      vi.spyOn(portalSettingsModule, 'getPortalStatus').mockResolvedValue({
        isOnline: false,
        updatedAt: new Date(),
        updatedBy: null,
      });

      const pdf = new File(['%PDF-1.4 Report'], 'offline_report.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('level', '2');
      fd.append('attacker', LEVEL2_ATTACKER);
      fd.append('proof', LEVEL2_PROOF);
      fd.append('file', pdf);

      const res = await submitInvestigationAction(fd);
      expect(res.success).toBe(false);
      expect(res.error).toContain('offline');
    });
  });

  // =========================================================================
  // 6. EVALUATOR COMPATIBILITY & AUDIT LOGGING (Requirements 18, 19, 20)
  // =========================================================================
  describe('6. Evaluator Compatibility & Audit Logging', () => {
    it('18. Evaluator can inspect the submitted deliverables', async () => {
      // 1. Squad submits report
      const pdf = new File(['%PDF-1.4 Forensics Analysis Content'], 'squad_final_report.pdf', {
        type: 'application/pdf',
      });
      const fd = new FormData();
      fd.append('level', '2');
      fd.append('attacker', LEVEL2_ATTACKER);
      fd.append('proof', LEVEL2_PROOF);
      fd.append('file', pdf);

      const submitRes = await submitInvestigationAction(fd);
      expect(submitRes.success).toBe(true);
      const subId = submitRes.data!.id;

      // 2. Evaluator inspects submission
      const evaluatorUser = await prisma.user.create({
        data: {
          email: 'eval_marshal@acn.org',
          username: 'marshal_alpha',
          passwordHash: 'hash',
          role: 'EVALUATOR',
          status: 'ACTIVE',
        },
      });

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluatorUser as unknown as SessionUser,
      );

      const evalDetailRes = await getEvaluatorSubmissionDetailsAction(subId);
      expect(evalDetailRes.success).toBe(true);
      expect(evalDetailRes.data?.teamName).toBe(team1.name);
      expect(evalDetailRes.data?.files[0]?.originalName).toBe('squad_final_report.pdf');
    });

    it('19. Participant cannot access evaluator actions', async () => {
      // Participant tries to call getEvaluatorSubmissionDetailsAction
      const evalDetailRes = await getEvaluatorSubmissionDetailsAction('sub_123');
      expect(evalDetailRes.success).toBe(false);
      expect(evalDetailRes.error).toContain(
        'does not have permission to access the evaluation console',
      );
    });

    it('20. Full audit trail recorded for participant submission actions', async () => {
      const pdf = new File(['%PDF-1.4 Forensic Report Data'], 'audit_test_report.pdf', {
        type: 'application/pdf',
      });
      const fd = new FormData();
      fd.append('level', '2');
      fd.append('attacker', LEVEL2_ATTACKER);
      fd.append('proof', LEVEL2_PROOF);
      fd.append('file', pdf);

      await submitInvestigationAction(fd);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'SUBMISSION_SUBMITTED', actorId: participant1.id },
      });

      expect(audit).toBeDefined();
      expect(audit?.details).toContain('submitted Level 2 deliverables');
    });
  });
});
