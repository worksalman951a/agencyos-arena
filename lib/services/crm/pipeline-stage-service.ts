'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  PipelineStageCreateInput,
  PipelineStageUpdateInput,
  PipelineStageQueryInput,
} from '@/lib/schemas/crm/pipeline-stage.schema';

/** Pipeline Stage serialization */
export interface PipelineStageResponse {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  color: string | null;
  probability: number | null;
  isWon: boolean;
  isLost: boolean;
  pipeline: { id: string; name: string } | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** PipelineStage with the pipeline relation included (matches findMany include) */
type PipelineStageWithPipeline = {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  color: string | null;
  probability: number | null;
  isWon: boolean;
  isLost: boolean;
  pipeline: { id: string; name: string } | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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

/** Serialize a pipeline stage */
function serializePipelineStage(stage: PipelineStageWithPipeline): PipelineStageResponse {
  return {
    id: stage.id,
    pipelineId: stage.pipelineId,
    name: stage.name,
    order: stage.order,
    color: stage.color,
    probability: stage.probability,
    isWon: stage.isWon,
    isLost: stage.isLost,
    pipeline: stage.pipeline,
    deletedAt: stage.deletedAt,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

/** List pipeline stages with organization scoping, soft-delete filtering, and pagination */
export async function listPipelineStages(
  pipelineId: string | undefined,
  input: PipelineStageQueryInput
) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.read');

  // When a pipelineId is provided, verify it belongs to the user's organization
  if (pipelineId) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId },
    });

    if (!pipeline) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const where: Record<string, unknown> = {
    ...(!input.includeDeleted ? { deletedAt: null } : {}),
  };

  if (pipelineId) {
    where.pipelineId = pipelineId;
  }

