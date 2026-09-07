import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getLevelConfig, EVENT_LEVELS } from '@/lib/event/level-access';
import { hashPassword } from '@/lib/auth/password';
import * as sessionModule from '@/lib/auth/session';
import * as portalSettingsModule from '@/lib/event/portal-settings';
import {
  MIN_PROOF_WORDS,
  countWords,
  validateLevel2Answers,
} from '@/lib/submissions/answer-validation';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { POST, GET } = await import('@/app/api/event/level-2/submission/route');
const { DELETE } = await import('@/app/api/event/level-2/submission/files/[fileId]/route');
const { submitInvestigationAction } = await import('@/lib/actions/submission-actions');

/**
 * Level 2 rebuild — the submission pipeline end to end.
 *
 * These cases drive the HTTP handlers rather than the internals, because the
 * things that were broken were only visible at that boundary: the status code a
 * participant's browser receives, whether a second submission is accepted at
 * all, and whether the deadline holds when the request bypasses the UI.
 */

const ATTACKER = 'Jordan Bowen';
const PROOF =
  'The attacker authenticated from 10.24.20.14 at 2026-09-05T11:42:03Z using the harvested account nexora/jbowen, then failed nine consecutive login attempts against DC-PRIMARY before succeeding, mounted the ORION share, copied the dataset to a removable USB device registered to the same workstation, and finally cleared the security event log; CCTV places the same badge in the lab during that exact window.';

interface TestUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  membership?: {
    teamId: string;
    role: string;
    team: { id: string; name: string; status: string };
  } | null;
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof sessionModule.getSessionUser>>>;

function pdf(name = 'report.pdf', body = '%PDF-1.4 forensic report'): File {
  return new File([body], name, { type: 'application/pdf' });
}

/** A real ZIP/DOCX signature, because the server inspects the leading bytes. */
function zipLike(name: string, type: string): File {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  return new File([bytes], name, { type });
}

function submissionRequest(fields: {
  attacker?: string;
  proof?: string;
  files?: File[];
  keepFileIds?: string[];
}): Request {
  const form = new FormData();
  form.set('attacker', fields.attacker ?? ATTACKER);
  form.set('proof', fields.proof ?? PROOF);
  for (const file of fields.files ?? []) form.append('files', file);
  for (const id of fields.keepFileIds ?? []) form.append('keepFileIds', id);
  return new Request('http://localhost:3002/api/event/level-2/submission', {
    method: 'POST',
    body: form,
  });
}

