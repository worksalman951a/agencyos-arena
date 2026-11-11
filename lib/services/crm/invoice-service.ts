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
  allocateDocumentNumber,
  type PrismaTransactionClient,
} from '@/lib/services/settings/document-numbering';
import type {
  InvoiceCreateInput,
  InvoiceUpdateInput,
  InvoiceQueryInput,
  InvoiceLineItemInput,
  InvoicePaymentInput,
} from '@/lib/schemas/crm/invoice.schema';
import {
  INVOICE_INITIAL_STATUSES,
  INVOICE_EDITABLE_STATUSES,
  INVOICE_MANUAL_UPDATE_STATUSES,
  INVOICE_STATUS_TRANSITIONS,
} from '@/lib/schemas/crm/invoice-status';

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

const EDITABLE_STATUSES: readonly string[] = INVOICE_EDITABLE_STATUSES;
const VALID_TRANSITIONS: Partial<Record<string, readonly string[]>> = INVOICE_STATUS_TRANSITIONS;

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

/** Error carrying the HTTP status the route should answer with. */
function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

interface RecordedPaymentOutcome {
  payment: {
    id: string;
    invoiceId: string;
    amount: string;
    method: string;
    reference: string | null;
    paidAt: Date | null;
    recordedBy: string | null;
    createdAt: Date;
  };
  invoiceStatus: string;
  /** Status before this successful payment changed the invoice. */
  previousInvoiceStatus: string;
  /** Total recorded against the invoice, as decimal money. */
  amountPaid: string;
  /** Remaining balance, never negative. */
  balance: string;
  /** True when the request was an idempotent replay. */
  duplicate: boolean;
}

/**
 * Format a Prisma Decimal (or numeric string) as a fixed 2-decimal money string.
 *
 * Decimal.toString() drops trailing zeros (1700.00 -> "1700"), which made API
 * responses inconsistent between read and write paths. Money values are always
 * serialized with two decimals.
 */
function formatDecimalMoney(
  value: string | number | { toString(): string } | null | undefined
): string {
  if (value === null || value === undefined) return '0.00';
  const num = Number(value.toString());
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
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
    subtotal: formatDecimalMoney(invoice.subtotal),
    tax: formatDecimalMoney(invoice.tax),
    total: formatDecimalMoney(invoice.total),
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
      unitPrice: formatDecimalMoney(item.unitPrice),
      taxRate: item.taxRate.toString(),
      amount: formatDecimalMoney(item.amount),
      createdAt: item.createdAt,
    })),
    payments: (invoice.payments ?? []).map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amount: formatDecimalMoney(p.amount),
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
  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [invoices, total] = await Promise.all([
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

  // Keep the service boundary safe even when called without the HTTP schema.
  if (!(INVOICE_INITIAL_STATUSES as readonly string[]).includes(input.status)) {
    throw codedError(`Invalid initial invoice status: ${input.status}`, 400);
  }

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

  const { subtotal, tax, total } = calculateInvoiceTotals(lineItems);

  // Number allocation and row insertion share one transaction, so the
  // organization counter can never advance without an invoice and two
  // concurrent creates cannot receive the same number. Only ids/line items are
  // touched inside the transaction; the full record is re-read after commit.
  const createInvoiceInTransaction = () =>
    prisma.$transaction(async (tx: PrismaTransactionClient) => {
      const { number } = await allocateDocumentNumber(tx, organizationId, 'invoice');

      return tx.invoice.create({
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
        select: { id: true },
      });
    });

  // The unique index on (organizationId, number) is the database guarantee. It
  // can only fire if the stored numbers and the organization counter drifted
  // apart externally (import, manual SQL), so retry with a freshly allocated
  // number instead of failing the user's invoice.
  let created: { id: string } | undefined;
  for (let attempt = 1; attempt <= 3 && !created; attempt += 1) {
    try {
      created = await createInvoiceInTransaction();
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 3) throw error;
    }
  }
  if (!created) {
    throw codedError('Could not allocate a unique invoice number. Please retry.', 400);
  }

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: created.id },
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
      total: formatDecimalMoney(invoice.total),
      currency: invoice.currency,
    },
    organizationId,
  });

  await emitWorkflowEvent({ type: 'record.created', recordType: 'Invoice', recordId: invoice.id });

  return serializeInvoice(invoice as unknown as InvoiceDbRecord);
}

