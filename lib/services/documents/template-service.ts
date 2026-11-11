'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { TemplateCreateInput, TemplateUpdateInput } from '@/lib/schemas/documents/template.schema';

const TEMPLATE_FOLDER = '__template__';

interface TemplateSnapshot {
  content?: string | null;
  variables?: Record<string, string> | null;
  isDefault?: boolean;
}

interface TemplateRecord {
  id: string;
  organizationId: string;
  title: string;
  type: string;
  folder: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  versions?: Array<{
    version: number;
    snapshot: unknown;
  }>;
}

export interface TemplateResponse {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  content: string | null;
  variables: Record<string, string> | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function parseSnapshot(raw: unknown): {
  content: string | null;
  variables: Record<string, string> | null;
  isDefault: boolean;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { content: null, variables: null, isDefault: false };
  }
  const snap = raw as TemplateSnapshot;
  const content = typeof snap.content === 'string' ? snap.content : null;
  let variables: Record<string, string> | null = null;
  if (snap.variables && typeof snap.variables === 'object' && !Array.isArray(snap.variables)) {
    variables = {};
    for (const [k, v] of Object.entries(snap.variables)) {
      if (typeof v === 'string') {
        variables[k] = v;
      }
    }
  }
  const isDefault = Boolean(snap.isDefault);
  return { content, variables, isDefault };
}

function serializeTemplate(t: TemplateRecord): TemplateResponse {
  const latest = t.versions?.[0]?.snapshot;
  const { content, variables, isDefault } = parseSnapshot(latest);
  return {
    id: t.id,
    organizationId: t.organizationId,
    name: t.title,
    type: t.type,
    content,
    variables,
    isDefault,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function isTemplateDocument(t: { folder: string | null; type: string }): boolean {
  return t.folder === TEMPLATE_FOLDER || t.type.toLowerCase().includes('template');
}

async function unsetOtherDefaultsOfType(
  organizationId: string,
  type: string,
  excludeId: string,
  userId: string
) {
  const siblings = (await prisma.document.findMany({
    where: {
      organizationId,
      type,
      id: { not: excludeId },
      OR: [{ folder: TEMPLATE_FOLDER }, { type: { contains: 'template', mode: 'insensitive' } }],
    },
    include: {
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  })) as TemplateRecord[];

  for (const sibling of siblings) {
    const snap = parseSnapshot(sibling.versions?.[0]?.snapshot);
    if (!snap.isDefault) continue;
    const nextVersion = (sibling.version ?? 1) + 1;
    await prisma.document.update({
      where: { id: sibling.id },
      data: { version: nextVersion },
    });
    await prisma.documentVersion.create({
      data: {
        organizationId,
        documentId: sibling.id,
        version: nextVersion,
        title: sibling.title,
        snapshot: {
          content: snap.content,
          variables: snap.variables,
          isDefault: false,
        },
        createdBy: userId,
      },
    });
  }
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

export async function listTemplates(): Promise<TemplateResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'template.read');

  const templates = (await prisma.document.findMany({
    where: {
      organizationId,
      OR: [{ folder: TEMPLATE_FOLDER }, { type: { contains: 'template', mode: 'insensitive' } }],
    },
    include: {
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  })) as TemplateRecord[];

  return templates.map(serializeTemplate);
}

export async function getTemplate(id: string): Promise<TemplateResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'template.read');

  const template = (await prisma.document.findFirst({
    where: { id, organizationId },
    include: {
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  })) as TemplateRecord | null;

  if (!template || !isTemplateDocument(template)) {
    throw codedError('Not found', 404);
  }

  return serializeTemplate(template);
}

export async function createTemplate(input: TemplateCreateInput): Promise<TemplateResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'template.create');

  const content = input.content ?? null;
  const variables = input.variables ?? null;
  const isDefault = Boolean(input.isDefault);

  const template = (await prisma.document.create({
    data: {
      organizationId,
      title: input.name,
      type: input.type,
      folder: TEMPLATE_FOLDER,
      visibility: 'private',
      version: 1,
    },
  })) as TemplateRecord;

  await prisma.documentVersion.create({
    data: {
      organizationId,
      documentId: template.id,
      version: 1,
      title: input.name,
      snapshot: {
        content,
        variables,
        isDefault,
      },
      createdBy: userId,
    },
  });

  if (isDefault) {
    await unsetOtherDefaultsOfType(organizationId, input.type, template.id, userId);
  }

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'template.create',
    entityType: 'Template',
    entityId: template.id,
    after: {
      id: template.id,
      name: input.name,
      type: input.type,
      isDefault,
    },
    organizationId,
  });

  return {
    id: template.id,
    organizationId: template.organizationId,
    name: input.name,
    type: input.type,
    content,
    variables,
    isDefault,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export async function updateTemplate(
  id: string,
  input: TemplateUpdateInput
): Promise<TemplateResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'template.update');

  const existing = (await prisma.document.findFirst({
    where: { id, organizationId },
    include: {
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  })) as TemplateRecord | null;

  if (!existing || !isTemplateDocument(existing)) {
    throw codedError('Not found', 404);
  }

  const prevSnap = parseSnapshot(existing.versions?.[0]?.snapshot);
  const nextName = input.name ?? existing.title;
  const nextType = input.type ?? existing.type;
  const nextContent = input.content !== undefined ? (input.content ?? null) : prevSnap.content;
  const nextVariables =
    input.variables !== undefined ? (input.variables ?? null) : prevSnap.variables;
  const nextIsDefault =
    input.isDefault !== undefined ? Boolean(input.isDefault) : prevSnap.isDefault;
  const nextVersion = (existing.version ?? 1) + 1;

  const template = (await prisma.document.update({
    where: { id },
    data: {
      title: nextName,
      type: nextType,
      folder: TEMPLATE_FOLDER,
      version: nextVersion,
    },
  })) as TemplateRecord;

  await prisma.documentVersion.create({
    data: {
      organizationId,
      documentId: template.id,
      version: nextVersion,
      title: nextName,
      snapshot: {
        content: nextContent,
        variables: nextVariables,
        isDefault: nextIsDefault,
      },
      createdBy: userId,
    },
  });

  if (nextIsDefault) {
    await unsetOtherDefaultsOfType(organizationId, nextType, template.id, userId);
  }

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'template.update',
    entityType: 'Template',
    entityId: template.id,
    before: {
      id: existing.id,
      name: existing.title,
      type: existing.type,
      isDefault: prevSnap.isDefault,
    },
    after: {
      id: template.id,
      name: template.title,
      type: template.type,
      isDefault: nextIsDefault,
    },
    organizationId,
  });

  return {
    id: template.id,
    organizationId: template.organizationId,
    name: template.title,
    type: template.type,
    content: nextContent,
    variables: nextVariables,
    isDefault: nextIsDefault,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export async function deleteTemplate(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'template.delete');

  const existing = (await prisma.document.findFirst({
    where: { id, organizationId },
  })) as TemplateRecord | null;

  if (!existing || !isTemplateDocument(existing)) {
    throw codedError('Not found', 404);
  }

  await prisma.document.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'template.delete',
    entityType: 'Template',
    entityId: id,
    before: { id: existing.id, name: existing.title, type: existing.type },
    after: null,
    organizationId,
  });

  return { id };
}
