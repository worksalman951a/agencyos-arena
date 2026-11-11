'use server';

import { prisma } from '@/lib/db';
import {
  emitWorkflowEvent,
  emitWorkflowEvents,
} from '@/lib/services/automation/run-workflow-service';
import {
  allocateDocumentNumber,
  type PrismaTransactionClient,
} from '@/lib/services/settings/document-numbering';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  ProposalCreateInput,
  ProposalUpdateInput,
  ProposalQueryInput,
  ProposalLineItemInput,
} from '@/lib/schemas/crm/proposal.schema';

/** Prisma proposal result type with all relations */
type ProposalWithRelations = {
  id: string;
  organizationId: string;
  number: string;
  opportunityId: string | null;
  contactId: string | null;
  title: string;
  status: string;
  subtotal: number | string | { toString: () => string };
  tax: number | string | { toString: () => string };
  total: number | string | { toString: () => string };
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    proposalId: string;
    description: string;
    quantity: number | string | { toString: () => string };
    unitPrice: number | string | { toString: () => string };
    taxRate: number | string | { toString: () => string };
    amount: number | string | { toString: () => string };
    sortOrder: number;
    createdAt: Date;
  }>;
  creator?: { id: string; name: string | null; email: string | null } | null;
  updater?: { id: string; name: string | null; email: string | null } | null;
  opportunity?: { id: string; title: string } | null;
  contact?: { id: string; firstName: string | null; lastName: string } | null;
};

/** Proposal serialization with server-calculated totals */
export interface ProposalResponse {
  id: string;
  organizationId: string;
  number: string;
  opportunityId: string | null;
  contactId: string | null;
  title: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; name: string | null; email: string | null } | null;
  updater: { id: string; name: string | null; email: string | null } | null;
  opportunity: { id: string; title: string } | null;
  contact: { id: string; firstName: string | null; lastName: string } | null;
  items: ProposalLineItemResponse[];
}

export interface ProposalLineItemResponse {
  id: string;
  proposalId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  amount: string;
  sortOrder: number;
  createdAt: Date;
}

/** Proposal statuses that allow editing (immutable once accepted) */
const EDITABLE_STATUSES = ['draft', 'sent'];

/** Valid status transitions */
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [], // immutable
  rejected: [], // immutable
  expired: [], // immutable
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

/** Convert a decimal string/number/Decimal to cents (integer) for safe money math */
function toCents(value: string | number | { toString: () => string }): number {
  const num =
    typeof value === 'number'
      ? value
      : parseDecimal(typeof value === 'string' ? value : value.toString());
  return Math.round(num * 100);
}

/** Parse a decimal string safely, defaulting to 0 */
function parseDecimal(value: string): number {
  const parsed = Number(value);
  return isNaN(parsed) ? 0 : parsed;
}

/** Format cents as a 2-decimal string */
function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Normalize stored Decimal/number/string money values to 2 decimal places */
function formatMoneyValue(value: string | number | { toString: () => string }): string {
  return formatMoney(toCents(value));
}