export async function updateInvoice(
  id: string,
  input: InvoiceUpdateInput,
  lineItems?: InvoiceLineItemInput[]
) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.update');

  // Do not let direct service callers mark an invoice paid or overdue. Payment
  // recording owns the paid transition; overdue requires a trusted aging job.
  if (
    input.status !== undefined &&
    !(INVOICE_MANUAL_UPDATE_STATUSES as readonly string[]).includes(input.status)
  ) {
    throw codedError(`Invalid manually-updatable invoice status: ${input.status}`, 400);
  }

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
      total: formatDecimalMoney(invoice.total),
    },
    organizationId,
  });

  await emitWorkflowEvents([
    { type: 'record.updated', recordType: 'Invoice', recordId: invoice.id },
    ...(existing.status !== invoice.status
      ? [
          {
            type: 'record.status_changed',
            recordType: 'Invoice',
            recordId: invoice.id,
            previousStatus: existing.status,
          },
        ]
      : []),
  ]);

  return serializeInvoice(invoice as unknown as InvoiceDbRecord);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/**
 * Re-read the payment that won a race on the idempotency unique index.
 *
 * The read-then-insert check inside the transaction covers sequential retries;
 * this is the last line of defence for two requests that both pass that check.
 */
async function replayRecordedPayment(
  invoiceId: string,
  organizationId: string,
  idempotencyKey: string
): Promise<RecordedPaymentOutcome | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId, deletedAt: null },
    include: { payments: true },
  });
  if (!invoice) return null;

  const payment = (invoice.payments ?? []).find(
    (row: { idempotencyKey: string | null }) => row.idempotencyKey === idempotencyKey
  );
  if (!payment) return null;

  const paidCents = (invoice.payments ?? []).reduce(
    (sum: number, row: { amount: { toString: () => string } }) =>
      sum + toCents(row.amount.toString()),
    0
  );
  const totalCents = toCents(invoice.total);

  return {
    payment: {
      id: payment.id,
      invoiceId: payment.invoiceId,
      amount: formatDecimalMoney(payment.amount),
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt,
      recordedBy: payment.recordedBy,
      createdAt: payment.createdAt,
    },
    invoiceStatus: invoice.status,
    previousInvoiceStatus: invoice.status,
    amountPaid: formatMoney(paidCents),
    balance: formatMoney(Math.max(totalCents - paidCents, 0)),
    duplicate: true,
  } as RecordedPaymentOutcome;
}

/**
 * Record a payment against an invoice.
 *
 * Financial-integrity rules (all enforced inside the transaction):
 *
 *  - the invoice is locked (`SELECT … FOR UPDATE`) so two concurrent payments
 *    cannot both pass the outstanding-balance check;
 *  - soft-deleted and voided invoices reject payments;
 *  - the outstanding balance is derived from **all** recorded payments, so
 *    partial payments accumulate and the invoice becomes `paid` only when it is
 *    actually covered;
 *  - overpayment is rejected instead of inflating collected revenue;
 *  - a supplied `idempotencyKey` returns the original payment instead of
 *    recording a duplicate when the same submission is retried.
 */
