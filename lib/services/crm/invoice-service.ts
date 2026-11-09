'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  InvoiceCreateInput,
  InvoiceUpdateInput,
  InvoiceQueryInput,
  InvoiceLineItemInput,
  InvoicePaymentInput,
} from '@/lib/schemas/crm/invoice.schema';

/** Invoice serialization */
export interface InvoiceResponse {
  id: string;
  organizationId: string;
  number: string;
  clientId: string | null;
  title: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  dueDate: Date | null;
  notes: string | null;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; name: string | null; email: string | null } | null;
  updater: { id: string; name: string | null; email: string | null } | null;
  client: { id: string; firstName: string | null; lastName: string } | null;
  items: InvoiceLineItemResponse[];
  payments: InvoicePaymentResponse[];
}

export interface InvoiceLineItemResponse {
  id: string;
  invoiceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  amount: string;
  createdAt: Date;
}

export interface InvoicePaymentResponse {
  id: string;
  invoiceId: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: Date | null;
  recordedBy: string | null;
  createdAt: Date;
}

const EDITABLE_STATUSES = ['draft', 'sent'];

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'paid', 'voided'],
  sent: ['paid', 'voided'],
  paid: [],
  voided: [],
};

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

function toCents(value: string | number): number {
  const num = typeof value === 'string' ? parseDecimal(value) : value;
  return Math.round(num * 100);
}

function parseDecimal(value: string): number {
  const parsed = Number(value);
  return isNaN(parsed) ? 0 : parsed;
}

function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

function calculateInvoiceTotals(items: InvoiceLineItemInput[]) {
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

async function generateInvoiceNumber(organizationId: string): Promise<string> {
  const now = new Date();
  const year = now.getFullYear().toString();
  const prefixPattern = `INV-${year}`;

  const last = await prisma.invoice.findFirst({
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

  return `${prefixPattern}-${seq.toString().padStart(4, '0')}`;
}

type InvoiceDbRecord = {
  id: string;
  organizationId: string;
  number: string;
  clientId: string | null;
  title: string;
  status: string;
  subtotal: { toString: () => string };
  tax: { toString: () => string };
  total: { toString: () => string };
  currency: string;
  dueDate: Date | null;
  notes: string | null;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; name: string | null; email: string | null } | null;
  updater: { id: string; name: string | null; email: string | null } | null;
  client: { id: string; firstName: string | null; lastName: string } | null;
  items: Array<{
    id: string;
    invoiceId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    amount: { toString: () => string };
    createdAt: Date;
  }>;
  payments: Array<{
    id: string;
    invoiceId: string;
    amount: { toString: () => string };
    method: string;
    reference: string | null;
    paidAt: Date | null;
    recordedBy: string | null;
    createdAt: Date;
  }>;
};

function serializeInvoice(invoice: InvoiceDbRecord): InvoiceResponse {
  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    number: invoice.number,
    clientId: invoice.clientId,
    title: invoice.title,
    status: invoice.status,
    subtotal: invoice.subtotal.toString(),
    tax: invoice.tax.toString(),
    total: invoice.total.toString(),
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    deletedAt: invoice.deletedAt,
    createdBy: invoice.createdBy,
    updatedBy: invoice.updatedBy,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    creator: invoice.creator
      ? { id: invoice.creator.id, name: invoice.creator.name, email: invoice.creator.email }
      : null,
    updater: invoice.updater
      ? { id: invoice.updater.id, name: invoice.updater.name, email: invoice.updater.email }
      : null,
    client: invoice.client
      ? {
          id: invoice.client.id,
          firstName: invoice.client.firstName,
          lastName: invoice.client.lastName,
        }
      : null,
    items: (invoice.items ?? []).map((item) => ({
      id: item.id,
      invoiceId: item.invoiceId,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      taxRate: item.taxRate.toString(),
      amount: item.amount.toString(),
      createdAt: item.createdAt,
    })),
    payments: (invoice.payments ?? []).map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amount: p.amount.toString(),
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt,
      recordedBy: p.recordedBy,
      createdAt: p.createdAt,
    })),
  };
}

function buildInvoiceWhere(organizationId: string, input: InvoiceQueryInput) {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (!input.includeDeleted) {
    where.deletedAt = null;
  }

  if (input.clientId) {
    where.clientId = input.clientId;
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

export async function listInvoices(input: InvoiceQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.read');

  const where = buildInvoiceWhere(organizationId, input);
  const [invoices, total] = await prisma.$transaction([
    prisma.invoice.findMany({
      where,
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        client: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    invoices: invoices.map((i: InvoiceDbRecord) => serializeInvoice(i)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

export async function getInvoice(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.read');

  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { paidAt: 'desc' } },
      client: { select: { id: true, firstName: true, lastName: true } },
      creator: { select: { id: true, name: true, email: true } },
      updater: { select: { id: true, name: true, email: true } },
    },
  });

  if (!invoice) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeInvoice(invoice as unknown as InvoiceDbRecord);
}

export async function createInvoice(input: InvoiceCreateInput, lineItems: InvoiceLineItemInput[]) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.create');

  if (input.clientId) {
    const client = await prisma.contact.findFirst({
      where: { id: input.clientId, organizationId },
    });
    if (!client) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const number = await generateInvoiceNumber(organizationId);

  const { subtotal, tax, total } = calculateInvoiceTotals(lineItems);

  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      number,
      clientId: input.clientId ?? null,
      title: input.title,
      status: input.status,
      subtotal,
      tax,
      total,
      currency: input.currency,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      notes: input.notes ?? null,
      createdBy: userId,
      updatedBy: userId,
      items: {
        create: lineItems.map((item) => {
          const qtyCents = toCents(item.quantity);
          const priceCents = toCents(item.unitPrice);
          const itemAmountCents = Math.round((qtyCents * priceCents) / 100);
          return {
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate),
            amount: formatMoney(itemAmountCents),
          };
        }),
      },
    },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { paidAt: 'desc' } },
      client: { select: { id: true, firstName: true, lastName: true } },
      creator: { select: { id: true, name: true, email: true } },
      updater: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'invoice.create',
    entityType: 'Invoice',
    entityId: invoice.id,
    after: {
      id: invoice.id,
      number: invoice.number,
      title: invoice.title,
      status: invoice.status,
      total: invoice.total.toString(),
      currency: invoice.currency,
    },
    organizationId,
  });

  return serializeInvoice(invoice as unknown as InvoiceDbRecord);
}

