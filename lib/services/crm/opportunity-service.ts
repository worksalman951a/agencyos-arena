'use server';

import { prisma } from '@/lib/db';
import {
  emitWorkflowEvent,
  emitWorkflowEvents,
} from '@/lib/services/automation/run-workflow-service';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  OpportunityCreateInput,
  OpportunityUpdateInput,
  OpportunityQueryInput,
} from '@/lib/schemas/crm/opportunity.schema';

/** Opportunity serialization */
export interface OpportunityResponse {
  id: string;
  organizationId: string;
  contactId: string | null;
  accountId: string | null;
  leadId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  title: string;
  description: string | null;
  value: string | null;
  currency: string;
  closeDate: Date | null;
  ownerId: string | null;
  status: string;
  probability: string | null;
  lossReason: string | null;
  deletedAt: Date | null;
  contact: { id: string; firstName: string | null; lastName: string } | null;
  account: { id: string; name: string } | null;
  lead: { id: string; source: string; status: string } | null;
  pipeline: { id: string; name: string } | null;
  stage: { id: string; name: string; isWon: boolean; isLost: boolean } | null;
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

/** Enforce consistency between terminal stages and opportunity status. */
function assertOpportunityStageStatusConsistency(
  stage: { isWon?: boolean; isLost?: boolean } | null | undefined,
  status: string
): void {
  if (stage?.isWon && status !== 'won') {
    const error = new Error('Cannot move to a won stage without setting status to won') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }
  if (stage?.isLost && status !== 'lost') {
    const error = new Error(
      'Cannot move to a lost stage without setting status to lost'
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }
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

/** Build where clause for organization-scoped opportunity queries */
function buildOpportunityWhere(organizationId: string, input: OpportunityQueryInput) {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (!input.includeDeleted) {
    where.deletedAt = null;
  }

  if (input.contactId) {
    where.contactId = input.contactId;
  }

  if (input.accountId) {
    where.accountId = input.accountId;
  }

  if (input.leadId) {
    where.leadId = input.leadId;
  }

  if (input.pipelineId) {
    where.pipelineId = input.pipelineId;
  }

  if (input.stageId) {
    where.stageId = input.stageId;
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.ownerId) {
    where.ownerId = input.ownerId;
  }

  if (input.search) {
    where.OR = [
      { title: { contains: input.search, mode: 'insensitive' } },
      { description: { contains: input.search, mode: 'insensitive' } },
      { status: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/** Serialize an opportunity */
function serializeOpportunity(
  opp: Awaited<ReturnType<typeof prisma.opportunity.findUnique>>
): OpportunityResponse {
  return {
    id: opp.id,
    organizationId: opp.organizationId,
    contactId: opp.contactId,
    accountId: opp.accountId,
    leadId: opp.leadId,
    pipelineId: opp.pipelineId,
    stageId: opp.stageId,
    title: opp.title,
    description: opp.description,
    value: opp.value?.toString() ?? null,
    currency: opp.currency,
    closeDate: opp.closeDate,
    ownerId: opp.ownerId,
    status: opp.status,
    probability: opp.probability?.toString() ?? null,
    lossReason: opp.lossReason,
    deletedAt: opp.deletedAt,
    contact: opp.contact
      ? { id: opp.contact.id, firstName: opp.contact.firstName, lastName: opp.contact.lastName }
      : null,
    account: opp.account ? { id: opp.account.id, name: opp.account.name } : null,
    lead: opp.lead ? { id: opp.lead.id, source: opp.lead.source, status: opp.lead.status } : null,
    pipeline: opp.pipeline ? { id: opp.pipeline.id, name: opp.pipeline.name } : null,
    stage: opp.stage
      ? {
          id: opp.stage.id,
          name: opp.stage.name,
          isWon: opp.stage.isWon,
          isLost: opp.stage.isLost,
        }
      : null,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
  };
}

/** Validate owner membership within the organization */
async function validateOwner(organizationId: string, ownerId: string) {
  const membership = await prisma.userRole.findFirst({
    where: { userId: ownerId, organizationId },
  });
  return !!membership;
}

/** List opportunities with organization scoping, soft-delete filtering, and pagination */
export async function listOpportunities(input: OpportunityQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'opportunity.read');

  const where = buildOpportunityWhere(organizationId, input);
  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [opportunities, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        account: { select: { id: true, name: true } },
        lead: { select: { id: true, source: true, status: true } },
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, isWon: true, isLost: true } },
      },
    }),
    prisma.opportunity.count({ where }),
  ]);

  return {
    opportunities: opportunities.map(serializeOpportunity),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get opportunity summary metrics */
export async function getOpportunitySummary() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'opportunity.read');

