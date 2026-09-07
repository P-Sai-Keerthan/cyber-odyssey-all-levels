/**
 * Phase 16 §18 — File upload validation and concurrency.
 *
 * Verifies that the submission storage layer holds under simultaneous uploads and
 * that every validation control still rejects what it is supposed to reject.
 *
 * The concurrency question that matters here is corruption: many squads uploading
 * at the same moment must not interleave into each other's files. That is a
 * property of how storage paths are generated, so the tests below check both the
 * uniqueness of generated names and the byte-for-byte integrity of what lands on
 * disk.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import {
  saveSubmissionFile,
  discardSubmissionFiles,
  validateSubmissionMagicBytes,
  MAX_SUBMISSION_FILE_SIZE,
  type SavedSubmissionFile,
} from '@/lib/storage/submission-storage';
import { resolveContainedPath, UPLOAD_ROOTS } from '@/lib/storage/safe-path';

/** Minimal valid file bodies for each accepted format. */
const PDF_BODY = '%PDF-1.4\nphase16 upload test\n';
const ZIP_BODY = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const DOC_BODY = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);

const created: SavedSubmissionFile[] = [];

function pdfFile(name: string, body = PDF_BODY): File {
  return new File([body], name, { type: 'application/pdf' });
}

afterAll(() => {
  discardSubmissionFiles(created);
});

