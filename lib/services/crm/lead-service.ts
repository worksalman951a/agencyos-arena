'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { LeadCreateInput, LeadUpdateInput, LeadQueryInput } from '@/lib/schemas/crm/lead.schema';

/** Lead serialization with PII masking */
export interface LeadResponse {
  id: string;
  organizationId: string;
  contactId: string | null;
  accountId: string | null;
  contact: { id: string; firstName: string | null; lastName: string } | null;
  account: { id: string; name: string } | null;
  source: string;
  status: string;
  priority: string | null;
  expectedValue: string | null;
  ownerId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  notes: string | null;
  isDuplicate: boolean;
  duplicateId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  convertedOpportunity: {
    id: string;
    title: string;
    status: string;
    value: string | null;
    currency: string;
    createdAt: Date;
  } | null;
}

/** Redact sensitive fields in audit log payloads */
function redactPii(data: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...data };
  if (redacted.email) redacted.email = '***@***';
  if (redacted.phone) redacted.phone = '***';
  if (redacted.maskedEmail) redacted.maskedEmail = '***@***';
  if (redacted.maskedPhone) redacted.maskedPhone = '***';
  return redacted;
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

/** Create an audit log entry with sensitive values redacted */
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
      before: before ? redactPii(before as Record<string, unknown>) : null,
      after: after ? redactPii(after as Record<string, unknown>) : null,
      metadata: metadata ?? null,
      ipAddress,
      userAgent,
      organizationId,
    },
  });
}

/** Build where clause for organization-scoped lead queries */
function buildLeadWhere(organizationId: string, input: LeadQueryInput) {
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

  if (input.status) {
    where.status = input.status;
  }

  if (input.priority) {
    where.priority = input.priority;
  }

  if (input.ownerId) {
    where.ownerId = input.ownerId;
  }

  if (input.search) {
    where.OR = [
      { source: { contains: input.search, mode: 'insensitive' } },
      { status: { contains: input.search, mode: 'insensitive' } },
      { priority: { contains: input.search, mode: 'insensitive' } },
      { notes: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/** Serialize a lead */
function serializeLead(
  lead: Awaited<ReturnType<typeof prisma.lead.findUnique>>,
  isDuplicate: boolean,
  duplicateId: string | null
): LeadResponse {
  return {
    id: lead.id,
    organizationId: lead.organizationId,
    contactId: lead.contactId,
    accountId: lead.accountId,
    contact: lead.contact
      ? {
          id: lead.contact.id,
          firstName: lead.contact.firstName,
          lastName: lead.contact.lastName,
        }
      : null,
    account: lead.account ? { id: lead.account.id, name: lead.account.name } : null,
    source: lead.source,
    status: lead.status,
    priority: lead.priority,
    expectedValue: lead.expectedValue?.toString() ?? null,
    ownerId: lead.ownerId,
    pipelineId: lead.pipelineId,
    stageId: lead.stageId,
    notes: lead.notes,
    isDuplicate,
    duplicateId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    deletedAt: lead.deletedAt,
    convertedOpportunity: lead.opportunities?.[0]
      ? {
          id: lead.opportunities[0].id,
          title: lead.opportunities[0].title,
          status: lead.opportunities[0].status,
          value: lead.opportunities[0].value?.toString() ?? null,
          currency: lead.opportunities[0].currency,
          createdAt: lead.opportunities[0].createdAt,
        }
      : null,
  };
}

/** Detect whether a lead duplicates an existing non-deleted lead in the org */
async function detectDuplicate(
  organizationId: string,
  input: { contactId?: string | null; accountId?: string | null; source?: string; status?: string },
  excludeId?: string
) {
  const where: Record<string, unknown> = {
    organizationId,
    deletedAt: null,
  };

  if (excludeId) {
    where.id = { not: excludeId };
  }

  // Only match with reliable, deterministic identifiers.
  // source + status alone are not reliable duplicate identifiers — unrelated leads
  // can legitimately share the same source and status (e.g. "website" / "new").
  // Never perform broad organization-only matching (where = { organizationId, deletedAt: null } alone).
  if (input.contactId) {
    where.contactId = input.contactId;
    if (input.source) where.source = input.source;
    if (input.status) where.status = input.status;
  } else if (input.accountId && input.source && input.status) {
    where.accountId = input.accountId;
    where.source = input.source;
    where.status = input.status;
  } else {
    // Not enough reliable identifiers for deterministic matching — no duplicate.
    return { isDuplicate: false, duplicateId: null };
  }

  const duplicate = await prisma.lead.findFirst({ where });
  return duplicate
    ? { isDuplicate: true, duplicateId: duplicate.id }
    : { isDuplicate: false, duplicateId: null };
}

/** Validate owner membership within the organization */
async function validateOwner(organizationId: string, ownerId: string) {
  const membership = await prisma.userRole.findFirst({
    where: { userId: ownerId, organizationId },
  });
  return !!membership;
}

/** List leads with organization scoping, soft-delete filtering, and pagination */
export async function listLeads(input: LeadQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'lead.read');

  const where = buildLeadWhere(organizationId, input);
  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [leads, total] = (await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        account: { select: { id: true, name: true } },
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true } },
      },
    }),
    prisma.lead.count({ where }),
  ])) as [
    Array<{
      isDuplicate?: boolean;
      [key: string]: unknown;
    }>,
    number,
  ];

  return {
    leads: leads.map((l) => serializeLead(l, false, null)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get a single lead by ID with organization isolation (non-disclosing 404 for cross-org) */
export async function getLead(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'lead.read');

  const lead = await prisma.lead.findFirst({
    where: { id, organizationId },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      account: { select: { id: true, name: true } },
      pipeline: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true } },
      opportunities: {
        select: {
          id: true,
          title: true,
          status: true,
          value: true,
          currency: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!lead) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeLead(lead, false, null);
}

/** Check for duplicate leads without creating */
export async function checkDuplicate(input: LeadCreateInput) {
  const { organizationId } = await getAuthorizedUser();

  const { isDuplicate, duplicateId } = await detectDuplicate(organizationId, {
    contactId: input.contactId ?? null,
    accountId: input.accountId ?? null,
    source: input.source,
    status: input.status,
  });

  return { isDuplicate, duplicateId };
}

/** Create a lead with organization scoping, duplicate detection, and audit logging */
export async function createLead(input: LeadCreateInput, overrideDuplicate = false) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'lead.create');

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
    if (input.pipelineId && stage.pipelineId !== input.pipelineId) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Duplicate detection
  const { isDuplicate, duplicateId } = await detectDuplicate(organizationId, {
    contactId: input.contactId ?? null,
    accountId: input.accountId ?? null,
    source: input.source,
    status: input.status,
  });

  if (isDuplicate && !overrideDuplicate) {
    const error = new Error('Duplicate lead detected') as Error & {
      statusCode?: number;
      duplicateId?: string;
    };
    error.statusCode = 409;
    error.duplicateId = duplicateId;
    throw error;
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      contactId: input.contactId ?? null,
      accountId: input.accountId ?? null,
      source: input.source,
      status: input.status,
      priority: input.priority,
      expectedValue: input.expectedValue ? Number(input.expectedValue) : null,
      ownerId: input.ownerId ?? null,
      pipelineId: input.pipelineId ?? null,
      stageId: input.stageId ?? null,
      notes: input.notes ?? null,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'lead.create',
    entityType: 'Lead',
    entityId: lead.id,
    after: {
      id: lead.id,
      source: lead.source,
      status: lead.status,
      priority: lead.priority,
      contactId: lead.contactId,
      accountId: lead.accountId,
      ownerId: lead.ownerId,
      expectedValue: lead.expectedValue,
    },
    metadata: isDuplicate ? { duplicateOverride: true, duplicateId } : null,
    organizationId,
  });

  return serializeLead(lead, false, null);
}

