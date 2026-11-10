'use server';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { ProjectFileCreateInput } from '@/lib/schemas/projects/project-file.schema';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const BLOCKED_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.svg',
  '.js',
  '.mjs',
  '.cjs',
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.php',
  '.jsp',
]);

const BLOCKED_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
  'application/x-msdownload',
  'application/x-sh',
]);

interface ProjectFileRecord {
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string | null;
  fileAssetId: string;
  userId: string | null;
  createdAt: Date;
  fileAsset: {
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
  };
  user: { id: string; name: string | null; email: string | null } | null;
  task: { id: string; title: string } | null;
}

export interface ProjectFileResponse {
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string | null;
  fileAssetId: string;
  userId: string | null;
  createdAt: Date;
  fileAsset?: {
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
  };
  user?: { id: string; name: string | null; email: string | null } | null;
  task?: { id: string; title: string } | null;
}

function resolveStorageRoot(): string {
  return path.resolve(
    /*turbopackIgnore: true*/
    process.env.STORAGE_LOCAL_PATH ||
      path.join(/*turbopackIgnore: true*/ process.cwd(), 'storage', 'uploads')
  );
}

function sanitizeFileName(rawName: string): string {
  const base = path.basename(rawName || 'upload.bin');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return (cleaned || 'upload.bin').slice(0, 180);
}

function assertSafeStoragePath(storageRoot: string, relativeOrStoredPath: string): string {
  const resolved = path.resolve(storageRoot, relativeOrStoredPath);
  if (resolved !== storageRoot && !resolved.startsWith(storageRoot + path.sep)) {
    const error = new Error('Invalid storage path') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    const error = new Error('Unauthenticated') as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }

  const user = result.user as { role?: string; organizationId?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

async function createAuditLog({
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  before,
  after,
  metadata,
  organizationId,
}: {
  actorId: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  organizationId: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      before: before ?? null,
      after: after ?? null,
      metadata: metadata ?? null,
      organizationId,
    },
  });
}

export async function listProjectFiles(projectId: string): Promise<ProjectFileResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.file.read');

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
  });

  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const files = (await prisma.projectFile.findMany({
    where: { projectId, organizationId },
    include: {
      fileAsset: {
        select: { id: true, originalName: true, mimeType: true, size: true },
      },
      user: { select: { id: true, name: true, email: true } },
      task: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
  })) as ProjectFileRecord[];

  return files.map((f) => ({
    id: f.id,
    organizationId: f.organizationId,
    projectId: f.projectId,
    taskId: f.taskId,
    fileAssetId: f.fileAssetId,
    userId: f.userId,
    createdAt: f.createdAt,
    fileAsset: f.fileAsset,
    user: f.user,
    task: f.task,
  }));
}

export async function createProjectFile(
  input: ProjectFileCreateInput
): Promise<ProjectFileResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.file.create');

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId, deletedAt: null },
  });

  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const asset = await prisma.fileAsset.findFirst({
    where: { id: input.fileAssetId, organizationId },
  });

  if (!asset) {
    const error = new Error('File asset not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, projectId: input.projectId, organizationId },
    });
    if (!task) {
      const error = new Error('Task not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const file = (await prisma.projectFile.create({
    data: {
      organizationId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      fileAssetId: input.fileAssetId,
      userId,
    },
    include: {
      fileAsset: { select: { id: true, originalName: true, mimeType: true, size: true } },
      user: { select: { id: true, name: true, email: true } },
      task: { select: { id: true, title: true } },
    },
  })) as ProjectFileRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.file.create',
    entityType: 'ProjectFile',
    entityId: file.id,
    after: {
      id: file.id,
      projectId: file.projectId,
      fileAssetId: file.fileAssetId,
    },
    organizationId,
  });

  return {
    id: file.id,
    organizationId: file.organizationId,
    projectId: file.projectId,
    taskId: file.taskId,
    fileAssetId: file.fileAssetId,
    userId: file.userId,
    createdAt: file.createdAt,
    fileAsset: file.fileAsset,
    user: file.user,
    task: file.task,
  };
}

