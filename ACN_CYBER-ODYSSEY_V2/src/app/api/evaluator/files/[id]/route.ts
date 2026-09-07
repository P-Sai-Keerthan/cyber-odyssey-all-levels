import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import * as fs from 'fs';
import { resolveContainedPath, UPLOAD_ROOTS } from '@/lib/storage/safe-path';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Authenticated stream for participant submission files.
 * Validates Evaluator privileges, prevents path traversal, and emits a FILE_ACCESSED audit record.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized. Authentication is required to inspect submission deliverables.' },
        { status: 401 },
      );
    }

    if (
      user.status !== 'ACTIVE' ||
      (user.role !== 'EVALUATOR' && user.role !== 'CREATOR' && user.role !== 'ADMIN')
    ) {
      return NextResponse.json(
        {
          error:
            'Forbidden. Evaluator privileges are required to inspect participant deliverables.',
        },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'File identifier is required.' }, { status: 400 });
    }

    const fileRecord = await prisma.submissionFile.findUnique({
      where: { id },
      include: {
        submission: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!fileRecord) {
      return NextResponse.json({ error: 'Deliverable file record not found.' }, { status: 404 });
    }

    // Containment check: the file must resolve strictly inside uploads/submissions.
    // See src/lib/storage/safe-path.ts for why the previous startsWith check was
    // insufficient (SEC-17-03).
    const resolvedPath = resolveContainedPath(fileRecord.storagePath, UPLOAD_ROOTS.submissions);

    if (!resolvedPath) {
      console.error(
        `[security] Rejected out-of-root submission file path for record ${fileRecord.id}`,
      );
      return NextResponse.json(
        { error: 'This deliverable could not be served because its stored location is invalid.' },
        { status: 400 },
      );
    }

    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: 'File deliverable is missing from physical storage repository.' },
        { status: 404 },
      );
    }

    // Record FILE_ACCESSED audit entry
    await prisma.auditLog
      .create({
        data: {
          actorId: user.id,
          targetId: fileRecord.submission.userId,
          action: 'FILE_ACCESSED',
          details: `Evaluator @${user.username} downloaded deliverable "${fileRecord.originalName}" for Squad "${fileRecord.submission.team.name}" (Level ${fileRecord.submission.level}).`,
        },
      })
      .catch(() => {});

    const stats = fs.statSync(resolvedPath);
    const fileStream = fs.createReadStream(resolvedPath);

    const stream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        fileStream.on('end', () => {
          controller.close();
        });
        fileStream.on('error', (err) => {
          controller.error(err);
        });
      },
    });

    const safeFilename = fileRecord.originalName.replace(/["\r\n]/g, '_');

    return new Response(stream, {
      headers: {
        'Content-Type': fileRecord.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    console.error('File delivery error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while accessing the deliverable.' },
      { status: 500 },
    );
  }
}
