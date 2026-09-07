import * as path from 'path';
import * as crypto from 'crypto';
import { writeObject, deleteObject } from './object-store';

export const MAX_SUBMISSION_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.zip'];

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

export interface SavedSubmissionFile {
  originalName: string;
  fileName: string;
  storagePath: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Why a file was rejected, separate from the sentence shown to the participant.
 *
 * The HTTP layer needs to answer with 413 for an oversized file and 415 for an
 * unsupported one (see the Level 2 submission route). Deriving that by matching
 * on the wording of `error` would silently break the status codes the first time
 * anyone rewrites a message, so the reason travels as its own value.
 */
export type FileRejectionReason =
  'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'CONTENT_MISMATCH' | 'WRITE_FAILED';

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  reason?: FileRejectionReason;
  file?: SavedSubmissionFile;
}

/**
 * Inspects header bytes to verify the file content matches its declared format.
 */
export function validateSubmissionMagicBytes(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 4) return false;

  if (ext === '.pdf') {
    return buffer.subarray(0, 4).toString('utf-8') === '%PDF';
  }

  if (ext === '.zip' || ext === '.docx') {
    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];
    return (
      b0 === 0x50 &&
      b1 === 0x4b &&
      ((b2 === 0x03 && b3 === 0x04) || (b2 === 0x05 && b3 === 0x06) || (b2 === 0x07 && b3 === 0x08))
    );
  }

  if (ext === '.doc') {
    if (buffer.length < 8) return false;
    return (
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0 &&
      buffer[4] === 0xa1 &&
      buffer[5] === 0xb1 &&
      buffer[6] === 0x1a &&
      buffer[7] === 0xe1
    );
  }

  return false;
}

/**
 * Deletes files that were written to disk for a submission that ultimately did
 * not commit.
 *
 * WHY (Phase 17 / BUG-17-03): files are validated and written BEFORE the database
 * transaction, because magic-byte validation must happen before we are willing to
 * record anything. If the transaction is then rejected — most commonly by the
 * duplicate-submission guard when two teammates submit at once — the bytes would
 * otherwise stay on disk forever with no database row referencing them. Over an
 * event with 50 squads retrying, that silently fills the upload volume.
 *
 * Best-effort by design: a failed cleanup must never mask the original error.
 */
export function discardSubmissionFiles<T extends { storagePath: string }>(files: T[]): void {
  // Generic over anything carrying a storagePath, because only that field is
  // read. It serves two callers with different shapes: freshly-saved
  // SavedSubmissionFile objects discarded on a rollback, and superseded rows read
  // back from the database during a report replacement. A generic rather than a
  // Pick<> so a full SavedSubmissionFile literal still passes without tripping
  // excess-property checking.
  for (const file of files) {
    deleteObject(file.storagePath);
  }
}

/**
 * Validates and securely saves a participant submission file to disk.
 * Prevents path traversal, sanitizes filenames, verifies magic bytes, and generates unique server-side storage paths.
 */
export async function saveSubmissionFile(
  file: File,
  level: number,
  teamId: string,
): Promise<FileValidationResult> {
  if (!file || file.size === 0) {
    return {
      valid: false,
      reason: 'EMPTY',
      error:
        'That file is empty (0 bytes), so it was not accepted. ' +
        'Check the file opens correctly on your device, then attach it again.',
    };
  }

  if (file.size > MAX_SUBMISSION_FILE_SIZE) {
    return {
      valid: false,
      reason: 'TOO_LARGE',
      error:
        `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which is over the 20 MB limit per file. ` +
        'Compress it or split the evidence across several files, then submit again.',
    };
  }

  // 1. Sanitize original filename (remove directory traversals, null bytes, special chars)
  const rawOriginalName = path.basename(file.name).replace(/\0/g, '');
  const ext = path.extname(rawOriginalName).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      reason: 'UNSUPPORTED_TYPE',
      error:
        `"${rawOriginalName}" has an unsupported file type (${ext || 'no extension'}). ` +
        'Accepted formats are PDF (.pdf), Word (.doc, .docx) and ZIP (.zip). ' +
        'Export or re-save your report in one of those formats and try again.',
    };
  }

  // 2. Validate MIME type
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    return {
      valid: false,
      reason: 'UNSUPPORTED_TYPE',
      error:
        `"${rawOriginalName}" was not recognised as a PDF, Word document or ZIP package. ` +
        'Re-save it from the original application rather than renaming the file extension.',
    };
  }

  // 3. Inspect magic bytes / file signature
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!validateSubmissionMagicBytes(buffer, ext)) {
    return {
      valid: false,
      reason: 'CONTENT_MISMATCH',
      error:
        `"${rawOriginalName}" does not match the ${ext} format its name claims. ` +
        'This usually means the file was renamed rather than converted, or it was corrupted during transfer. ' +
        'Re-export it from the original application and submit again.',
    };
  }

  // 4. Construct safe storage location
  const safeBaseName = rawOriginalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueToken = crypto.randomBytes(8).toString('hex');
  const safeFileName = `lvl${level}_${teamId.slice(0, 8)}_${uniqueToken}_${safeBaseName}`;

  const targetDir = path.join('uploads', 'submissions', `level-${level}`);
  const storagePath = path.join(targetDir, safeFileName);

  // 5. Write file buffer safely without executing. Local disk or S3 —
  // see src/lib/storage/object-store.ts.
  await writeObject(storagePath, buffer);

  return {
    valid: true,
    file: {
      originalName: rawOriginalName,
      fileName: safeFileName,
      storagePath,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
    },
  };
}
