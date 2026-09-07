import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';

export interface LevelResourceMeta {
  id: string;
  levelNumber: number;
  resourceKey: string;
  title: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  isPublished: boolean;
  uploadedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LevelResourceRecord extends LevelResourceMeta {
  storagePath: string;
}

export const LEVEL_RESOURCE_CONFIG: Record<
  string,
  {
    title: string;
    allowedExtensions: string[];
    allowedMimes: string[];
    maxSizeBytes: number;
    defaultOriginalName: string;
  }
> = {
  EVIDENCE_PACKAGE: {
    title: 'Evidence Package',
    allowedExtensions: ['.zip'],
    allowedMimes: [
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream',
      'multipart/x-zip',
    ],
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    defaultOriginalName: 'cyber_odyssey_level2_evidence.zip',
  },
  SAMPLE_REPORT: {
    title: 'Sample Investigation Report',
    allowedExtensions: ['.pdf'],
    allowedMimes: ['application/pdf'],
    maxSizeBytes: 20 * 1024 * 1024, // 20MB
    defaultOriginalName: 'cyber_odyssey_level2_sample_report.pdf',
  },
};

/**
 * Returns absolute storage directory for a specific level's resources.
 */
export function getLevelResourceDir(levelNumber: number = 2): string {
  const dir = path.join(process.cwd(), 'uploads', 'resources', `level-${levelNumber}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitizes a client-provided filename to prevent path traversal and unsafe characters.
 */
export function sanitizeResourceFilename(rawName: string): string {
  // Strip null bytes and control chars
  const clean = rawName.replace(/[\0\x00-\x1f\x7f-\x9f]/g, '');
  // Split on both forward and back slashes to extract final file segment
  const parts = clean.split(/[/\\]+/).filter(Boolean);
  const lastPart = parts.length > 0 ? parts[parts.length - 1]! : 'unnamed_resource';
  // Remove any remaining traversal dots and filesystem-reserved characters
  const sanitized = lastPart
    .replace(/\.{2,}/g, '_')
    .replace(/[?%*:|"<>]/g, '_')
    .trim();
  return sanitized || 'unnamed_resource';
}

/**
 * Retrieves all resources for a specific level (metadata only, no disk paths).
 */
export async function getLevelResources(levelNumber: number = 2): Promise<LevelResourceMeta[]> {
  const records = await prisma.levelResource.findMany({
    where: { levelNumber },
    orderBy: { createdAt: 'asc' },
  });

  return records.map((r) => ({
    id: r.id,
    levelNumber: r.levelNumber,
    resourceKey: r.resourceKey,
    title: r.title,
    fileName: r.fileName,
    originalName: r.originalName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    isPublished: r.isPublished,
    uploadedById: r.uploadedById,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Retrieves an active, published resource record including storagePath for secure streaming.
 */
export async function getPublishedLevelResource(
  levelNumber: number = 2,
  resourceKey: string,
): Promise<LevelResourceRecord | null> {
  const record = await prisma.levelResource.findUnique({
    where: {
      levelNumber_resourceKey: {
        levelNumber,
        resourceKey,
      },
    },
  });

  if (!record || !record.isPublished) {
    return null;
  }

  // Ensure file physically exists on disk
  if (!fs.existsSync(record.storagePath)) {
    return null;
  }

  return {
    id: record.id,
    levelNumber: record.levelNumber,
    resourceKey: record.resourceKey,
    title: record.title,
    fileName: record.fileName,
    originalName: record.originalName,
    storagePath: record.storagePath,
    fileSize: record.fileSize,
    mimeType: record.mimeType,
    isPublished: record.isPublished,
    uploadedById: record.uploadedById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Validates magic bytes for level resources (.zip for Evidence Package, .pdf for Sample Report).
 */
export function validateLevelResourceMagicBytes(buffer: Buffer, resourceKey: string): boolean {
  if (buffer.length < 4) return false;

  if (resourceKey === 'SAMPLE_REPORT') {
    return buffer.subarray(0, 4).toString('utf-8') === '%PDF';
  }

  if (resourceKey === 'EVIDENCE_PACKAGE') {
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

  return true;
}

/**
 * Saves or replaces a Level resource securely.
 */
export async function saveLevelResource({
  levelNumber = 2,
  resourceKey,
  file,
  actorId,
  actorUsername,
}: {
  levelNumber?: number;
  resourceKey: string;
  file: File;
  actorId: string;
  actorUsername: string;
}): Promise<LevelResourceMeta> {
  const config = LEVEL_RESOURCE_CONFIG[resourceKey];
  if (!config) {
    throw new Error(`Invalid resource key: "${resourceKey}".`);
  }

  if (!file || typeof file.size !== 'number' || file.size === 0) {
    throw new Error('A valid file payload must be provided.');
  }

  if (file.size > config.maxSizeBytes) {
    const maxMb = Math.round(config.maxSizeBytes / (1024 * 1024));
    throw new Error(`File size exceeds maximum allowed limit (${maxMb}MB).`);
  }

  // Validate filename and extension
  const rawName = file.name || config.defaultOriginalName;
  const sanitizedOriginalName = sanitizeResourceFilename(rawName);
  const ext = path.extname(sanitizedOriginalName).toLowerCase();

  if (!config.allowedExtensions.includes(ext)) {
    throw new Error(
      `Invalid file extension "${ext}". Allowed: ${config.allowedExtensions.join(', ')}.`,
    );
  }

  // Validate MIME type (if provided by browser/client)
  if (file.type && !config.allowedMimes.includes(file.type.toLowerCase())) {
    // If mime type is unknown octet-stream, allow if extension is valid
    if (file.type !== 'application/octet-stream') {
      throw new Error(`Invalid file MIME type "${file.type}".`);
    }
  }

  const resourceDir = getLevelResourceDir(levelNumber);
  const storageFileName = `lvl${levelNumber}_${resourceKey.toLowerCase()}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  const targetStoragePath = path.join(resourceDir, storageFileName);

  // Check for existing record
  const existing = await prisma.levelResource.findUnique({
    where: {
      levelNumber_resourceKey: {
        levelNumber,
        resourceKey,
      },
    },
  });

  const isNew = !existing;
  const oldStoragePath = existing?.storagePath;

  // Inspect magic bytes / file signature and write new file to disk
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!validateLevelResourceMagicBytes(buffer, resourceKey)) {
    throw new Error(
      `File signature mismatch for ${config.title}. Corrupted or spoofed file detected.`,
    );
  }

  fs.writeFileSync(targetStoragePath, buffer);

  // Upsert record atomically
  const updated = await prisma.levelResource.upsert({
    where: {
      levelNumber_resourceKey: {
        levelNumber,
        resourceKey,
      },
    },
    update: {
      title: config.title,
      fileName: storageFileName,
      originalName: sanitizedOriginalName,
      storagePath: targetStoragePath,
      fileSize: file.size,
      mimeType: file.type || (ext === '.pdf' ? 'application/pdf' : 'application/zip'),
      isPublished: true,
      uploadedById: actorId,
    },
    create: {
      levelNumber,
      resourceKey,
      title: config.title,
      fileName: storageFileName,
      originalName: sanitizedOriginalName,
      storagePath: targetStoragePath,
      fileSize: file.size,
      mimeType: file.type || (ext === '.pdf' ? 'application/pdf' : 'application/zip'),
      isPublished: true,
      uploadedById: actorId,
    },
  });

  // Clean up old file from disk if replaced
  if (oldStoragePath && oldStoragePath !== targetStoragePath && fs.existsSync(oldStoragePath)) {
    try {
      fs.unlinkSync(oldStoragePath);
    } catch {
      // Ignore disk cleanup error if file was missing
    }
  }

  // Create Audit Log
  const actionName = isNew ? 'LEVEL2_RESOURCE_ADDED' : 'LEVEL2_RESOURCE_REPLACED';
  const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
  await prisma.auditLog
    .create({
      data: {
        actorId,
        action: actionName,
        details: `Creator @${actorUsername} ${isNew ? 'uploaded' : 'replaced'} ${config.title} ("${sanitizedOriginalName}", ${sizeMb} MB) for Level ${levelNumber}.`,
      },
    })
    .catch(() => {});

  return {
    id: updated.id,
    levelNumber: updated.levelNumber,
    resourceKey: updated.resourceKey,
    title: updated.title,
    fileName: updated.fileName,
    originalName: updated.originalName,
    fileSize: updated.fileSize,
    mimeType: updated.mimeType,
    isPublished: updated.isPublished,
    uploadedById: updated.uploadedById,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

/**
 * Removes a Level resource safely.
 */
export async function removeLevelResource({
  levelNumber = 2,
  resourceKey,
  actorId,
  actorUsername,
}: {
  levelNumber?: number;
  resourceKey: string;
  actorId: string;
  actorUsername: string;
}): Promise<boolean> {
  const existing = await prisma.levelResource.findUnique({
    where: {
      levelNumber_resourceKey: {
        levelNumber,
        resourceKey,
      },
    },
  });

  if (!existing) {
    return false;
  }

  // Delete DB record
  await prisma.levelResource.delete({
    where: {
      levelNumber_resourceKey: {
        levelNumber,
        resourceKey,
      },
    },
  });

  // Safely delete file from disk
  if (existing.storagePath && fs.existsSync(existing.storagePath)) {
    try {
      fs.unlinkSync(existing.storagePath);
    } catch {
      // Ignore disk unlink errors
    }
  }

  // Create Audit Log
  await prisma.auditLog
    .create({
      data: {
        actorId,
        action: 'LEVEL2_RESOURCE_REMOVED',
        details: `Creator @${actorUsername} removed ${existing.title} ("${existing.originalName}") from Level ${levelNumber}.`,
      },
    })
    .catch(() => {});

  return true;
}

/**
 * Toggles publish visibility for a level resource.
 */
export async function toggleLevelResourcePublish({
  levelNumber = 2,
  resourceKey,
  isPublished,
  actorId,
  actorUsername,
}: {
  levelNumber?: number;
  resourceKey: string;
  isPublished: boolean;
  actorId: string;
  actorUsername: string;
}): Promise<LevelResourceMeta | null> {
  const existing = await prisma.levelResource.findUnique({
    where: {
      levelNumber_resourceKey: {
        levelNumber,
        resourceKey,
      },
    },
  });

  if (!existing) {
    return null;
  }

  const updated = await prisma.levelResource.update({
    where: {
      levelNumber_resourceKey: {
        levelNumber,
        resourceKey,
      },
    },
    data: { isPublished },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId,
        action: 'LEVEL2_RESOURCE_UPDATED',
        details: `Creator @${actorUsername} ${isPublished ? 'published' : 'un-published'} ${existing.title} for Level ${levelNumber}.`,
      },
    })
    .catch(() => {});

  return {
    id: updated.id,
    levelNumber: updated.levelNumber,
    resourceKey: updated.resourceKey,
    title: updated.title,
    fileName: updated.fileName,
    originalName: updated.originalName,
    fileSize: updated.fileSize,
    mimeType: updated.mimeType,
    isPublished: updated.isPublished,
    uploadedById: updated.uploadedById,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}
