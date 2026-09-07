import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  saveLevelResource,
  getLevelResources,
  getPublishedLevelResource,
  sanitizeResourceFilename,
} from '@/lib/event/level-resources';
import {
  uploadOrReplaceLevelResourceAction,
  removeLevelResourceAction,
  toggleLevelResourcePublishAction,
} from '@/lib/actions/creator-resource-actions';
import { GET as getEvidenceRoute } from '@/app/api/event/level-2/evidence/route';
import { GET as getSampleReportRoute } from '@/app/api/event/level-2/sample-report/route';
import { hashPassword } from '@/lib/auth/password';
import * as sessionModule from '@/lib/auth/session';
import * as crypto from 'crypto';

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

describe("Phase — Level 2 Resource Management (The Boar's Mark)", () => {
  const password = 'Password@1234';

  let creatorUser: TestUser;
  let adminUser: TestUser;
  let evaluatorUser: TestUser;
  let participantUser: TestUser;
  let team: { id: string; name: string; code: string; score: number };

  beforeEach(async () => {
    vi.restoreAllMocks();

    // Clean up tables
    await prisma.levelResource.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});

    // Ensure Level 2 state is LIVE
    await prisma.levelState.upsert({
      where: { levelNumber: 2 },
      update: { status: 'LIVE', remainingSeconds: 7200, endsAt: new Date(Date.now() + 7200000) },
      create: {
        levelNumber: 2,
        name: "Level 2 — The Boar's Mark",
        codename: "THE BOAR'S MARK",
        status: 'LIVE',
        durationMinutes: 120,
        durationSeconds: 7200,
        remainingSeconds: 7200,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 7200000),
      },
    });

    const iterationId = crypto.randomBytes(6).toString('hex');
    const passwordHash = await hashPassword(password);

    // 1. Creator User
    const cUser = await prisma.user.create({
      data: {
        email: `creator_${iterationId}@acn.org`,
        username: `creator_${iterationId}`,
        passwordHash,
        role: 'CREATOR',
        status: 'ACTIVE',
      },
    });
    creatorUser = {
      id: cUser.id,
      email: cUser.email,
      username: cUser.username,
      role: cUser.role,
      status: cUser.status,
    };

    // 2. Admin User
    const aUser = await prisma.user.create({
      data: {
        email: `admin_${iterationId}@acn.org`,
        username: `admin_${iterationId}`,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminUser = {
      id: aUser.id,
      email: aUser.email,
      username: aUser.username,
      role: aUser.role,
      status: aUser.status,
    };

    // 3. Evaluator User
    const eUser = await prisma.user.create({
      data: {
        email: `evaluator_${iterationId}@acn.org`,
        username: `evaluator_${iterationId}`,
        passwordHash,
        role: 'EVALUATOR',
        status: 'ACTIVE',
      },
    });
    evaluatorUser = {
      id: eUser.id,
      email: eUser.email,
      username: eUser.username,
      role: eUser.role,
      status: eUser.status,
    };

    // 4. Participant User & Squad
    const pUser = await prisma.user.create({
      data: {
        email: `part_${iterationId}@acn.org`,
        username: `part_${iterationId}`,
        passwordHash,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    team = await prisma.team.create({
      data: {
        name: `Alpha Squad ${iterationId}`,
        code: `COD-${iterationId.toUpperCase()}`,
        passwordHash,
        creatorId: pUser.id,
        score: 100,
      },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: pUser.id,
        role: 'HEAD',
      },
    });

    participantUser = {
      id: pUser.id,
      email: pUser.email,
      username: pUser.username,
      role: pUser.role,
      status: pUser.status,
      membership: {
        teamId: team.id,
        role: 'HEAD',
        team: {
          id: team.id,
          name: team.name,
          status: 'ACTIVE',
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Creator Upload, Replace, and Remove Operations', () => {
    it('1. Creator can upload Evidence ZIP', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const zipFile = new File(['PK\x03\x04zipcontent'], 'official_evidence.zip', {
        type: 'application/zip',
      });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd.append('file', zipFile);

      const result = await uploadOrReplaceLevelResourceAction(fd);
      expect(result.success).toBe(true);
      expect(result.data?.originalName).toBe('official_evidence.zip');
      expect(result.data?.resourceKey).toBe('EVIDENCE_PACKAGE');
      expect(result.data?.isPublished).toBe(true);

      const inDb = await getPublishedLevelResource(2, 'EVIDENCE_PACKAGE');
      expect(inDb).not.toBeNull();
      expect(inDb?.originalName).toBe('official_evidence.zip');
    });

    it('2. Creator can replace Evidence ZIP atomically', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      // First upload
      const zip1 = new File(['PK\x03\x04 first content'], 'v1_evidence.zip', {
        type: 'application/zip',
      });
      const fd1 = new FormData();
      fd1.append('levelNumber', '2');
      fd1.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd1.append('file', zip1);
      await uploadOrReplaceLevelResourceAction(fd1);

      // Replace with v2
      const zip2 = new File(['PK\x03\x04 second content updated'], 'v2_evidence.zip', {
        type: 'application/zip',
      });
      const fd2 = new FormData();
      fd2.append('levelNumber', '2');
      fd2.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd2.append('file', zip2);
      const res2 = await uploadOrReplaceLevelResourceAction(fd2);

      expect(res2.success).toBe(true);
      expect(res2.data?.originalName).toBe('v2_evidence.zip');

      const inDb = await getPublishedLevelResource(2, 'EVIDENCE_PACKAGE');
      expect(inDb?.originalName).toBe('v2_evidence.zip');
    });

    it('3. Creator can remove Evidence ZIP', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      // Upload first
      const zip = new File(['PK\x03\x04 evidence zip'], 'to_delete.zip', {
        type: 'application/zip',
      });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd.append('file', zip);
      await uploadOrReplaceLevelResourceAction(fd);

      // Remove
      const removeRes = await removeLevelResourceAction(2, 'EVIDENCE_PACKAGE');
      expect(removeRes.success).toBe(true);

      const inDb = await getPublishedLevelResource(2, 'EVIDENCE_PACKAGE');
      expect(inDb).toBeNull();
    });

    it('4. Creator can upload Sample Report PDF', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const pdfFile = new File(['%PDF-1.4 report content'], 'sample_rubric.pdf', {
        type: 'application/pdf',
      });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'SAMPLE_REPORT');
      fd.append('file', pdfFile);

      const result = await uploadOrReplaceLevelResourceAction(fd);
      expect(result.success).toBe(true);
      expect(result.data?.originalName).toBe('sample_rubric.pdf');
      expect(result.data?.resourceKey).toBe('SAMPLE_REPORT');

      const inDb = await getPublishedLevelResource(2, 'SAMPLE_REPORT');
      expect(inDb).not.toBeNull();
      expect(inDb?.originalName).toBe('sample_rubric.pdf');
    });

    it('5. Creator can replace Sample Report PDF', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const pdf1 = new File(['%PDF-1.4 v1'], 'sample_v1.pdf', { type: 'application/pdf' });
      const fd1 = new FormData();
      fd1.append('levelNumber', '2');
      fd1.append('resourceKey', 'SAMPLE_REPORT');
      fd1.append('file', pdf1);
      await uploadOrReplaceLevelResourceAction(fd1);

      const pdf2 = new File(['%PDF-1.4 v2 updated'], 'sample_v2.pdf', { type: 'application/pdf' });
      const fd2 = new FormData();
      fd2.append('levelNumber', '2');
      fd2.append('resourceKey', 'SAMPLE_REPORT');
      fd2.append('file', pdf2);
      const res2 = await uploadOrReplaceLevelResourceAction(fd2);

      expect(res2.success).toBe(true);
      expect(res2.data?.originalName).toBe('sample_v2.pdf');

      const inDb = await getPublishedLevelResource(2, 'SAMPLE_REPORT');
      expect(inDb?.originalName).toBe('sample_v2.pdf');
    });

    it('6. Creator can remove Sample Report PDF', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const pdf = new File(['%PDF-1.4 sample'], 'to_remove.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'SAMPLE_REPORT');
      fd.append('file', pdf);
      await uploadOrReplaceLevelResourceAction(fd);

      const removeRes = await removeLevelResourceAction(2, 'SAMPLE_REPORT');
      expect(removeRes.success).toBe(true);

      const inDb = await getPublishedLevelResource(2, 'SAMPLE_REPORT');
      expect(inDb).toBeNull();
    });
  });

  describe('2. Participant Download & Dynamic Access', () => {
    it('7. Participant can download a published Evidence ZIP', async () => {
      // Creator uploads evidence
      await saveLevelResource({
        levelNumber: 2,
        resourceKey: 'EVIDENCE_PACKAGE',
        file: new File(['PK\x03\x04zip'], 'squad_evidence.zip', { type: 'application/zip' }),
        actorId: creatorUser.id,
        actorUsername: creatorUser.username,
      });

      // Participant requests route
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUser as unknown as SessionUser,
      );

      const res = await getEvidenceRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/zip');
      expect(res.headers.get('Content-Disposition')).toContain('squad_evidence.zip');
    });

    it('8. Participant can download a published Sample Report PDF', async () => {
      await saveLevelResource({
        levelNumber: 2,
        resourceKey: 'SAMPLE_REPORT',
        file: new File(['%PDF-1.4 sample'], 'official_template.pdf', {
          type: 'application/pdf',
        }),
        actorId: creatorUser.id,
        actorUsername: creatorUser.username,
      });

      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUser as unknown as SessionUser,
      );

      const res = await getSampleReportRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toContain('official_template.pdf');
    });

    it('9. Participant cannot download a removed resource (returns 404)', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUser as unknown as SessionUser,
      );

      // No evidence in database
      const res = await getEvidenceRoute();
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('has not been published yet');

      // No sample report in database
      const reportRes = await getSampleReportRoute();
      expect(reportRes.status).toBe(404);
    });
  });

  describe('3. Strict Role-Based Permission Enforcement', () => {
    it('10. Evaluator cannot modify resources', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        evaluatorUser as unknown as SessionUser,
      );

      const zip = new File(['PK\x03\x04 zip'], 'eval_test.zip', { type: 'application/zip' });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd.append('file', zip);

      const uploadRes = await uploadOrReplaceLevelResourceAction(fd);
      expect(uploadRes.success).toBe(false);
      expect(uploadRes.error).toContain('does not have permission to manage competition resources');

      const removeRes = await removeLevelResourceAction(2, 'EVIDENCE_PACKAGE');
      expect(removeRes.success).toBe(false);
      expect(removeRes.error).toContain('does not have permission to manage competition resources');
    });

    it('11. Admin cannot modify resources', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        adminUser as unknown as SessionUser,
      );

      const pdf = new File(['%PDF-1.4 pdf'], 'admin_test.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'SAMPLE_REPORT');
      fd.append('file', pdf);

      const uploadRes = await uploadOrReplaceLevelResourceAction(fd);
      expect(uploadRes.success).toBe(false);
      expect(uploadRes.error).toContain('does not have permission to manage competition resources');

      const removeRes = await removeLevelResourceAction(2, 'SAMPLE_REPORT');
      expect(removeRes.success).toBe(false);
      expect(removeRes.error).toContain('does not have permission to manage competition resources');
    });

    it('12. Participant cannot modify resources', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        participantUser as unknown as SessionUser,
      );

      const zip = new File(['PK\x03\x04 zip'], 'part_test.zip', { type: 'application/zip' });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd.append('file', zip);

      const uploadRes = await uploadOrReplaceLevelResourceAction(fd);
      expect(uploadRes.success).toBe(false);
      expect(uploadRes.error).toContain('does not have permission to manage competition resources');
    });

    it('13. Unauthenticated users cannot access protected resources (401)', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(null);

      const evRes = await getEvidenceRoute();
      expect(evRes.status).toBe(401);

      const repRes = await getSampleReportRoute();
      expect(repRes.status).toBe(401);
    });
  });

  describe('4. File Security, Validation & Path Traversal', () => {
    it('14. Invalid Evidence ZIP file types are rejected', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const fakeZip = new File(['not a zip'], 'malicious_executable.exe', {
        type: 'application/x-msdownload',
      });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd.append('file', fakeZip);

      const result = await uploadOrReplaceLevelResourceAction(fd);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid file extension');
    });

    it('15. Invalid Sample Report file types are rejected', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      const fakePdf = new File(['zip content'], 'report_archive.zip', {
        type: 'application/zip',
      });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'SAMPLE_REPORT');
      fd.append('file', fakePdf);

      const result = await uploadOrReplaceLevelResourceAction(fd);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid file extension');
    });

    it('16. Path traversal attempts are sanitized', () => {
      const traversal1 = '../../../../etc/passwd';
      const clean1 = sanitizeResourceFilename(traversal1);
      expect(clean1).not.toContain('..');
      expect(clean1).not.toContain('/');
      expect(clean1).toBe('passwd');

      const traversal2 = '..\\..\\windows\\system32\\calc.exe';
      const clean2 = sanitizeResourceFilename(traversal2);
      expect(clean2).not.toContain('\\');
      expect(clean2).not.toContain('..');
      expect(clean2).toBe('calc.exe');
    });
  });

  describe('5. Audit Logging & Visibility Behavior', () => {
    it('17. Audit logs are created for add, replace, and remove operations', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      // Add
      const zip1 = new File(['PK\x03\x04 zip1'], 'evidence_v1.zip', { type: 'application/zip' });
      const fd1 = new FormData();
      fd1.append('levelNumber', '2');
      fd1.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd1.append('file', zip1);
      await uploadOrReplaceLevelResourceAction(fd1);

      const addLog = await prisma.auditLog.findFirst({
        where: { action: 'LEVEL2_RESOURCE_ADDED', actorId: creatorUser.id },
      });
      expect(addLog).toBeDefined();
      expect(addLog?.details).toContain('Evidence Package');

      // Replace
      const zip2 = new File(['PK\x03\x04 zip2'], 'evidence_v2.zip', { type: 'application/zip' });
      const fd2 = new FormData();
      fd2.append('levelNumber', '2');
      fd2.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd2.append('file', zip2);
      await uploadOrReplaceLevelResourceAction(fd2);

      const replaceLog = await prisma.auditLog.findFirst({
        where: { action: 'LEVEL2_RESOURCE_REPLACED', actorId: creatorUser.id },
      });
      expect(replaceLog).toBeDefined();

      // Remove
      await removeLevelResourceAction(2, 'EVIDENCE_PACKAGE');
      const removeLog = await prisma.auditLog.findFirst({
        where: { action: 'LEVEL2_RESOURCE_REMOVED', actorId: creatorUser.id },
      });
      expect(removeLog).toBeDefined();
    });

    it('18. Replacing a resource updates the participant-visible resource', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      // Upload v1
      const zip1 = new File(['PK\x03\x04 v1'], 'initial_evidence.zip', { type: 'application/zip' });
      const fd1 = new FormData();
      fd1.append('levelNumber', '2');
      fd1.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd1.append('file', zip1);
      await uploadOrReplaceLevelResourceAction(fd1);

      let resources = await getLevelResources(2);
      expect(resources.find((r) => r.resourceKey === 'EVIDENCE_PACKAGE')?.originalName).toBe(
        'initial_evidence.zip',
      );

      // Replace with v2
      const zip2 = new File(['PK\x03\x04 v2'], 'updated_evidence.zip', { type: 'application/zip' });
      const fd2 = new FormData();
      fd2.append('levelNumber', '2');
      fd2.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd2.append('file', zip2);
      await uploadOrReplaceLevelResourceAction(fd2);

      resources = await getLevelResources(2);
      expect(resources.find((r) => r.resourceKey === 'EVIDENCE_PACKAGE')?.originalName).toBe(
        'updated_evidence.zip',
      );
    });

    it('19. Removing a resource removes/hides participant download', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      // Upload
      const pdf = new File(['%PDF-1.4 report'], 'sample.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'SAMPLE_REPORT');
      fd.append('file', pdf);
      await uploadOrReplaceLevelResourceAction(fd);

      let resources = await getLevelResources(2);
      expect(resources.some((r) => r.resourceKey === 'SAMPLE_REPORT' && r.isPublished)).toBe(true);

      // Remove
      await removeLevelResourceAction(2, 'SAMPLE_REPORT');

      resources = await getLevelResources(2);
      expect(resources.some((r) => r.resourceKey === 'SAMPLE_REPORT')).toBe(false);
    });

    it('20. Toggle publish visibility controls availability', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
        creatorUser as unknown as SessionUser,
      );

      // Upload
      const zip = new File(['PK\x03\x04 zip'], 'toggle_test.zip', { type: 'application/zip' });
      const fd = new FormData();
      fd.append('levelNumber', '2');
      fd.append('resourceKey', 'EVIDENCE_PACKAGE');
      fd.append('file', zip);
      await uploadOrReplaceLevelResourceAction(fd);

      // Toggle unpublish
      await toggleLevelResourcePublishAction(2, 'EVIDENCE_PACKAGE', false);
      let published = await getPublishedLevelResource(2, 'EVIDENCE_PACKAGE');
      expect(published).toBeNull();

      // Toggle publish
      await toggleLevelResourcePublishAction(2, 'EVIDENCE_PACKAGE', true);
      published = await getPublishedLevelResource(2, 'EVIDENCE_PACKAGE');
      expect(published).not.toBeNull();
    });
  });
});