/** Update a lead with organization scoping, duplicate detection, and audit logging */
export async function updateLead(id: string, input: LeadUpdateInput, overrideDuplicate = false) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'lead.update');

  // Verify lead exists and belongs to the user's organization
  const existing = await prisma.lead.findFirst({
    where: { id, organizationId },
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
  // to the same organization (via its pipeline). When pipelineId is given,
  // the stage must be within that pipeline; otherwise the stage's pipeline
  // must belong to this organization.
  if (input.stageId !== undefined && input.stageId !== null) {
    const pipelineId = input.pipelineId ?? existing.pipelineId ?? null;
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
    if (pipelineId && stage.pipelineId !== pipelineId) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Duplicate detection for field changes that affect dedup key
  const dedupKeyChanged =
    input.contactId !== undefined ||
    input.accountId !== undefined ||
    input.source !== undefined ||
    input.status !== undefined;

  const { isDuplicate, duplicateId } = dedupKeyChanged
    ? await detectDuplicate(
        organizationId,
        {
          contactId: input.contactId ?? existing.contactId,
          accountId: input.accountId ?? existing.accountId,
          source: input.source ?? existing.source,
          status: input.status ?? existing.status,
        },
        id
      )
    : { isDuplicate: false, duplicateId: null };

  if (isDuplicate && !overrideDuplicate) {
    const error = new Error('Duplicate lead detected') as Error & {
      statusCode?: number;
      duplicateId?: string;
    };
    error.statusCode = 409;
    error.duplicateId = duplicateId;
    throw error;
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      contactId: input.contactId ?? existing.contactId,
      accountId: input.accountId ?? existing.accountId,
      source: input.source ?? existing.source,
      status: input.status ?? existing.status,
      priority: input.priority ?? existing.priority,
      expectedValue:
        input.expectedValue !== undefined
          ? input.expectedValue == null
            ? null
            : Number(input.expectedValue)
          : existing.expectedValue,
      ownerId: input.ownerId ?? existing.ownerId,
      pipelineId: input.pipelineId ?? existing.pipelineId,
      stageId: input.stageId ?? existing.stageId,
      notes: input.notes ?? existing.notes,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'lead.update',
    entityType: 'Lead',
    entityId: lead.id,
    before: redactPii({
      id: existing.id,
      source: existing.source,
      status: existing.status,
      priority: existing.priority,
      contactId: existing.contactId,
      accountId: existing.accountId,
      ownerId: existing.ownerId,
      expectedValue: existing.expectedValue,
    }),
    after: redactPii({
      id: lead.id,
      source: lead.source,
      status: lead.status,
      priority: lead.priority,
      contactId: lead.contactId,
      accountId: lead.accountId,
      ownerId: lead.ownerId,
      expectedValue: lead.expectedValue,
    }),
    metadata: isDuplicate ? { duplicateOverride: true, duplicateId } : null,
    organizationId,
  });

  return serializeLead(lead, false, null);
}

/** Soft delete a lead (sets deletedAt) with audit logging */
export async function deleteLead(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'lead.delete');

  const existing = await prisma.lead.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'lead.delete',
    entityType: 'Lead',
    entityId: lead.id,
    before: redactPii({
      id: existing.id,
      source: existing.source,
      status: existing.status,
      contactId: existing.contactId,
      accountId: existing.accountId,
    }),
    after: null,
    organizationId,
  });

  return { id: lead.id, deletedAt: lead.deletedAt };
}