export async function updateInvoice(
  id: string,
  input: InvoiceUpdateInput,
  lineItems?: InvoiceLineItemInput[]
) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.update');

  const existing = await prisma.invoice.findFirst({
    where: { id, organizationId },
    include: { items: true },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (!EDITABLE_STATUSES.includes(existing.status)) {
    const error = new Error(
      'Cannot modify an invoice that is not in draft or sent status'
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

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

  if (input.clientId !== undefined && input.clientId !== null) {
    const client = await prisma.contact.findFirst({
      where: { id: input.clientId, organizationId },
    });
    if (!client) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  let subtotal = formatMoney(toCents(existing.subtotal));
  let tax = formatMoney(toCents(existing.tax));
  let total = formatMoney(toCents(existing.total));

  if (lineItems) {
    const { subtotal: s, tax: t, total: tot } = calculateInvoiceTotals(lineItems);
    subtotal = s;
    tax = t;
    total = tot;
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      clientId: input.clientId ?? existing.clientId,
      title: input.title ?? existing.title,
      status: input.status ?? existing.status,
      subtotal,
      tax,
      total,
      currency: input.currency ?? existing.currency,
      dueDate:
        input.dueDate !== undefined
          ? input.dueDate
            ? new Date(input.dueDate)
            : null
          : existing.dueDate,
      notes: input.notes ?? existing.notes,
      updatedBy: userId,
      ...(lineItems
        ? {
            items: {
              deleteMany: {},
              create: lineItems.map((item) => {
                const qtyCents = toCents(item.quantity);
                const priceCents = toCents(item.unitPrice);
                const itemAmountCents = Math.round((qtyCents * priceCents) / 100);
                return {
                  description: item.description,
                  quantity: Number(item.quantity),
                  unitPrice: Number(item.unitPrice),
                  taxRate: Number(item.taxRate),
                  amount: formatMoney(itemAmountCents),
                };
              }),
            },
          }
        : {}),
    },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { paidAt: 'desc' } },
      client: { select: { id: true, firstName: true, lastName: true } },
      creator: { select: { id: true, name: true, email: true } },
      updater: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'invoice.update',
    entityType: 'Invoice',
    entityId: invoice.id,
    before: {
      id: existing.id,
      title: existing.title,
      status: existing.status,
      total: existing.total.toString(),
    },
    after: {
      id: invoice.id,
      title: invoice.title,
      status: invoice.status,
      total: invoice.total.toString(),
    },
    organizationId,
  });

  return serializeInvoice(invoice as unknown as InvoiceDbRecord);
}

export async function recordPayment(invoiceId: string, input: InvoicePaymentInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.update');

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
  });

  if (!invoice) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (invoice.status === 'voided') {
    const error = new Error('Cannot record a payment on a voided invoice') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const paymentAmountCents = toCents(input.amount);
  const existingTotalCents = toCents(invoice.total);
  const existingPaidCents = invoice.payments
    ? invoice.payments.reduce((sum: number, p: { amount: string }) => sum + toCents(p.amount), 0)
    : 0;
  const newPaidCents = existingPaidCents + paymentAmountCents;

  let newStatus = invoice.status;
  if (newPaidCents >= existingTotalCents && existingTotalCents > 0) {
    newStatus = 'paid';
  } else if (newPaidCents > 0) {
    newStatus = 'sent';
  }

  const payment = await prisma.payment.create({
    data: {
      invoiceId,
      amount: formatMoney(paymentAmountCents),
      method: input.method,
      reference: input.reference ?? null,
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      recordedBy: userId,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: newStatus, updatedBy: userId },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'invoice.payment',
    entityType: 'Invoice',
    entityId: invoiceId,
    after: {
      id: invoiceId,
      status: newStatus,
      totalPaidCents: newPaidCents,
    },
    organizationId,
  });

  return {
    payment: {
      id: payment.id,
      invoiceId: payment.invoiceId,
      amount: payment.amount.toString(),
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt,
      recordedBy: payment.recordedBy,
      createdAt: payment.createdAt,
    },
    invoiceStatus: newStatus,
  };
}

export async function deleteInvoice(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.delete');

  const existing = await prisma.invoice.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (existing.status === 'paid') {
    const error = new Error('Cannot delete a paid invoice') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'invoice.delete',
    entityType: 'Invoice',
    entityId: invoice.id,
    before: {
      id: existing.id,
      number: existing.number,
      title: existing.title,
      status: existing.status,
    },
    after: null,
    organizationId,
  });

  return { id: invoice.id, deletedAt: invoice.deletedAt };
}