export async function uploadProjectFile(input: {
  projectId: string;
  taskId?: string | null;
  file: File;
}): Promise<ProjectFileResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.file.create');

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId, deletedAt: null },
  });

  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, projectId: input.projectId, organizationId },
    });
    if (!task) {
      const error = new Error('Task not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  if (!input.file || input.file.size <= 0) {
    const error = new Error('A non-empty file is required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  if (input.file.size > MAX_UPLOAD_BYTES) {
    const error = new Error('File size must be 10 MB or smaller') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const safeName = sanitizeFileName(input.file.name);
  const ext = path.extname(safeName).toLowerCase();
  const mimeType = (input.file.type || 'application/octet-stream')
    .toLowerCase()
    .split(';')[0]
    .trim();

  if (BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIME_TYPES.has(mimeType)) {
    const error = new Error('This file type is not permitted for upload') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const storageRoot = resolveStorageRoot();
  const relativeStoragePath = path.join(organizationId, `${crypto.randomUUID()}-${safeName}`);
  const absolutePath = assertSafeStoragePath(storageRoot, relativeStoragePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const bytes = Buffer.from(await input.file.arrayBuffer());
  await fs.writeFile(absolutePath, bytes);

  let created: ProjectFileRecord;
  try {
    created = (await prisma.$transaction(async (tx: typeof prisma) => {
      const asset = await tx.fileAsset.create({
        data: {
          organizationId,
          originalName: safeName,
          mimeType,
          size: bytes.byteLength,
          storagePath: relativeStoragePath,
          uploadedBy: userId,
        },
      });

      return tx.projectFile.create({
        data: {
          organizationId,
          projectId: input.projectId,
          taskId: input.taskId ?? null,
          fileAssetId: asset.id,
          userId,
        },
        include: {
          fileAsset: { select: { id: true, originalName: true, mimeType: true, size: true } },
          user: { select: { id: true, name: true, email: true } },
          task: { select: { id: true, title: true } },
        },
      });
    })) as ProjectFileRecord;
  } catch (err) {
    await fs.unlink(absolutePath).catch(() => {});
    throw err;
  }

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.file.upload',
    entityType: 'ProjectFile',
    entityId: created.id,
    after: {
      id: created.id,
      projectId: created.projectId,
      fileAssetId: created.fileAssetId,
      originalName: created.fileAsset.originalName,
    },
    organizationId,
  });

  return {
    id: created.id,
    organizationId: created.organizationId,
    projectId: created.projectId,
    taskId: created.taskId,
    fileAssetId: created.fileAssetId,
    userId: created.userId,
    createdAt: created.createdAt,
    fileAsset: created.fileAsset,
    user: created.user,
    task: created.task,
  };
}

export async function downloadProjectFile(id: string): Promise<{
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.file.read');

  const projectFile = await prisma.projectFile.findFirst({
    where: { id, organizationId },
    include: {
      fileAsset: true,
    },
  });

  if (
    !projectFile ||
    !projectFile.fileAsset ||
    projectFile.fileAsset.organizationId !== organizationId
  ) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const storageRoot = resolveStorageRoot();
  const absolutePath = assertSafeStoragePath(storageRoot, projectFile.fileAsset.storagePath);

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(/*turbopackIgnore: true*/ absolutePath);
  } catch {
    const error = new Error('File content not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return {
    buffer,
    originalName: sanitizeFileName(projectFile.fileAsset.originalName),
    mimeType: projectFile.fileAsset.mimeType || 'application/octet-stream',
    size: buffer.byteLength,
  };
}

export async function deleteProjectFile(id: string): Promise<{ id: string }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.file.delete');

  const existing = await prisma.projectFile.findFirst({
    where: { id, organizationId },
    include: {
      fileAsset: { select: { id: true, storagePath: true } },
    },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await prisma.projectFile.delete({
    where: { id },
  });

  const [pfRefs, docRefs, verRefs] = await Promise.all([
    prisma.projectFile.count({ where: { fileAssetId: existing.fileAssetId } }),
    prisma.document.count({ where: { fileAssetId: existing.fileAssetId } }),
    prisma.documentVersion.count({ where: { fileAssetId: existing.fileAssetId } }),
  ]);

  if (pfRefs === 0 && docRefs === 0 && verRefs === 0 && existing.fileAsset) {
    await prisma.fileAsset.delete({ where: { id: existing.fileAssetId } }).catch(() => {});
    const storageRoot = resolveStorageRoot();
    try {
      const absolutePath = assertSafeStoragePath(storageRoot, existing.fileAsset.storagePath);
      await fs.unlink(absolutePath).catch(() => {});
    } catch {
      // Ignore unsafe legacy paths on cleanup
    }
  }

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.file.delete',
    entityType: 'ProjectFile',
    entityId: id,
    before: { id: existing.id, projectId: existing.projectId, fileAssetId: existing.fileAssetId },
    after: null,
    organizationId,
  });

  return { id };
}