  const where = {
    organizationId,
    deletedAt: null,
  };

  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [openCount, wonCount, lostCount, openValue, wonValue, lostValue, byStage] =
    await Promise.all([
      prisma.opportunity.count({
        where: { ...where, status: 'open' },
      }),
      prisma.opportunity.count({
        where: { ...where, status: 'won' },
      }),
      prisma.opportunity.count({
        where: { ...where, status: 'lost' },
      }),
      prisma.opportunity.aggregate({
        where: { ...where, status: 'open' },
        _sum: { value: true },
      }),
      prisma.opportunity.aggregate({
        where: { ...where, status: 'won' },
        _sum: { value: true },
      }),
      prisma.opportunity.aggregate({
        where: { ...where, status: 'lost' },
        _sum: { value: true },
      }),
      prisma.opportunity.groupBy({
        by: ['stageId'],
        where: { ...where, stageId: { not: null } },
        _count: { id: true },
        _sum: { value: true },
      }),
    ]);

  // Fetch stage names for the grouped results
  const stageIds = (byStage as Array<{ stageId: string | null }>)
    .map((bs) => bs.stageId!)
    .filter(Boolean);
  const stages = await prisma.pipelineStage.findMany({
    where: { id: { in: stageIds } },
    select: { id: true, name: true },
  });
  const stageMap = new Map(
    (stages as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])
  );

  return {
    openCount,
    wonCount,
    lostCount,
    openValue: openValue._sum.value?.toString() ?? '0',
    wonValue: wonValue._sum.value?.toString() ?? '0',
    lostValue: lostValue._sum.value?.toString() ?? '0',
    byStage: (byStage as Array<Record<string, unknown>>).map((bs) => {
      const sid = bs.stageId as string | null;
      return {
        stageId: sid ?? '',
        stageName: sid ? (stageMap.get(sid) ?? 'Unknown') : 'Unknown',
        count: (bs._count as { id: number }).id,
        totalValue:
          (bs._sum as { value: { toString: () => string } | null }).value?.toString() ?? '0',
      };
    }),
  };
}

/** Get a single opportunity by ID with organization isolation (non-disclosing 404 for cross-org) */
export async function getOpportunity(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'opportunity.read');

  const opportunity = await prisma.opportunity.findFirst({
    where: { id, organizationId },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      account: { select: { id: true, name: true } },
      lead: { select: { id: true, source: true, status: true, expectedValue: true } },
      pipeline: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true, isWon: true, isLost: true, pipelineId: true } },
    },
  });

  if (!opportunity) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeOpportunity(opportunity);
}

/** Create an opportunity with organization scoping, validation, and audit logging */
export async function createOpportunity(input: OpportunityCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'opportunity.create');

  // Validate owner membership if an owner is assigned
  if (input.ownerId) {
    const isMember = await validateOwner(organizationId, input.ownerId);
    if (!isMember) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org contact relationship if contactId is provided
  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId },
    });
    if (!contact) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org account relationship if accountId is provided
  if (input.accountId) {
    const account = await prisma.agencyAccount.findFirst({
      where: { id: input.accountId, organizationId },
    });
    if (!account) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org lead relationship if leadId is provided
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, organizationId },
    });
    if (!lead) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate pipeline membership if pipelineId is provided
  if (input.pipelineId) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: input.pipelineId, organizationId },
    });
    if (!pipeline) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate stage membership if stageId is provided — stage must belong
  // to the same organization (via its pipeline). When pipelineId is given,
  // the stage must be within that pipeline; otherwise the stage's pipeline
  // must belong to this organization.
  if (input.stageId) {
    const stage = await prisma.pipelineStage.findFirst({
      where: {
        id: input.stageId,
        ...(input.pipelineId ? { pipelineId: input.pipelineId } : { pipeline: { organizationId } }),
      },
      include: { pipeline: true },
    });
    if (!stage) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    // Ensure stage belongs to the same pipeline if both are provided
    if (input.pipelineId && stage.pipelineId !== input.pipelineId) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    assertOpportunityStageStatusConsistency(stage, input.status);
  }

  const opportunity = await prisma.opportunity.create({
    data: {
      organizationId,
      contactId: input.contactId ?? null,
      accountId: input.accountId ?? null,
      leadId: input.leadId ?? null,
      pipelineId: input.pipelineId ?? null,
      stageId: input.stageId ?? null,
      title: input.title,
      description: input.description ?? null,
      value: input.value ? Number(input.value) : null,
      currency: input.currency ?? 'USD',
      closeDate: input.closeDate ? new Date(input.closeDate) : null,
      ownerId: input.ownerId ?? null,
      status: input.status,
      probability: input.probability ? Number(input.probability) : null,
      lossReason: input.lossReason ?? null,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'opportunity.create',
    entityType: 'Opportunity',
    entityId: opportunity.id,
    after: {
      id: opportunity.id,
      title: opportunity.title,
      status: opportunity.status,
      value: opportunity.value,
      currency: opportunity.currency,
      pipelineId: opportunity.pipelineId,
      stageId: opportunity.stageId,
      ownerId: opportunity.ownerId,
    },
    organizationId,
  });

  await emitWorkflowEvent({
    type: 'record.created',
    recordType: 'Opportunity',
    recordId: opportunity.id,
  });

  return serializeOpportunity(opportunity);
}

