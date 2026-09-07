import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { checkAuthoritativeLevelAccess } from '@/lib/event/level-access';
import { getPublishedLevelResource } from '@/lib/event/level-resources';
import * as fs from 'fs';
import { resolveContainedPath, UPLOAD_ROOTS } from '@/lib/storage/safe-path';

/**
 * Authenticated stream for Level 2 Sample Investigation Report Template.
 * Verifies session and level access before downloading.
 * Emits a SAMPLE_REPORT_ACCESSED audit record.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'Unauthorized. Authentication is required to download sample reports.' },
      { status: 401 },
    );
  }

  // Participants must pass level access verification
  if (user.role === 'PARTICIPANT') {
    if (!user.membership) {
      return NextResponse.json(
        { error: 'Forbidden. Active squad membership is required to access Level 2 materials.' },
        { status: 403 },
      );
    }

    const access = await checkAuthoritativeLevelAccess(2, Boolean(user.membership));
    if (!access.allowed && !access.isCompleted) {
      return NextResponse.json(
        { error: access.reason || 'Level 2 reference materials are currently inaccessible.' },
        { status: 403 },
      );
    }
  }

  // Query database for published sample report
  const resource = await getPublishedLevelResource(2, 'SAMPLE_REPORT');

  // Containment check before touching the filesystem (SEC-17-03).
  const resolvedPath = resource
    ? resolveContainedPath(resource.storagePath, UPLOAD_ROOTS.resources)
    : null;

  if (!resource || !resolvedPath || !fs.existsSync(resolvedPath)) {
    return NextResponse.json(
      {
        error:
          'The Level 2 sample report template has not been published yet. ' +
          'The event Creator uploads it before the level opens — check the announcements feed for the release notice.',
      },
      { status: 404 },
    );
  }

  // Record SAMPLE_REPORT_ACCESSED audit log
  await prisma.auditLog
    .create({
      data: {
        actorId: user.id,
        targetId: user.id,
        action: 'SAMPLE_REPORT_ACCESSED',
        details: `User @${user.username} (${user.role}) downloaded Level 2 sample report ("${resource.originalName}").`,
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

  return new Response(stream, {
    headers: {
      'Content-Type': resource.mimeType || 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(resource.originalName)}"`,
      'Content-Length': stats.size.toString(),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  });
}
