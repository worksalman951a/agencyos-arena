'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { documentLinkCreateSchema } from '@/lib/schemas/documents/link.schema';
import { randomBytes } from 'crypto';

interface DocumentLinkRecord {
  id: string;
  organizationId: string;
  documentId: string;
  token: string;
  expiresAt: Date;
  accessCount: number;
  maxAccess: number | null;
  createdAt: Date;
  document: { id: string; title: string; type: string };
}

export interface DocumentLinkResponse {
  id: string;
  organizationId: string;
  documentId: string;
  token: string;
  url: string;
  expiresAt: Date;
  accessCount: number;
  maxAccess: number | null;
  createdAt: Date;
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

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export async function createDocumentLink(input: {
  documentId: string;
  expiresAt: string;
  maxAccess?: number | null;
}) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.share');

  const parsed = documentLinkCreateSchema.safeParse(input);
  if (!parsed.success) {
    const error = new Error('Invalid input') as Error & { statusCode?: number };
    error.statusCode = 400;
    error.message = JSON.stringify(parsed.error.issues);
    throw error;
  }

  const { data } = parsed;

  // Validate document belongs to same org
  const document = await prisma.document.findFirst({
    where: { id: data.documentId, organizationId },
  });

  if (!document) {
    const error = new Error('Document not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const token = generateToken();
  const expiresAt = new Date(data.expiresAt);

  const link = await prisma.documentLink.create({
    data: {
      organizationId,
      documentId: data.documentId,
      token,
      expiresAt,
      maxAccess: data.maxAccess ?? null,
      createdBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.link.create',
    entityType: 'DocumentLink',
    entityId: link.id,
    after: {
      documentId: data.documentId,
      token,
      expiresAt: link.expiresAt,
    },
    organizationId,
  });

  return {
    id: link.id,
    organizationId: link.organizationId,
    documentId: link.documentId,
    token: link.token,
    url: `/api/v1/documents/links/${link.token}`,
    expiresAt: link.expiresAt,
    accessCount: link.accessCount,
    maxAccess: link.maxAccess,
    createdAt: link.createdAt,
  };
}

export async function listDocumentLinks() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.read');

  const links = await prisma.documentLink.findMany({
    where: { organizationId },
    include: {
      document: { select: { id: true, title: true, type: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return links.map((l: DocumentLinkRecord) => ({
    id: l.id,
    organizationId: l.organizationId,
    documentId: l.documentId,
    token: l.token,
    url: `/api/v1/documents/links/${l.token}`,
    expiresAt: l.expiresAt,
    accessCount: l.accessCount,
    maxAccess: l.maxAccess,
    createdAt: l.createdAt,
  }));
}

export async function revokeDocumentLink(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.share');

  const existing = await prisma.documentLink.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Link not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Set expiry to now to effectively revoke
  await prisma.documentLink.update({
    where: { id },
    data: { expiresAt: new Date() },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.link.revoke',
    entityType: 'DocumentLink',
    entityId: id,
    before: { id, token: existing.token },
    after: null,
    organizationId,
  });

  return { id };
}

export async function verifyDocumentLink(token: string) {
  const link = await prisma.documentLink.findFirst({
    where: { token },
    include: {
      document: true,
    },
  });

  if (!link) {
    const error = new Error('Invalid link') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (link.expiresAt < new Date()) {
    const error = new Error('Link expired') as Error & { statusCode?: number };
    error.statusCode = 410;
    throw error;
  }

  if (link.maxAccess !== null && link.accessCount >= link.maxAccess) {
    const error = new Error('Link access limit reached') as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }

  // Increment access count
  await prisma.documentLink.update({
    where: { id: link.id },
    data: { accessCount: { increment: 1 } },
  });

  // Anonymous callers only need the document they were granted; the
  // organization id stays internal (nothing downstream needs it).
  return {
    id: link.id,
    documentId: link.documentId,
    documentTitle: link.document.title,
    documentType: link.document.type,
  };
}