export async function recordPayment(invoiceId: string, input: InvoicePaymentInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'invoice.update');

  const paymentAmountCents = toCents(input.amount);
  if (!Number.isFinite(paymentAmountCents) || paymentAmountCents <= 0) {
    throw codedError('Payment amount must be greater than zero', 400);
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    throw codedError('Payment date is not a valid date', 400);
  }

  // Blank keys are keyless: the partial unique index skips NULLs, so storing
  // '' for "no key" would either collide or weaken the guarantee.
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  const recordPaymentInTransaction = () =>
    prisma.$transaction(async (tx: PrismaTransactionClient): Promise<RecordedPaymentOutcome> => {
      // Serialise concurrent payments for this invoice.
      await tx.$queryRawUnsafe('SELECT id FROM "Invoice" WHERE id = $1 FOR UPDATE', invoiceId);

      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId, deletedAt: null },
        include: { payments: { orderBy: { paidAt: 'desc' } } },
      });

      if (!invoice) throw codedError('Not found', 404);
      if (invoice.status === 'voided') {
        throw codedError('Cannot record a payment on a voided invoice', 400);
      }

      const payments = (invoice.payments ?? []) as Array<{
        id: string;
        invoiceId: string;
        amount: { toString: () => string };
        method: string;
        reference: string | null;
        paidAt: Date | null;
        recordedBy: string | null;
        createdAt: Date;
      }>;
      const paidCents = payments.reduce(
        (sum, payment) => sum + toCents(payment.amount.toString()),
        0
      );
      const totalCents = toCents(invoice.total);

      const serialize = (payment: (typeof payments)[number]) => ({
        id: payment.id,
        invoiceId: payment.invoiceId,
        amount: formatDecimalMoney(payment.amount),
        method: payment.method,
        reference: payment.reference,
        paidAt: payment.paidAt,
        recordedBy: payment.recordedBy,
        createdAt: payment.createdAt,
      });

      const summary = (paid: number, status: string, previousStatus: string) => ({
        invoiceStatus: status,
        previousInvoiceStatus: previousStatus,
        amountPaid: formatMoney(paid),
        balance: formatMoney(Math.max(totalCents - paid, 0)),
      });

      // Retried submission: return the payment that was already recorded.
      if (idempotencyKey) {
        const duplicate = await tx.payment.findFirst({
          where: { invoiceId, idempotencyKey },
        });
        if (duplicate) {
          return {
            payment: serialize(duplicate as (typeof payments)[number]),
            ...summary(paidCents, invoice.status, invoice.status),
            duplicate: true,
          };
        }
      }

      if (totalCents <= 0) {
        throw codedError('Cannot record a payment on an invoice without a total', 400);
      }

      const outstandingCents = Math.max(totalCents - paidCents, 0);
      if (paymentAmountCents > outstandingCents) {
        throw codedError(
          `Payment exceeds the outstanding balance of ${formatMoney(outstandingCents)}`,
          400
        );
      }

      const newPaidCents = paidCents + paymentAmountCents;
      const newStatus =
        newPaidCents >= totalCents ? 'paid' : invoice.status === 'overdue' ? 'overdue' : 'sent';

      const payment = await tx.payment.create({
        data: {
          invoiceId,
          amount: formatMoney(paymentAmountCents),
          method: input.method,
          reference: input.reference ?? null,
          paidAt,
          recordedBy: userId,
          idempotencyKey,
        },
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus, updatedBy: userId },
      });

      return {
        payment: serialize(payment as unknown as (typeof payments)[number]),
        ...summary(newPaidCents, newStatus, invoice.status),
        duplicate: false,
      };
    });

  let audited: RecordedPaymentOutcome;
  try {
    audited = await recordPaymentInTransaction();
  } catch (error) {
    // Two concurrent retries with the same key: the loser hits the partial
    // unique index. Replay the winner's payment instead of failing the request.
    const replayed =
      idempotencyKey && isUniqueViolation(error)
        ? await replayRecordedPayment(invoiceId, organizationId, idempotencyKey)
        : null;
    if (!replayed) throw error;
    audited = replayed;
  }

  if (!audited.duplicate) {
    await createAuditLog({
      actorId: userId,
      actorName: actorEmail,
      action: 'invoice.payment',
      entityType: 'Invoice',
      entityId: invoiceId,
      after: {
        id: invoiceId,
        status: audited.invoiceStatus,
        amountPaid: audited.amountPaid,
        balance: audited.balance,
      },
      organizationId,
    });
  }

  if (!audited.duplicate) {
    await emitWorkflowEvents([
      { type: 'record.updated', recordType: 'Invoice', recordId: invoiceId },
      ...(audited.previousInvoiceStatus !== audited.invoiceStatus
        ? [
            {
              type: 'record.status_changed',
              recordType: 'Invoice',
              recordId: invoiceId,
              previousStatus: audited.previousInvoiceStatus,
            },
          ]
        : []),
    ]);
  }

  const publicOutcome = { ...audited };
  delete (publicOutcome as Partial<RecordedPaymentOutcome>).previousInvoiceStatus;
  return publicOutcome as Omit<RecordedPaymentOutcome, 'previousInvoiceStatus'>;
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
