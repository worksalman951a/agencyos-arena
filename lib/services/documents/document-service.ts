'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { DocumentCreateInput, DocumentUpdateInput } from '@/lib/schemas/documents/document.schema';

interface DocumentRecord {
  id: string;
  organizationId: string;
  title: string;
  type: string;
  folder: string | null;
  visibility: string;
  fileAssetId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  fileAsset?: { id: string; originalName: string; mimeType: string; size: number } | null;
  versions?: Array<{ version: number }>;
  links?: Array<{ expiresAt: Date }>;
}

export interface DocumentResponse {
  id: string;
  organizationId: string;
  title: string;
  type: string;
  folder: string | null;
  visibility: string;
  fileAssetId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
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

async function validateFileAssetOrg(organizationId: string, fileAssetId: string) {
  const asset = await prisma.fileAsset.findFirst({
    where: { id: fileAssetId, organizationId },
    select: { id: true },
  });
  if (!asset) {
    throw codedError('Not found', 404);
  }
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
  ipAddress,
  userAgent,
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
  ipAddress?: string | null;
  userAgent?: string | null;
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
      ipAddress,
      userAgent,
      organizationId,
    },
  });
}

export async function listDocuments() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.read');

  const documents = await prisma.document.findMany({
    where: {
      organizationId,
      OR: [{ folder: null }, { folder: { not: '__template__' } }],
    },
    include: {
      fileAsset: { select: { id: true, originalName: true, mimeType: true, size: true } },
      _count: { select: { versions: true, links: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return documents.map((d: DocumentRecord) => ({
    id: d.id,
    organizationId: d.organizationId,
    title: d.title,
    type: d.type,
    folder: d.folder,
    visibility: d.visibility,
    fileAssetId: d.fileAssetId,
    version: d.version,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export async function getDocument(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.read');

  const document = await prisma.document.findFirst({
    where: { id, organizationId },
    include: {
      fileAsset: { select: { id: true, originalName: true, mimeType: true, size: true } },
      versions: { orderBy: { version: 'desc' }, take: 5 },
      links: { where: { expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!document) {
    throw codedError('Not found', 404);
  }

  return {
    id: document.id,
    organizationId: document.organizationId,
    title: document.title,
    type: document.type,
    folder: document.folder,
    visibility: document.visibility,
    fileAssetId: document.fileAssetId,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export async function createDocument(input: DocumentCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.create');

  if (input.fileAssetId) {
    await validateFileAssetOrg(organizationId, input.fileAssetId);
  }

  const document = await prisma.document.create({
    data: {
      organizationId,
      title: input.title,
      type: input.type,
      folder: input.folder ?? null,
      visibility: input.visibility,
      fileAssetId: input.fileAssetId ?? null,
      version: 1,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.create',
    entityType: 'Document',
    entityId: document.id,
    after: {
      id: document.id,
      title: document.title,
      type: document.type,
    },
    organizationId,
  });

  return {
    id: document.id,
    organizationId: document.organizationId,
    title: document.title,
    type: document.type,
    folder: document.folder,
    visibility: document.visibility,
    fileAssetId: document.fileAssetId,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export async function updateDocument(id: string, input: DocumentUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.update');

  const existing = await prisma.document.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw codedError('Not found', 404);
  }

  if (input.fileAssetId !== undefined && input.fileAssetId !== null) {
    await validateFileAssetOrg(organizationId, input.fileAssetId);
  }

  const document = await prisma.document.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      type: input.type ?? existing.type,
      folder: input.folder !== undefined ? input.folder : existing.folder,
      visibility: input.visibility ?? existing.visibility,
      fileAssetId: input.fileAssetId !== undefined ? input.fileAssetId : existing.fileAssetId,
      ...(input.fileAssetId !== undefined && input.fileAssetId !== null
        ? { version: existing.version + 1 }
        : {}),
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.update',
    entityType: 'Document',
    entityId: document.id,
    before: {
      id: existing.id,
      title: existing.title,
      type: existing.type,
    },
    after: {
      id: document.id,
      title: document.title,
      type: document.type,
    },
    organizationId,
  });

  return {
    id: document.id,
    organizationId: document.organizationId,
    title: document.title,
    type: document.type,
    folder: document.folder,
    visibility: document.visibility,
    fileAssetId: document.fileAssetId,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export async function deleteDocument(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.delete');

  const existing = await prisma.document.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw codedError('Not found', 404);
  }

  await prisma.document.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.delete',
    entityType: 'Document',
    entityId: id,
    before: { id: existing.id, title: existing.title, type: existing.type },
    after: null,
    organizationId,
  });

  return { id };
}
