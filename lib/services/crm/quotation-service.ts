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
  QuotationCreateInput,
  QuotationUpdateInput,
  QuotationQueryInput,
  QuotationLineItemInput,
} from '@/lib/schemas/crm/quotation.schema';

/** Quotation serialization with server-calculated totals */
export interface QuotationResponse {
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
  items: QuotationLineItemResponse[];
}

export interface QuotationLineItemResponse {
  id: string;
  quotationId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  amount: string;
  sortOrder: number;
  createdAt: Date;
}

/** Quotation statuses that allow editing (immutable once accepted) */
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

/** Allocate the next quotation number inside an active transaction */
async function allocateQuotationNumberInTx(
  tx: typeof prisma,
  organizationId: string,
  prefix: string
): Promise<string> {
  if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
    await (
      tx as { $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown> }
    ).$queryRawUnsafe('SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE', organizationId);
  }

  const year = new Date().getFullYear().toString();
  const prefixPattern = `${prefix}-${year}`;

  const last = await tx.quotation.findFirst({
    where: {
      organizationId,
      number: {
        startsWith: prefixPattern,
      },
    },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  let seq = 1;
  if (last?.number) {
    const match = last.number.match(/-(\d+)$/);
    if (match) {
      seq = parseInt(match[1], 10) + 1;
    }
  }

  const nextNumber = `${prefixPattern}-${seq.toString().padStart(4, '0')}`;

  const existing = await tx.quotation.findUnique({
    where: {
      organizationId_number: {
        organizationId,
        number: nextNumber,
      },
    },
  });

  if (existing) {
    throw new Error('NUMBER_COLLISION');
  }

  return nextNumber;
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
function calculateLineItemTotals(items: QuotationLineItemInput[]) {
  let subtotalCents = 0;
  let taxCents = 0;

  for (const item of items) {
    const qtyCents = toCents(item.quantity);
    const priceCents = toCents(item.unitPrice);
    const rate = parseDecimal(item.taxRate);

    const itemAmountCents = Math.round((qtyCents * priceCents) / 100);
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

/** Prisma quotation result type with all relations */
type QuotationWithRelations = {
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
    quotationId: string;
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

function serializeQuotation(quotation: QuotationWithRelations): QuotationResponse {
  return {
    id: quotation.id,
    organizationId: quotation.organizationId,
    number: quotation.number,
    opportunityId: quotation.opportunityId,
    contactId: quotation.contactId,
    title: quotation.title,
    status: quotation.status,
    subtotal: formatMoneyValue(quotation.subtotal),
    tax: formatMoneyValue(quotation.tax),
    total: formatMoneyValue(quotation.total),
    currency: quotation.currency,
    validUntil: quotation.validUntil,
    notes: quotation.notes,
    deletedAt: quotation.deletedAt,
    createdBy: quotation.createdBy,
    updatedBy: quotation.updatedBy,
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
    creator: quotation.creator
      ? { id: quotation.creator.id, name: quotation.creator.name, email: quotation.creator.email }
      : null,
    updater: quotation.updater
      ? { id: quotation.updater.id, name: quotation.updater.name, email: quotation.updater.email }
      : null,
    opportunity: quotation.opportunity
      ? { id: quotation.opportunity.id, title: quotation.opportunity.title }
      : null,
    contact: quotation.contact
      ? {
          id: quotation.contact.id,
          firstName: quotation.contact.firstName,
          lastName: quotation.contact.lastName,
        }
      : null,
    items: quotation.items.map((item) => ({
      id: item.id,
      quotationId: item.quotationId,
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

/** Build where clause for organization-scoped quotation queries */
function buildQuotationWhere(organizationId: string, input: QuotationQueryInput) {
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

/** List quotations with organization scoping, soft-delete filtering, and pagination */
export async function listQuotations(input: QuotationQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'quotation.read');

  const where = buildQuotationWhere(organizationId, input);
  const [quotations, total] = await Promise.all([
    prisma.quotation.findMany({
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
    prisma.quotation.count({ where }),
  ]);

  return {
    quotations: quotations.map((q: QuotationWithRelations) => serializeQuotation(q)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get a single quotation by ID with organization isolation (non-disclosing 404 for cross-org or deleted) */
export async function getQuotation(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'quotation.read');

  const quotation = await prisma.quotation.findFirst({
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

  if (!quotation || quotation.deletedAt) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeQuotation(quotation as QuotationWithRelations);
}

/** Create a quotation with atomic document numbering, server-calculated totals, org scoping, and audit logging */
export async function createQuotation(
  input: QuotationCreateInput,
  lineItems: QuotationLineItemInput[]
) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'quotation.create');

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

  let quotation: QuotationWithRelations | null = null;
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      quotation = (await prisma.$transaction(async (tx: typeof prisma) => {
        const number = await allocateQuotationNumberInTx(tx, organizationId, 'QOT');

        return tx.quotation.create({
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
      })) as QuotationWithRelations;
      break;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if ((err as Error).message === 'NUMBER_COLLISION' || code === 'P2002') {
        continue;
      }
      throw err;
    }
  }

  if (!quotation) {
    const error = new Error('Failed to generate unique document number') as Error & {
      statusCode?: number;
    };
    error.statusCode = 500;
    throw error;
  }

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'quotation.create',
    entityType: 'Quotation',
    entityId: quotation.id,
    after: {
      id: quotation.id,
      number: quotation.number,
      title: quotation.title,
      status: quotation.status,
      total: quotation.total.toString(),
      currency: quotation.currency,
    },
    organizationId,
  });

  await emitWorkflowEvent({
    type: 'record.created',
    recordType: 'Quotation',
    recordId: quotation.id,
  });

  return serializeQuotation(quotation);
}

/** Update a quotation with server-calculated totals, organization scoping, and audit logging */
export async function updateQuotation(
  id: string,
  input: QuotationUpdateInput,
  lineItems?: QuotationLineItemInput[]
) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'quotation.update');

  // Verify quotation exists, is not soft-deleted, and belongs to the user's organization
  const existing = await prisma.quotation.findFirst({
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
      'Cannot modify a quotation that is not in draft or sent status'
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

  const quotation = await prisma.quotation.update({
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
    action: 'quotation.update',
    entityType: 'Quotation',
    entityId: quotation.id,
    before: {
      id: existing.id,
      title: existing.title,
      status: existing.status,
      total: existing.total.toString(),
    },
    after: {
      id: quotation.id,
      title: quotation.title,
      status: quotation.status,
      total: quotation.total.toString(),
    },
    organizationId,
  });

  await emitWorkflowEvents([
    { type: 'record.updated', recordType: 'Quotation', recordId: quotation.id },
    ...(existing.status !== quotation.status
      ? [
          {
            type: 'record.status_changed',
            recordType: 'Quotation',
            recordId: quotation.id,
            previousStatus: existing.status,
          },
        ]
      : []),
  ]);

  return serializeQuotation(quotation as QuotationWithRelations);
}

/** Soft delete a quotation (sets deletedAt) with audit logging */
export async function deleteQuotation(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'quotation.delete');

  const existing = await prisma.quotation.findFirst({
    where: { id, organizationId },
  });

  if (!existing || existing.deletedAt) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Cannot delete accepted quotations
  if (existing.status === 'accepted') {
    const error = new Error('Cannot delete an accepted quotation') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const quotation = await prisma.quotation.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'quotation.delete',
    entityType: 'Quotation',
    entityId: quotation.id,
    before: {
      id: existing.id,
      number: existing.number,
      title: existing.title,
      status: existing.status,
    },
    after: null,
    organizationId,
  });

  return { id: quotation.id, deletedAt: quotation.deletedAt };
}