  if (input.search) {
    where.OR = [{ name: { contains: input.search, mode: 'insensitive' } }];
  }

  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [stages, total] = await Promise.all([
    prisma.pipelineStage.findMany({
      where,
      include: {
        pipeline: {
          select: { id: true, name: true },
        },
      },
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.pipelineStage.count({ where }),
  ]);

  return {
    stages: stages.map((s: PipelineStageWithPipeline) => serializePipelineStage(s)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get a single pipeline stage by ID with organization isolation */
export async function getPipelineStage(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.read');

  const stage = await prisma.pipelineStage.findFirst({
    where: {
      id,
      pipeline: { organizationId },
    },
    include: {
      pipeline: {
        select: { id: true, name: true },
      },
    },
  });

  if (!stage) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializePipelineStage(stage);
}

/** Create a pipeline stage with organization scoping and audit logging */
export async function createPipelineStage(pipelineId: string, input: PipelineStageCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.stage.manage');

  // Verify the pipeline exists and belongs to the user's organization
  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, organizationId },
  });

  if (!pipeline) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Determine the next order value if not provided
  const maxOrder = await prisma.pipelineStage.aggregate({
    where: { pipelineId, deletedAt: null },
    _max: { order: true },
  });
  const order = input.order ?? (maxOrder._max.order ?? 0) + 1;

  const stage = await prisma.pipelineStage.create({
    data: {
      pipelineId,
      name: input.name,
      order,
      color: input.color ?? null,
      probability: input.probability ?? null,
      isWon: input.isWon ?? false,
      isLost: input.isLost ?? false,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'pipeline.stage.create',
    entityType: 'PipelineStage',
    entityId: stage.id,
    after: {
      id: stage.id,
      pipelineId: stage.pipelineId,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      probability: stage.probability,
      isWon: stage.isWon,
      isLost: stage.isLost,
    },
    organizationId,
  });

  return serializePipelineStage(stage);
}

/** Update a pipeline stage with organization scoping and audit logging */
export async function updatePipelineStage(
  id: string,
  pipelineId: string,
  input: PipelineStageUpdateInput
) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.stage.manage');

  const existing = await prisma.pipelineStage.findFirst({
    where: {
      id,
      pipelineId,
      pipeline: { organizationId },
    },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // If order is being changed, validate no conflict within the pipeline
  if (input.order !== undefined && input.order !== existing.order) {
    const conflictingStage = await prisma.pipelineStage.findFirst({
      where: {
        pipelineId,
        order: input.order,
        deletedAt: null,
        id: { not: id },
      },
    });
    if (conflictingStage) {
      const error = new Error('Stage order already exists in this pipeline') as Error & {
        statusCode?: number;
      };
      error.statusCode = 400;
      throw error;
    }
  }

  const stage = await prisma.pipelineStage.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      order: input.order ?? existing.order,
      color: input.color ?? existing.color,
      probability: input.probability ?? existing.probability,
      isWon: input.isWon ?? existing.isWon,
      isLost: input.isLost ?? existing.isLost,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'pipeline.stage.update',
    entityType: 'PipelineStage',
    entityId: stage.id,
    before: {
      id: existing.id,
      pipelineId: existing.pipelineId,
      name: existing.name,
      order: existing.order,
      color: existing.color,
      probability: existing.probability,
      isWon: existing.isWon,
      isLost: existing.isLost,
    },
    after: {
      id: stage.id,
      pipelineId: stage.pipelineId,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      probability: stage.probability,
      isWon: stage.isWon,
      isLost: stage.isLost,
    },
    organizationId,
  });

  return serializePipelineStage(stage);
}

/** Reorder pipeline stages within a pipeline */
export async function reorderPipelineStages(
  pipelineId: string,
  stageOrders: Array<{ id: string; order: number }>
) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.stage.manage');

  // Verify the pipeline exists and belongs to the user's organization
  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, organizationId },
  });

  if (!pipeline) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Validate all stage IDs belong to this pipeline
  const stageIds = stageOrders.map((so) => so.id);
  const existingStages = await prisma.pipelineStage.findMany({
    where: {
      id: { in: stageIds },
      pipelineId,
      deletedAt: null,
    },
  });

  if (existingStages.length !== stageIds.length) {
    const error = new Error('One or more stages not found in this pipeline') as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }

  // Validate no duplicate orders
  const orders = stageOrders.map((so) => so.order);
  if (new Set(orders).size !== orders.length) {
    const error = new Error('Duplicate stage orders') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  // Use a transaction to update all stage orders atomically
  await prisma.$transaction(
    stageOrders.map(({ id, order }) =>
      prisma.pipelineStage.update({
        where: { id },
        data: { order },
      })
    )
  );

  await createAuditLog({
    actorId: userId,
    actorName: '',
    action: 'pipeline.stage.reorder',
    entityType: 'Pipeline',
    entityId: pipelineId,
    metadata: { stageOrders },
    organizationId,
  });

  return { success: true };
}

/** Soft delete a pipeline stage with audit logging */
export async function deletePipelineStage(id: string, pipelineId: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'pipeline.stage.manage');

  const existing = await prisma.pipelineStage.findFirst({
    where: {
      id,
      pipelineId,
      pipeline: { organizationId },
    },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Prevent deletion if there are non-deleted opportunities or leads referencing this stage.
  // Two independent reads: no atomicity requirement, and keeping them out of a
  // transaction avoids pinning them to a single pg connection.
  const [opportunityCount, leadCount] = await Promise.all([
    prisma.opportunity.count({ where: { stageId: id } }),
    prisma.lead.count({ where: { stageId: id } }),
  ]);
  if (opportunityCount > 0 || leadCount > 0) {
    const error = new Error('Cannot delete stage with existing opportunities or leads') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const stage = await prisma.pipelineStage.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'pipeline.stage.delete',
    entityType: 'PipelineStage',
    entityId: stage.id,
    before: {
      id: existing.id,
      pipelineId: existing.pipelineId,
      name: existing.name,
      order: existing.order,
    },
    after: null,
    organizationId,
  });

  return { id: stage.id, deletedAt: stage.deletedAt };
}