/** Calculate line item totals using integer (cent) math to avoid floating-point errors */
function calculateLineItemTotals(items: ProposalLineItemInput[]) {
  let subtotalCents = 0;
  let taxCents = 0;

  for (const item of items) {
    const qtyCents = toCents(item.quantity);
    const priceCents = toCents(item.unitPrice);
    const rate = parseDecimal(item.taxRate);

    // itemAmount in cents: qty * price (both already in cents, so divide by 100)
    const itemAmountCents = Math.round((qtyCents * priceCents) / 100);
    // itemTax in cents: itemAmount * rate / 100
    const itemTaxCents = Math.round((itemAmountCents * rate) / 100);

    subtotalCents += itemAmountCents;
    taxCents += itemTaxCents;
  }

  return {
    subtotal: formatMoney(subtotalCents),
    tax: formatMoney(taxCents),
    total: formatMoney(subtotalCents + taxCents),
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

/** Serialize a proposal with server-calculated totals and linked CRM summaries */
function serializeProposal(proposal: ProposalWithRelations): ProposalResponse {
  return {
    id: proposal.id,
    organizationId: proposal.organizationId,
    number: proposal.number,
    opportunityId: proposal.opportunityId,
    contactId: proposal.contactId,
    title: proposal.title,
    status: proposal.status,
    subtotal: formatMoneyValue(proposal.subtotal),
    tax: formatMoneyValue(proposal.tax),
    total: formatMoneyValue(proposal.total),
    currency: proposal.currency,
    validUntil: proposal.validUntil,
    notes: proposal.notes,
    deletedAt: proposal.deletedAt,
    createdBy: proposal.createdBy,
    updatedBy: proposal.updatedBy,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    creator: proposal.creator
      ? { id: proposal.creator.id, name: proposal.creator.name, email: proposal.creator.email }
      : null,
    updater: proposal.updater
      ? { id: proposal.updater.id, name: proposal.updater.name, email: proposal.updater.email }
      : null,
    opportunity: proposal.opportunity
      ? { id: proposal.opportunity.id, title: proposal.opportunity.title }
      : null,
    contact: proposal.contact
      ? {
          id: proposal.contact.id,
          firstName: proposal.contact.firstName,
          lastName: proposal.contact.lastName,
        }
      : null,
    items: proposal.items.map((item) => ({
      id: item.id,
      proposalId: item.proposalId,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      taxRate: item.taxRate.toString(),
      amount: formatMoneyValue(item.amount),
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
    })),
  };
}

/** Build where clause for organization-scoped proposal queries */
function buildProposalWhere(organizationId: string, input: ProposalQueryInput) {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (!input.includeDeleted) {
    where.deletedAt = null;
  }

  if (input.opportunityId) {
    where.opportunityId = input.opportunityId;
  }

  if (input.contactId) {
    where.contactId = input.contactId;
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.search) {
    where.OR = [
      { title: { contains: input.search, mode: 'insensitive' } },
      { number: { contains: input.search, mode: 'insensitive' } },
      { notes: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/** List proposals with organization scoping, soft-delete filtering, and pagination */
export async function listProposals(input: ProposalQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'proposal.read');

  const where = buildProposalWhere(organizationId, input);
  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [proposals, total] = await Promise.all([
    prisma.proposal.findMany({
      where,
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
        opportunity: { select: { id: true, title: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.proposal.count({ where }),
  ]);

  return {
    proposals: proposals.map((p: ProposalWithRelations) => serializeProposal(p)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get a single proposal by ID with organization isolation (non-disclosing 404 for cross-org or deleted) */
export async function getProposal(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'proposal.read');

  const proposal = await prisma.proposal.findFirst({
    where: { id, organizationId },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
      },
      opportunity: { select: { id: true, title: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      creator: { select: { id: true, name: true, email: true } },
      updater: { select: { id: true, name: true, email: true } },
    },
  });

  if (!proposal || proposal.deletedAt) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeProposal(proposal as ProposalWithRelations);
}

/** Create a proposal with server-calculated totals, organization scoping, and audit logging */
export async function createProposal(
  input: ProposalCreateInput,
  lineItems: ProposalLineItemInput[]
) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'proposal.create');

  // Validate cross-org opportunity relationship if provided
  if (input.opportunityId) {
    const opportunity = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, organizationId },
    });
    if (!opportunity || (opportunity as { deletedAt?: Date | null }).deletedAt) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org contact relationship if provided
  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId },
    });
    if (!contact || (contact as { deletedAt?: Date | null }).deletedAt) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Calculate totals server-side from line items (never trust client)
  const { subtotal, tax, total } = calculateLineItemTotals(lineItems);

  // Allocation and insertion share one transaction: the proposal counter cannot
  // advance without a proposal, and concurrent creates cannot collide.
  const proposal = await prisma.$transaction(async (tx: PrismaTransactionClient) => {
    const { number } = await allocateDocumentNumber(tx, organizationId, 'proposal');

    return tx.proposal.create({
      data: {
        organizationId,
        number,
        opportunityId: input.opportunityId ?? null,
        contactId: input.contactId ?? null,
        title: input.title,
        status: input.status,
        subtotal,
        tax,
        total,
        currency: input.currency,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        notes: input.notes ?? null,
        createdBy: userId,
        updatedBy: userId,
        items: {
          create: lineItems.map((item, index) => {
            const qtyCents = toCents(item.quantity);
            const priceCents = toCents(item.unitPrice);
            const itemAmountCents = Math.round((qtyCents * priceCents) / 100);
            return {
              description: item.description,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              taxRate: Number(item.taxRate),
              amount: formatMoney(itemAmountCents),
              sortOrder: item.sortOrder ?? index,
            };
          }),
        },
      },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
        opportunity: { select: { id: true, title: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'proposal.create',
    entityType: 'Proposal',
    entityId: proposal.id,
    after: {
      id: proposal.id,
      number: proposal.number,
      title: proposal.title,
      status: proposal.status,
      total: proposal.total.toString(),
      currency: proposal.currency,
    },
    organizationId,
  });

  await emitWorkflowEvent({
    type: 'record.created',
    recordType: 'Proposal',
    recordId: proposal.id,
  });

  return serializeProposal(proposal as ProposalWithRelations);
}

/** Update a proposal with server-calculated totals, organization scoping, and audit logging */
export async function updateProposal(
  id: string,
  input: ProposalUpdateInput,
  lineItems?: ProposalLineItemInput[]
) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'proposal.update');

  // Verify proposal exists, is not soft-deleted, and belongs to the user's organization
  const existing = await prisma.proposal.findFirst({
    where: { id, organizationId },
    include: { items: true },
  });

  if (!existing || existing.deletedAt) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Immutable once accepted/rejected/expired
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    const error = new Error(
      'Cannot modify a proposal that is not in draft or sent status'
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  // Validate status transition if status is being changed
  if (input.status !== undefined && input.status !== existing.status) {
    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(input.status)) {
      const error = new Error(
        `Invalid status transition from ${existing.status} to ${input.status}`
      ) as Error & {
        statusCode?: number;
      };
      error.statusCode = 400;
      throw error;
    }
  }

  // Validate cross-org opportunity relationship if provided
  if (input.opportunityId !== undefined && input.opportunityId !== null) {
    const opportunity = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, organizationId },
    });
    if (!opportunity || (opportunity as { deletedAt?: Date | null }).deletedAt) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Validate cross-org contact relationship if provided
  if (input.contactId !== undefined && input.contactId !== null) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId },
    });
    if (!contact || (contact as { deletedAt?: Date | null }).deletedAt) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Calculate totals from line items if provided (server-side, never trust client)
  let subtotal = formatMoney(toCents(existing.subtotal));
  let tax = formatMoney(toCents(existing.tax));
  let total = formatMoney(toCents(existing.total));

  if (lineItems) {
    const { subtotal: s, tax: t, total: tot } = calculateLineItemTotals(lineItems);
    subtotal = s;
    tax = t;
    total = tot;
  }

  const proposal = await prisma.proposal.update({
    where: { id },
    data: {
      opportunityId:
        input.opportunityId !== undefined ? input.opportunityId : existing.opportunityId,
      contactId: input.contactId !== undefined ? input.contactId : existing.contactId,
      title: input.title ?? existing.title,
      status: input.status ?? existing.status,
      subtotal,
      tax,
      total,
      currency: input.currency ?? existing.currency,
      validUntil:
        input.validUntil !== undefined
          ? input.validUntil
            ? new Date(input.validUntil)
            : null
          : existing.validUntil,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      updatedBy: userId,
      ...(lineItems
        ? {
            items: {
              deleteMany: {},
              create: lineItems.map((item, index) => {
                const qtyCents = toCents(item.quantity);
                const priceCents = toCents(item.unitPrice);
                const itemAmountCents = Math.round((qtyCents * priceCents) / 100);
                return {
                  description: item.description,
                  quantity: Number(item.quantity),
                  unitPrice: Number(item.unitPrice),
                  taxRate: Number(item.taxRate),
                  amount: formatMoney(itemAmountCents),
                  sortOrder: item.sortOrder ?? index,
                };
              }),
            },
          }
        : {}),
    },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
      },
      opportunity: { select: { id: true, title: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'proposal.update',
    entityType: 'Proposal',
    entityId: proposal.id,
    before: {
      id: existing.id,
      title: existing.title,
      status: existing.status,
      total: existing.total.toString(),
    },
    after: {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      total: proposal.total.toString(),
    },
    organizationId,
  });

  await emitWorkflowEvents([
    { type: 'record.updated', recordType: 'Proposal', recordId: proposal.id },
    ...(existing.status !== proposal.status
      ? [
          {
            type: 'record.status_changed',
            recordType: 'Proposal',
            recordId: proposal.id,
            previousStatus: existing.status,
          },
        ]
      : []),
  ]);

  return serializeProposal(proposal as ProposalWithRelations);
}

/** Soft delete a proposal (sets deletedAt) with audit logging */
export async function deleteProposal(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'proposal.delete');

  const existing = await prisma.proposal.findFirst({
    where: { id, organizationId },
  });

  if (!existing || existing.deletedAt) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Cannot delete accepted proposals
  if (existing.status === 'accepted') {
    const error = new Error('Cannot delete an accepted proposal') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const proposal = await prisma.proposal.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'proposal.delete',
    entityType: 'Proposal',
    entityId: proposal.id,
    before: {
      id: existing.id,
      number: existing.number,
      title: existing.title,
      status: existing.status,
    },
    after: null,
    organizationId,
  });

  return { id: proposal.id, deletedAt: proposal.deletedAt };
}