describe('Phase 16 §18 — File upload validation & concurrency', () => {
  describe('Concurrent uploads', () => {
    it('writes 50 simultaneous uploads without collision or corruption', async () => {
      // Each squad uploads a file whose CONTENTS are unique to that squad, so
      // any cross-contamination between concurrent writes is detectable.
      const uploads = await Promise.all(
        Array.from({ length: 50 }, (_, i) => {
          const body = `%PDF-1.4\nsquad-${i}-unique-marker-${'x'.repeat(i)}\n`;
          return saveSubmissionFile(
            pdfFile('report.pdf', body),
            2,
            `team${String(i).padStart(4, '0')}`,
          );
        }),
      );

      expect(uploads.every((u) => u.valid)).toBe(true);

      const files = uploads.map((u) => u.file!).filter(Boolean);
      created.push(...files);
      expect(files.length).toBe(50);

      // Every generated storage path is distinct — the random token plus team
      // prefix must not collide even when the original filename is identical.
      const paths = files.map((f) => f.storagePath);
      expect(new Set(paths).size).toBe(50);

      // Every file on disk contains exactly the bytes its uploader supplied.
      for (let i = 0; i < files.length; i++) {
        const resolved = resolveContainedPath(files[i]!.storagePath, UPLOAD_ROOTS.submissions);
        expect(resolved).not.toBeNull();
        const contents = fs.readFileSync(resolved!, 'utf8');
        expect(contents).toContain(`squad-${i}-unique-marker-`);
        // Correct length proves no partial or interleaved write.
        expect(contents).toBe(`%PDF-1.4\nsquad-${i}-unique-marker-${'x'.repeat(i)}\n`);
      }
    });

    it('gives identical filenames from the same squad distinct storage paths', async () => {
      const uploads = await Promise.all(
        Array.from({ length: 10 }, () => saveSubmissionFile(pdfFile('report.pdf'), 2, 'sameteam')),
      );

      const files = uploads.map((u) => u.file!).filter(Boolean);
      created.push(...files);

      expect(files.length).toBe(10);
      expect(new Set(files.map((f) => f.storagePath)).size).toBe(10);
      // The participant-facing original name is preserved regardless.
      expect(files.every((f) => f.originalName === 'report.pdf')).toBe(true);
    });

    it('keeps every stored file inside the submissions root', async () => {
      const uploads = await Promise.all(
        Array.from({ length: 20 }, (_, i) => saveSubmissionFile(pdfFile('r.pdf'), 2, `t${i}`)),
      );
      const files = uploads.map((u) => u.file!).filter(Boolean);
      created.push(...files);

      for (const f of files) {
        expect(resolveContainedPath(f.storagePath, UPLOAD_ROOTS.submissions)).not.toBeNull();
      }
    });
  });

  describe('Format validation', () => {
    it('accepts the three permitted formats when contents match the extension', async () => {
      const results = await Promise.all([
        saveSubmissionFile(pdfFile('report.pdf'), 2, 'fmt1'),
        saveSubmissionFile(
          new File([ZIP_BODY], 'evidence.zip', { type: 'application/zip' }),
          2,
          'fmt2',
        ),
        saveSubmissionFile(
          new File([DOC_BODY], 'notes.doc', { type: 'application/msword' }),
          2,
          'fmt3',
        ),
      ]);

      expect(results.every((r) => r.valid)).toBe(true);
      created.push(...results.map((r) => r.file!).filter(Boolean));
    });

    it('rejects executables and scripts regardless of declared MIME type', async () => {
      for (const name of ['payload.exe', 'run.sh', 'evil.bat', 'shell.ps1', 'x.js']) {
        const result = await saveSubmissionFile(
          new File([PDF_BODY], name, { type: 'application/pdf' }),
          2,
          'exe',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/unsupported file type/i);
      }
    });

    it('rejects a renamed file whose bytes do not match its extension', async () => {
      // An executable renamed to .pdf: extension and MIME both look fine, only
      // the magic bytes betray it.
      const disguised = new File([Buffer.from([0x4d, 0x5a, 0x90, 0x00])], 'malware.pdf', {
        type: 'application/pdf',
      });
      const result = await saveSubmissionFile(disguised, 2, 'disguise');

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/does not match/i);
    });

    it('rejects a file above the size limit without writing it', async () => {
      const oversized = new File([PDF_BODY + 'x'.repeat(MAX_SUBMISSION_FILE_SIZE)], 'huge.pdf', {
        type: 'application/pdf',
      });
      const result = await saveSubmissionFile(oversized, 2, 'huge');

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/over the 20 MB limit/i);
      expect(result.file).toBeUndefined();
    });

    it('rejects an empty file', async () => {
      const result = await saveSubmissionFile(
        new File([], 'empty.pdf', { type: 'application/pdf' }),
        2,
        'empty',
      );
      expect(result.valid).toBe(false);
    });

    it('validates magic bytes independently of any filename', () => {
      expect(validateSubmissionMagicBytes(Buffer.from('%PDF-1.7'), '.pdf')).toBe(true);
      expect(validateSubmissionMagicBytes(Buffer.from('NOTAPDF!'), '.pdf')).toBe(false);
      expect(validateSubmissionMagicBytes(ZIP_BODY, '.zip')).toBe(true);
      expect(validateSubmissionMagicBytes(ZIP_BODY, '.docx')).toBe(true);
      expect(validateSubmissionMagicBytes(Buffer.from('PLAIN'), '.zip')).toBe(false);
      expect(validateSubmissionMagicBytes(DOC_BODY, '.doc')).toBe(true);
      expect(validateSubmissionMagicBytes(Buffer.from([0x00, 0x01]), '.pdf')).toBe(false);
    });
  });

  describe('Path traversal', () => {
    it('neutralises traversal sequences in the uploaded filename', async () => {
      const hostile = [
        '../../../../etc/passwd.pdf',
        '..\\..\\..\\windows\\system32\\cfg.pdf',
        'a/b/c/../../report.pdf',
      ];

      for (const name of hostile) {
        const result = await saveSubmissionFile(pdfFile(name), 2, 'traverse');
        expect(result.valid).toBe(true);
        created.push(result.file!);

        // The stored file must resolve inside the submissions root...
        const resolved = resolveContainedPath(result.file!.storagePath, UPLOAD_ROOTS.submissions);
        expect(resolved).not.toBeNull();

        // ...and the generated name must carry no separators or traversal.
        expect(result.file!.fileName).not.toContain('..');
        expect(result.file!.fileName).not.toContain('/');
        expect(result.file!.fileName).not.toContain('\\');
      }
    });

    it('rejects stored paths that escape the submissions root', () => {
      const escapes = [
        '../../.env',
        'uploads/../../.env',
        '/etc/passwd',
        'uploads/submissions-evil/x.pdf',
        '',
      ];
      for (const p of escapes) {
        expect(resolveContainedPath(p, UPLOAD_ROOTS.submissions)).toBeNull();
      }
    });

    it('rejects a path containing a null byte', () => {
      expect(
        resolveContainedPath('uploads/submissions/a\0.pdf', UPLOAD_ROOTS.submissions),
      ).toBeNull();
    });
  });

  describe('Cleanup of uncommitted uploads', () => {
    it('removes files for a submission that did not commit', async () => {
      const result = await saveSubmissionFile(pdfFile('rollback.pdf'), 2, 'rollback');
      expect(result.valid).toBe(true);

      const resolved = resolveContainedPath(result.file!.storagePath, UPLOAD_ROOTS.submissions)!;
      expect(fs.existsSync(resolved)).toBe(true);

      discardSubmissionFiles([result.file!]);
      expect(fs.existsSync(resolved)).toBe(false);
    });

    it('does not throw when asked to discard files that are already gone', () => {
      expect(() =>
        discardSubmissionFiles([
          {
            originalName: 'ghost.pdf',
            fileName: 'ghost.pdf',
            storagePath: path.join('uploads', 'submissions', 'level-2', 'does-not-exist.pdf'),
            fileSize: 1,
            mimeType: 'application/pdf',
          },
        ]),
      ).not.toThrow();
    });
  });
});