function deleteRequest(fileId: string) {
  return DELETE(
    new Request(`http://localhost:3002/api/event/level-2/submission/files/${fileId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ fileId }) },
  );
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('Level 2 rebuild — points, answers, resubmission, deadline, isolation', () => {
  let participant1: TestUser;
  let participant2: TestUser;
  let team1: { id: string; name: string };
  let team2: { id: string; name: string };

  async function openLevel2(open = true) {
    await prisma.levelState.upsert({
      where: { levelNumber: 2 },
      update: {
        status: open ? 'LIVE' : 'COMPLETED',
        remainingSeconds: open ? 7200 : 0,
        startedAt: new Date(Date.now() - 60_000),
        pausedAt: null,
        endsAt: new Date(Date.now() + (open ? 2 * 60 * 60 * 1000 : -60_000)),
        completedAt: open ? null : new Date(),
      },
      create: {
        levelNumber: 2,
        name: "Level 2 — The Boar's Mark",
        codename: "THE BOAR'S MARK",
        status: open ? 'LIVE' : 'COMPLETED',
        durationMinutes: 120,
        durationSeconds: 7200,
        remainingSeconds: open ? 7200 : 0,
        startedAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + (open ? 2 * 60 * 60 * 1000 : -60_000)),
      },
    });
  }

  function signIn(user: TestUser | null) {
    vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue(
      user as unknown as SessionUser | null,
    );
  }

  beforeEach(async () => {
    vi.restoreAllMocks();

    await prisma.submissionAttempt.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.submissionFile.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});

    const tag = crypto.randomBytes(5).toString('hex');
    const passwordHash = await hashPassword('Password@1234');

    const build = async (suffix: string, score: number) => {
      const user = await prisma.user.create({
        data: {
          email: `l2_${suffix}_${tag}@example.com`,
          username: `l2_${suffix}_${tag}`,
          passwordHash,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });
      const team = await prisma.team.create({
        data: {
          name: `L2 Squad ${suffix} ${tag}`,
          code: `L2-${tag.toUpperCase()}${suffix}`,
          passwordHash,
          creatorId: user.id,
          score,
        },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: user.id, role: 'HEAD' },
      });
      const testUser: TestUser = {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        membership: {
          teamId: team.id,
          role: 'HEAD',
          team: { id: team.id, name: team.name, status: 'ACTIVE' },
        },
      };
      return { testUser, team: { id: team.id, name: team.name } };
    };

    const one = await build('a', 250);
    const two = await build('b', 100);
    participant1 = one.testUser;
    team1 = one.team;
    participant2 = two.testUser;
    team2 = two.team;

    vi.spyOn(portalSettingsModule, 'getPortalStatus').mockResolvedValue({
      isOnline: true,
      updatedAt: new Date(),
      updatedBy: null,
    });

    await openLevel2(true);
    signIn(participant1);
  });

  // =========================================================================
  // Points (TEST 1)
  // =========================================================================
  describe('Level 2 points', () => {
    it('is worth 1000 PTS in the shared level configuration', () => {
      expect(getLevelConfig(2)?.points).toBe('1000 PTS');
    });

    it('carries no stale 800 anywhere in the level configuration', () => {
      const serialised = JSON.stringify(EVENT_LEVELS);
      expect(serialised).not.toContain('800');
    });
  });

  // =========================================================================
  // Answer rules (TESTS 6, 7, 8)
  // =========================================================================
  describe('Final answer validation', () => {
    it('counts forensic tokens as single words', () => {
      expect(countWords('192.168.10.24 logged in at 2026-09-05T11:42:03Z')).toBe(5);
      // Bullet punctuation must not pad the count toward the threshold.
      expect(countWords('• • • evidence')).toBe(1);
    });

    it('requires an attacker', () => {
      const result = validateLevel2Answers({ attacker: '   ', proof: PROOF });
      expect(result.ok).toBe(false);
      expect(result.fieldErrors.attacker).toBe('Please identify the attacker or enter Unknown.');
    });

    it(`requires ${MIN_PROOF_WORDS} or more words of proof`, () => {
      const result = validateLevel2Answers({ attacker: ATTACKER, proof: 'Too short.' });
      expect(result.ok).toBe(false);
      expect(result.fieldErrors.proof).toContain(`at least ${MIN_PROOF_WORDS} words`);
    });

    it('accepts a 50+ word proof', () => {
      const result = validateLevel2Answers({ attacker: ATTACKER, proof: PROOF });
      expect(result.ok).toBe(true);
      expect(result.proofWordCount).toBeGreaterThanOrEqual(MIN_PROOF_WORDS);
    });

    it('rejects a short proof at the API with 400 and a field error', async () => {
      const res = await POST(submissionRequest({ proof: 'Not enough.', files: [pdf()] }));
      expect(res.status).toBe(400);
      const body = await bodyOf(res);
      expect(body['code']).toBe('INVALID_ANSWERS');
      expect((body['fieldErrors'] as Record<string, string>)['proof']).toContain(
        `at least ${MIN_PROOF_WORDS} words`,
      );

      // Nothing was recorded for a rejected answer.
      expect(await prisma.submission.count({ where: { teamId: team1.id } })).toBe(0);
    });

    it('rejects an empty attacker at the API with 400', async () => {
      const res = await POST(submissionRequest({ attacker: '', files: [pdf()] }));
      expect(res.status).toBe(400);
      const body = await bodyOf(res);
      expect((body['fieldErrors'] as Record<string, string>)['attacker']).toContain(
        'identify the attacker',
      );
    });
  });

  // =========================================================================
  // Uploads (TESTS 9-13)
  // =========================================================================
  describe('File uploads', () => {
    it('accepts a PDF and creates the submission with 201', async () => {
      const res = await POST(submissionRequest({ files: [pdf('investigation.pdf')] }));
      expect(res.status).toBe(201);

      const body = await bodyOf(res);
      const submission = body['submission'] as {
        files: Array<{ originalName: string }>;
        attemptCount: number;
      };
      expect(submission.files).toHaveLength(1);
      expect(submission.files[0]?.originalName).toBe('investigation.pdf');
      expect(submission.attemptCount).toBe(1);
    });

    it('accepts a DOCX', async () => {
      const res = await POST(
        submissionRequest({
          files: [
            zipLike(
              'report.docx',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ),
          ],
        }),
      );
      expect(res.status).toBe(201);
    });

    it('accepts a ZIP', async () => {
      const res = await POST(
        submissionRequest({ files: [zipLike('evidence.zip', 'application/zip')] }),
      );
      expect(res.status).toBe(201);
    });

    it('answers 413 for a file over 20 MB', async () => {
      const oversized = new File([new Uint8Array(21 * 1024 * 1024)], 'huge.pdf', {
        type: 'application/pdf',
      });
      const res = await POST(submissionRequest({ files: [oversized] }));
      expect(res.status).toBe(413);
      expect((await bodyOf(res))['code']).toBe('FILE_TOO_LARGE');
    });

    it('answers 415 for an unsupported file type', async () => {
      const res = await POST(
        submissionRequest({
          files: [new File(['MZ binary'], 'payload.exe', { type: 'application/x-msdownload' })],
        }),
      );
      expect(res.status).toBe(415);
      expect((await bodyOf(res))['code']).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('answers 400 when a renamed file does not match its extension', async () => {
      // A .pdf whose bytes are not a PDF. The extension is a claim; the server
      // does not take the browser's word for it.
      const res = await POST(
        submissionRequest({
          files: [
            new File(['MZ this is an executable'], 'report.pdf', { type: 'application/pdf' }),
          ],
        }),
      );
      expect(res.status).toBe(400);
      expect((await bodyOf(res))['code']).toBe('INVALID_FILE');
    });

    it('answers 400 when nothing is attached at all', async () => {
      const res = await POST(submissionRequest({ files: [] }));
      expect(res.status).toBe(400);
      expect((await bodyOf(res))['code']).toBe('NO_FILES');
    });

    it('accepts file-only submission when question-answer fields are omitted', async () => {
      const form = new FormData();
      form.append('files', pdf('deliverable.pdf'));
      const req = new Request('http://localhost:3002/api/event/level-2/submission', {
        method: 'POST',
        body: form,
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = (await bodyOf(res))['submission'] as { files?: { originalName: string }[] };
      expect(data?.files?.[0]?.originalName).toBe('deliverable.pdf');
    });
  });

  // =========================================================================
  // Resubmission (TESTS 14, 15, 16, 17, 18)
  // =========================================================================
  describe('Replacement and resubmission', () => {
    it('replaces the deliverable and removes the superseded bytes', async () => {
      await POST(submissionRequest({ files: [pdf('report-v1.pdf')] }));

      const first = await prisma.submissionFile.findFirstOrThrow({
        where: { submission: { teamId: team1.id, level: 2 } },
      });
      const firstPath = path.resolve(process.cwd(), first.storagePath);
      expect(fs.existsSync(firstPath)).toBe(true);

      const res = await POST(submissionRequest({ files: [pdf('report-v2.pdf')] }));
      expect(res.status).toBe(200);

      const files = await prisma.submissionFile.findMany({
        where: { submission: { teamId: team1.id, level: 2 } },
      });
      expect(files).toHaveLength(1);
      expect(files[0]?.originalName).toBe('report-v2.pdf');
      // The old bytes are gone, and only AFTER the replacement committed.
      expect(fs.existsSync(firstPath)).toBe(false);
    });

    it('allows the same file to be replaced several times before the deadline', async () => {
      await POST(submissionRequest({ files: [pdf('report-v1.pdf')] }));
      await POST(submissionRequest({ files: [pdf('report-v2.pdf')] }));
      const third = await POST(submissionRequest({ files: [pdf('final-report.pdf')] }));
      expect(third.status).toBe(200);

      const submission = await prisma.submission.findUniqueOrThrow({
        where: { teamId_level: { teamId: team1.id, level: 2 } },
        include: { files: true, attempts: { orderBy: { attemptNumber: 'asc' } } },
      });

      expect(submission.files).toHaveLength(1);
      expect(submission.files[0]?.originalName).toBe('final-report.pdf');
      expect(submission.attemptCount).toBe(3);
      expect(submission.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);

      // Every attempt kept a manifest of what was attached at the time.
      const manifests = submission.attempts.map(
        (a) => (JSON.parse(a.fileManifest) as Array<{ originalName: string }>)[0]?.originalName,
      );
      expect(manifests).toEqual(['report-v1.pdf', 'report-v2.pdf', 'final-report.pdf']);
    });

    it('updates only the written answer while keeping the stored file', async () => {
      const created = await POST(submissionRequest({ files: [pdf('report.pdf')] }));
      const firstBody = await bodyOf(created);
      const fileId = (firstBody['submission'] as { files: Array<{ id: string }> }).files[0]!.id;

      const correctedProof = `${PROOF} The USB serial number also matches the device registered to that badge.`;
      const res = await POST(
        submissionRequest({
          attacker: 'Jordan Bowen (Systems Analyst)',
          proof: correctedProof,
          files: [],
          keepFileIds: [fileId],
        }),
      );
      expect(res.status).toBe(200);

      const submission = await prisma.submission.findUniqueOrThrow({
        where: { teamId_level: { teamId: team1.id, level: 2 } },
        include: { files: true },
      });
      expect(submission.files).toHaveLength(1);
      expect(submission.files[0]?.id).toBe(fileId);

      const answers = JSON.parse(submission.answers ?? '{}') as {
        attacker: string;
        proof: string;
      };
      expect(answers.attacker).toBe('Jordan Bowen (Systems Analyst)');
      expect(answers.proof).toBe(correctedProof);
      expect(submission.attemptCount).toBe(2);
    });

    it('keeps the latest submission as the CURRENT one', async () => {
      await POST(submissionRequest({ attacker: 'First Suspect', files: [pdf('a.pdf')] }));
      await POST(submissionRequest({ attacker: 'Second Suspect', files: [pdf('b.pdf')] }));

      // One row per (team, level) — "current" is not a guess about timestamps.
      const rows = await prisma.submission.findMany({ where: { teamId: team1.id, level: 2 } });
      expect(rows).toHaveLength(1);

      const answers = JSON.parse(rows[0]?.answers ?? '{}') as { attacker: string };
      expect(answers.attacker).toBe('Second Suspect');
      expect(rows[0]?.attemptCount).toBe(2);

      const current = rows[0]!;
      const currentAttempt = await prisma.submissionAttempt.findFirstOrThrow({
        where: { submissionId: current.id, attemptNumber: current.attemptCount },
      });
      const attemptAnswers = JSON.parse(currentAttempt.answers ?? '{}') as { attacker: string };
      expect(attemptAnswers.attacker).toBe('Second Suspect');
    });

    it('refuses to replace a submission an evaluator has picked up', async () => {
      await POST(submissionRequest({ files: [pdf('report.pdf')] }));
      await prisma.submission.update({
        where: { teamId_level: { teamId: team1.id, level: 2 } },
        data: { status: 'UNDER_REVIEW' },
      });

      const res = await POST(submissionRequest({ files: [pdf('sneaky.pdf')] }));
      expect(res.status).toBe(409);
      expect((await bodyOf(res))['code']).toBe('EVALUATION_IN_PROGRESS');
    });
  });

  // =========================================================================
  // Removing a file
  // =========================================================================
  describe('File removal', () => {
    it('removes one file of several and records the change', async () => {
      const created = await POST(
        submissionRequest({ files: [pdf('report.pdf'), zipLike('extras.zip', 'application/zip')] }),
      );
      const files = (await bodyOf(created))['submission'] as { files: Array<{ id: string }> };
      expect(files.files).toHaveLength(2);

      const res = await deleteRequest(files.files[1]!.id);
      expect(res.status).toBe(200);

      const remaining = await prisma.submissionFile.findMany({
        where: { submission: { teamId: team1.id, level: 2 } },
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.originalName).toBe('report.pdf');
    });

    it('refuses to remove the only remaining deliverable', async () => {
      const created = await POST(submissionRequest({ files: [pdf('only.pdf')] }));
      const body = (await bodyOf(created))['submission'] as { files: Array<{ id: string }> };

      const res = await deleteRequest(body.files[0]!.id);
      expect(res.status).toBe(409);
      expect((await bodyOf(res))['code']).toBe('LAST_FILE');

      expect(
        await prisma.submissionFile.count({ where: { submission: { teamId: team1.id } } }),
      ).toBe(1);
    });
  });

  // =========================================================================
  // Deadline (TESTS 19, 20)
  // =========================================================================
  describe('Deadline enforcement', () => {
    it('rejects a submission after the level closes, even called directly', async () => {
      await openLevel2(false);

      const res = await POST(submissionRequest({ files: [pdf('late.pdf')] }));
      expect(res.status).toBe(403);
      expect((await bodyOf(res))['code']).toBe('LEVEL_CLOSED');
      expect(await prisma.submission.count({ where: { teamId: team1.id } })).toBe(0);
    });

    it('rejects a file removal after the level closes', async () => {
      const created = await POST(
        submissionRequest({ files: [pdf('a.pdf'), zipLike('b.zip', 'application/zip')] }),
      );
      const body = (await bodyOf(created))['submission'] as { files: Array<{ id: string }> };

      await openLevel2(false);

      const res = await deleteRequest(body.files[0]!.id);
      expect(res.status).toBe(403);
      expect(
        await prisma.submissionFile.count({ where: { submission: { teamId: team1.id } } }),
      ).toBe(2);
    });

    it('reports the closed window through GET so the UI and the server agree', async () => {
      await openLevel2(false);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await bodyOf(res);
      expect((body['window'] as { open: boolean }).open).toBe(false);
    });
  });

  // =========================================================================
  // Authentication and squad isolation (TEST 21)
  // =========================================================================
  describe('Authorisation', () => {
    it('rejects an unauthenticated submission with 401', async () => {
      signIn(null);
      const res = await POST(submissionRequest({ files: [pdf()] }));
      expect(res.status).toBe(401);
    });

    it('refuses to adopt another squad’s file through keepFileIds', async () => {
      // Squad 2 submits.
      signIn(participant2);
      const theirs = await POST(submissionRequest({ files: [pdf('squad2-report.pdf')] }));
      const theirFileId = ((await bodyOf(theirs))['submission'] as { files: Array<{ id: string }> })
        .files[0]!.id;

      // Squad 1 names squad 2's file as one of its own.
      signIn(participant1);
      const res = await POST(submissionRequest({ files: [], keepFileIds: [theirFileId] }));
      expect(res.status).toBe(409);
      expect((await bodyOf(res))['code']).toBe('UNKNOWN_FILE_REFERENCE');

      // Squad 2's submission is untouched, and squad 1 gained nothing.
      const theirFiles = await prisma.submissionFile.findMany({
        where: { submission: { teamId: team2.id } },
      });
      expect(theirFiles).toHaveLength(1);
      expect(await prisma.submission.count({ where: { teamId: team1.id } })).toBe(0);
    });

    it('reports another squad’s file as not found on removal', async () => {
      signIn(participant2);
      const theirs = await POST(
        submissionRequest({ files: [pdf('one.pdf'), zipLike('two.zip', 'application/zip')] }),
      );
      const theirFileId = ((await bodyOf(theirs))['submission'] as { files: Array<{ id: string }> })
        .files[0]!.id;

      signIn(participant1);
      await POST(submissionRequest({ files: [pdf('mine.pdf')] }));

      const res = await deleteRequest(theirFileId);
      expect(res.status).toBe(404);

      expect(
        await prisma.submissionFile.count({ where: { submission: { teamId: team2.id } } }),
      ).toBe(2);
    });

    it('serves only the caller’s own squad state from GET', async () => {
      signIn(participant2);
      await POST(submissionRequest({ files: [pdf('squad2.pdf')] }));

      signIn(participant1);
      const res = await GET();
      const body = await bodyOf(res);
      // Squad 1 has not submitted, so it sees nothing of squad 2's work.
      expect(body['submission']).toBeNull();
    });
  });

  // =========================================================================
  // Level 3 must not be caught by Level 2's answer rule
  // =========================================================================
  describe('Level 3 keeps working through the shared Server Action', () => {
    it('accepts a Level 3 report with files and no attacker/proof', async () => {
      // Level 3 submits through `submitInvestigationAction`, which now delegates
      // to the same core as the Level 2 API. The attacker/proof requirement is
      // scoped to Level 2 precisely so this stays valid — a Level 3 report has
      // no attacker field and would otherwise be rejected outright.
      await prisma.levelState.upsert({
        where: { levelNumber: 3 },
        update: {
          status: 'LIVE',
          remainingSeconds: 9000,
          startedAt: new Date(Date.now() - 60_000),
          pausedAt: null,
          endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          completedAt: null,
        },
        create: {
          levelNumber: 3,
          name: 'Level 3 — The Twelve Axes',
          codename: 'THE TWELVE AXES',
          status: 'LIVE',
          durationMinutes: 150,
          durationSeconds: 9000,
          remainingSeconds: 9000,
          startedAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      });

      const form = new FormData();
      form.set('level', '3');
      form.append('files', pdf('level3-report.pdf'));

      const result = await submitInvestigationAction(form);
      expect(result.success).toBe(true);
      expect(result.data?.level).toBe(3);
      expect(result.data?.files?.[0]?.originalName).toBe('level3-report.pdf');

      // And it is replaceable in exactly the same way.
      const second = new FormData();
      second.set('level', '3');
      second.append('files', pdf('level3-report-v2.pdf'));
      const replaced = await submitInvestigationAction(second);
      expect(replaced.success).toBe(true);
      expect(replaced.data?.attemptCount).toBe(2);
    });

    it('still refuses a Level 2 submission with no answer through the action', async () => {
      const form = new FormData();
      form.set('level', '2');
      form.append('files', pdf('answerless.pdf'));

      const result = await submitInvestigationAction(form);
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.['attacker']).toContain('identify the attacker');
    });
  });

  // =========================================================================
  // Judging (TEST 25)
  // =========================================================================
  describe('Judging reads the current submission', () => {
    it('exposes the latest answers and files, and the attempt history beside them', async () => {
      await POST(submissionRequest({ attacker: 'Wrong Suspect', files: [pdf('draft.pdf')] }));
      await POST(submissionRequest({ attacker: 'Jordan Bowen', files: [pdf('final.pdf')] }));

      // What an evaluator loads is the Submission row, which is the current one.
      const judged = await prisma.submission.findUniqueOrThrow({
        where: { teamId_level: { teamId: team1.id, level: 2 } },
        include: { files: true, attempts: { orderBy: { attemptNumber: 'asc' } } },
      });

      const answers = JSON.parse(judged.answers ?? '{}') as { attacker: string };
      expect(answers.attacker).toBe('Jordan Bowen');
      expect(judged.files.map((f) => f.originalName)).toEqual(['final.pdf']);

      // The superseded attempt is visible as history, and is NOT the current one.
      expect(judged.attempts).toHaveLength(2);
      expect(judged.attemptCount).toBe(2);
      const superseded = judged.attempts.find((a) => a.attemptNumber !== judged.attemptCount);
      const supersededAnswers = JSON.parse(superseded?.answers ?? '{}') as { attacker: string };
      expect(supersededAnswers.attacker).toBe('Wrong Suspect');
    });
  });
});
