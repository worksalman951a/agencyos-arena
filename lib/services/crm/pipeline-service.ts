'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  PipelineCreateInput,
  PipelineUpdateInput,
  PipelineQueryInput,
} from '@/lib/schemas/crm/pipeline.schema';

/** Pipeline serialization */
export interface PipelineResponse {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Validate session and resolve authorized user context */
async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    const error = new Error('Unauthenticated') as Error & {
      statusCode?: number;
    };
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

/** Create an audit log entry */
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

/** Build where clause for organization-scoped pipeline queries */
function buildPipelineWhere(organizationId: string, input: PipelineQueryInput) {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (!input.includeDeleted) {
    where.deletedAt = null;
  }

  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: 'insensitive' } },
      { description: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/** Serialize a pipeline */
function serializePipeline(
  pipeline: Awaited<ReturnType<typeof prisma.pipeline.findUnique>>
): PipelineResponse {
  return {
    id: pipeline.id,
    organizationId: pipeline.organizationId,
    name: pipeline.name,
    description: pipeline.description,
    isDefault: pipeline.isDefault,
    deletedAt: pipeline.deletedAt,
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt,
  };
}

/** List pipelines with organization scoping, soft-delete filtering, and pagination */
export async function listPipelines(input: PipelineQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.read');

  const where = buildPipelineWhere(organizationId, input);
  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [pipelines, total] = await Promise.all([
    prisma.pipeline.findMany({
      where,
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.pipeline.count({ where }),
  ]);

  return {
    pipelines: pipelines.map(serializePipeline),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get a single pipeline by ID with organization isolation (non-disclosing 404 for cross-org) */
export async function getPipeline(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.read');

  const pipeline = await prisma.pipeline.findFirst({
    where: { id, organizationId },
  });

  if (!pipeline) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializePipeline(pipeline);
}

/** Create a pipeline with organization scoping and audit logging */
export async function createPipeline(input: PipelineCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.create');

  // If this pipeline is marked as default, unset any existing default pipeline
  if (input.isDefault) {
    await prisma.pipeline.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const pipeline = await prisma.pipeline.create({
    data: {
      organizationId,
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault ?? false,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'pipeline.create',
    entityType: 'Pipeline',
    entityId: pipeline.id,
    after: {
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      isDefault: pipeline.isDefault,
    },
    organizationId,
  });

  return serializePipeline(pipeline);
}

/** Update a pipeline with organization scoping and audit logging */
export async function updatePipeline(id: string, input: PipelineUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.update');

  const existing = await prisma.pipeline.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // If this pipeline is being marked as default, unset any existing default pipeline
  if (input.isDefault === true) {
    await prisma.pipeline.updateMany({
      where: { organizationId, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const pipeline = await prisma.pipeline.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      isDefault: input.isDefault ?? existing.isDefault,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'pipeline.update',
    entityType: 'Pipeline',
    entityId: pipeline.id,
    before: {
      id: existing.id,
      name: existing.name,
      description: existing.description,
      isDefault: existing.isDefault,
    },
    after: {
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      isDefault: pipeline.isDefault,
    },
    organizationId,
  });

  return serializePipeline(pipeline);
}

/** Soft delete a pipeline (sets deletedAt) with audit logging */
export async function deletePipeline(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.delete');

  const existing = await prisma.pipeline.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Prevent deletion if there are non-deleted stages referencing this pipeline
  const stageCount = await prisma.pipelineStage.count({
    where: { pipelineId: id, deletedAt: null },
  });
  if (stageCount > 0) {
    const error = new Error('Cannot delete pipeline with existing stages') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const pipeline = await prisma.pipeline.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'pipeline.delete',
    entityType: 'Pipeline',
    entityId: pipeline.id,
    before: {
      id: existing.id,
      name: existing.name,
      description: existing.description,
      isDefault: existing.isDefault,
    },
    after: null,
    organizationId,
  });

  return { id: pipeline.id, deletedAt: pipeline.deletedAt };
}