/** Update an opportunity with organization scoping, stage/pipeline validation, and audit logging */
export async function updateOpportunity(id: string, input: OpportunityUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'opportunity.update');

  // Verify opportunity exists and belongs to the user's organization
  const existing = await prisma.opportunity.findFirst({
    where: { id, organizationId },
    include: {
      stage: { select: { id: true, isWon: true, isLost: true, pipelineId: true } },
    },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Validate owner membership if owner is being changed
  if (input.ownerId !== undefined && input.ownerId !== null) {
    const isMember = await validateOwner(organizationId, input.ownerId);
    if (!isMember) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org contact relationship if contactId is provided
  if (input.contactId !== undefined && input.contactId !== null) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId },
    });
    if (!contact) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org account relationship if accountId is provided
  if (input.accountId !== undefined && input.accountId !== null) {
    const account = await prisma.agencyAccount.findFirst({
      where: { id: input.accountId, organizationId },
    });
    if (!account) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org lead relationship if leadId is provided
  if (input.leadId !== undefined && input.leadId !== null) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, organizationId },
    });
    if (!lead) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate pipeline membership if pipelineId is provided
  if (input.pipelineId !== undefined && input.pipelineId !== null) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: input.pipelineId, organizationId },
    });
    if (!pipeline) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate stage membership if stageId is provided — stage must belong
  // to the same organization (via its pipeline).
  let targetStage = existing.stage as { isWon?: boolean; isLost?: boolean } | null;
  if (input.stageId !== undefined && input.stageId !== null) {
    const pipelineId = input.pipelineId ?? existing.pipelineId;
    const stage = await prisma.pipelineStage.findFirst({
      where: {
        id: input.stageId,
        ...(pipelineId ? { pipelineId } : { pipeline: { organizationId } }),
      },
      include: { pipeline: true },
    });
    if (!stage) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    // Ensure stage belongs to the same pipeline
    if (pipelineId && stage.pipelineId !== pipelineId) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    targetStage = stage;
  }

  assertOpportunityStageStatusConsistency(targetStage, input.status ?? existing.status);

  const opportunity = await prisma.opportunity.update({
    where: { id },
    data: {
      contactId: input.contactId ?? existing.contactId,
      accountId: input.accountId ?? existing.accountId,
      leadId: input.leadId ?? existing.leadId,
      pipelineId: input.pipelineId ?? existing.pipelineId,
      stageId: input.stageId ?? existing.stageId,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      value:
        input.value !== undefined
          ? input.value == null
            ? null
            : Number(input.value)
          : existing.value,
      currency: input.currency ?? existing.currency,
      closeDate:
        input.closeDate !== undefined
          ? input.closeDate == null
            ? null
            : new Date(input.closeDate)
          : existing.closeDate,
      ownerId: input.ownerId ?? existing.ownerId,
      status: input.status ?? existing.status,
      probability:
        input.probability !== undefined
          ? input.probability == null
            ? null
            : Number(input.probability)
          : existing.probability,
      lossReason: input.lossReason ?? existing.lossReason,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'opportunity.update',
    entityType: 'Opportunity',
    entityId: opportunity.id,
    before: {
      id: existing.id,
      title: existing.title,
      status: existing.status,
      value: existing.value,
      currency: existing.currency,
      pipelineId: existing.pipelineId,
      stageId: existing.stageId,
      ownerId: existing.ownerId,
    },
    after: {
      id: opportunity.id,
      title: opportunity.title,
      status: opportunity.status,
      value: opportunity.value,
      currency: opportunity.currency,
      pipelineId: opportunity.pipelineId,
      stageId: opportunity.stageId,
      ownerId: opportunity.ownerId,
    },
    organizationId,
  });

  await emitWorkflowEvents([
    { type: 'record.updated', recordType: 'Opportunity', recordId: opportunity.id },
    ...(existing.status !== opportunity.status
      ? [
          {
            type: 'record.status_changed',
            recordType: 'Opportunity',
            recordId: opportunity.id,
            previousStatus: existing.status,
          },
        ]
      : []),
  ]);

  return serializeOpportunity(opportunity);
}

/** Soft delete an opportunity (sets deletedAt) with audit logging */
export async function deleteOpportunity(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'opportunity.delete');

  const existing = await prisma.opportunity.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const opportunity = await prisma.opportunity.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'opportunity.delete',
    entityType: 'Opportunity',
    entityId: opportunity.id,
    before: {
      id: existing.id,
      title: existing.title,
      status: existing.status,
    },
    after: null,
    organizationId,
  });

  return { id: opportunity.id, deletedAt: opportunity.deletedAt };
}
