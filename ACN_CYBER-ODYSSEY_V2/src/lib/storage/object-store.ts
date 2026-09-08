import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import type { S3Client } from '@aws-sdk/client-s3';

/**
 * Storage backend for submission files and Creator-uploaded level resources.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Local disk (the only backend before this file existed) works for a single
 * server, but not for more than one apparatus of the same app: each replica
 * has its own filesystem, so a file written by one instance is invisible to a
 * request served by another. Deploying more than one Portal instance behind a
 * load balancer — the RUNBOOK's own documented "two instances is the sweet
 * spot" configuration — requires shared storage.
 *
 * Rather than force every environment onto S3, the backend is chosen by
 * whether `S3_BUCKET` is set. Unset (local dev, the test suite, a
 * single-server deployment) keeps the exact on-disk behavior this project's
 * tests already assert against. Set (the AWS deployment) switches to S3
 * without any caller needing to know which one is active — `storagePath`
 * stays the same string shape either way, it just means "the same relative
 * path underneath a fixed uploads root" instead of "a path on this disk."
 */

const S3_BUCKET = process.env['S3_BUCKET'];
const AWS_REGION = process.env['AWS_REGION'];

export const isRemoteStorage = (): boolean => Boolean(S3_BUCKET);

function absoluteLocalPath(storagePath: string): string {
  return path.isAbsolute(storagePath) ? storagePath : path.resolve(process.cwd(), storagePath);
}

/** S3 keys are always forward-slash; storagePath may carry `path.sep` from local joins. */
function toS3Key(storagePath: string): string {
  return storagePath.split(path.sep).join('/');
}

let clientPromise: Promise<S3Client> | null = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = import('@aws-sdk/client-s3').then(
      ({ S3Client }) => new S3Client(AWS_REGION ? { region: AWS_REGION } : {}),
    );
  }
  return clientPromise;
}

function isNotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * Writes bytes under `storagePath`, creating parent directories on local disk
 * as needed. Always async — every caller already awaits the write today.
 */
export async function writeObject(storagePath: string, buffer: Buffer): Promise<void> {
  if (S3_BUCKET) {
    const [{ PutObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      getClient(),
    ]);
    await client.send(
      new PutObjectCommand({ Bucket: S3_BUCKET, Key: toS3Key(storagePath), Body: buffer }),
    );
    return;
  }

  const fullPath = absoluteLocalPath(storagePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, buffer);
}

/** Streams bytes back for `storagePath`, or returns null if it does not exist. */
export async function readObjectStream(storagePath: string): Promise<Readable | null> {
  if (S3_BUCKET) {
    const [{ GetObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      getClient(),
    ]);
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: toS3Key(storagePath) }),
      );
      return (result.Body as Readable | undefined) ?? null;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  const fullPath = absoluteLocalPath(storagePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.createReadStream(fullPath);
}

/**
 * Best-effort delete. Deliberately a synchronous-contract function, not
 * `Promise<void>`: every existing caller (`discardSubmissionFiles`, and the
 * replace/remove paths in `level-resources.ts`) fires this without awaiting,
 * on the reasoning that a failed cleanup must never mask the operation that
 * triggered it. On local disk the unlink itself is synchronous, so a test
 * that checks `fs.existsSync` on the very next line still observes the
 * deletion. On S3 the delete is inherently a network call; it is dispatched
 * without blocking the caller, which matches the "best effort, never throws"
 * contract this function already had.
 */
export function deleteObject(storagePath: string): void {
  if (S3_BUCKET) {
    void deleteObjectRemote(storagePath).catch(() => {
      // Best-effort; an orphaned S3 object is the same risk class as an
      // orphaned local file, which this function has always tolerated.
    });
    return;
  }

  try {
    const fullPath = absoluteLocalPath(storagePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    // Best-effort cleanup; never throw from a rollback or replace path.
  }
}

async function deleteObjectRemote(storagePath: string): Promise<void> {
  const [{ DeleteObjectCommand }, client] = await Promise.all([
    import('@aws-sdk/client-s3'),
    getClient(),
  ]);
  await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: toS3Key(storagePath) }));
}
