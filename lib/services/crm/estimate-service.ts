'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  EstimateCreateInput,
  EstimateUpdateInput,
  EstimateConvertInput,
} from '@/lib/schemas/crm/estimate.schema';
import {
  allocateDocumentNumber,
  type PrismaTransactionClient,
} from '@/lib/services/settings/document-numbering';

/** Error carrying the HTTP status the route should answer with. */
function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

export interface EstimateResponse {
  id: string;
  organizationId: string;
  number: string;
  clientId: string;
  status: string;
  total: string;
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EstimateRecord {
  id: string;
  organizationId: string;
  number: string;
  clientId: string;
  status: string;
  total: { toString: () => string };
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
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

export async function listEstimates() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.read');

  const estimates = await prisma.estimate.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });

  return estimates.map((e: EstimateRecord) => ({
    id: e.id,
    organizationId: e.organizationId,
    number: e.number,
    clientId: e.clientId,
    status: e.status,
    total: e.total.toString(),
    currency: e.currency,
    validUntil: e.validUntil,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
}

export async function getEstimate(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.read');

  const estimate = await prisma.estimate.findFirst({
    where: { id, organizationId },
  });

  if (!estimate) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return {
    id: estimate.id,
    organizationId: estimate.organizationId,
    number: estimate.number,
    clientId: estimate.clientId,
    status: estimate.status,
    total: estimate.total.toString(),
    currency: estimate.currency,
    validUntil: estimate.validUntil,
    notes: estimate.notes,
    createdAt: estimate.createdAt,
    updatedAt: estimate.updatedAt,
  };
}

export async function createEstimate(input: EstimateCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.create');

  // Verify client belongs to org
  const client = await prisma.contact.findFirst({
    where: { id: input.clientId, organizationId },
  });

  if (!client) {
    const error = new Error('Client not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const estimate = await prisma.estimate.create({
    data: {
      organizationId,
      number: input.number,
      clientId: input.clientId,
      status: input.status,
      total: Number(input.total),
      currency: input.currency,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      notes: input.notes ?? null,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'estimate.create',
    entityType: 'Estimate',
    entityId: estimate.id,
    after: {
      id: estimate.id,
      number: estimate.number,
      clientId: estimate.clientId,
      total: estimate.total.toString(),
      status: estimate.status,
    },
    organizationId,
  });

  return {
    id: estimate.id,
    organizationId: estimate.organizationId,
    number: estimate.number,
    clientId: estimate.clientId,
    status: estimate.status,
    total: estimate.total.toString(),
    currency: estimate.currency,
    validUntil: estimate.validUntil,
    notes: estimate.notes,
    createdAt: estimate.createdAt,
    updatedAt: estimate.updatedAt,
  };
}

export async function updateEstimate(id: string, input: EstimateUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.update');

  const existing = await prisma.estimate.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const estimate = await prisma.estimate.update({
    where: { id },
    data: {
      clientId: input.clientId ?? existing.clientId,
      number: input.number ?? existing.number,
      status: input.status ?? existing.status,
      total: input.total !== undefined ? Number(input.total) : existing.total,
      currency: input.currency ?? existing.currency,
      validUntil:
        input.validUntil !== undefined
          ? input.validUntil
            ? new Date(input.validUntil)
            : null
          : existing.validUntil,
      notes: input.notes !== undefined ? input.notes : existing.notes,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'estimate.update',
    entityType: 'Estimate',
    entityId: estimate.id,
    before: { id: existing.id, status: existing.status, total: existing.total.toString() },
    after: { id: estimate.id, status: estimate.status, total: estimate.total.toString() },
    organizationId,
  });

  return {
    id: estimate.id,
    organizationId: estimate.organizationId,
    number: estimate.number,
    clientId: estimate.clientId,
    status: estimate.status,
    total: estimate.total.toString(),
    currency: estimate.currency,
    validUntil: estimate.validUntil,
    notes: estimate.notes,
    createdAt: estimate.createdAt,
    updatedAt: estimate.updatedAt,
  };
}

export async function deleteEstimate(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.delete');

  const existing = await prisma.estimate.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await prisma.estimate.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'estimate.delete',
    entityType: 'Estimate',
    entityId: id,
    before: { id: existing.id, number: existing.number, status: existing.status },
    after: null,
    organizationId,
  });

  return { id };
}

/**
 * Convert an accepted estimate into a draft invoice.
 *
 * The whole conversion runs in one transaction with the estimate row locked:
 *
 *  - the invoice number comes from the organization's allocator (`PREFIX-YYYY-NNNN`)
 *    instead of the client-supplied `invoiceNumber`, so conversions can never
 *    reuse or collide with an issued number;
 *  - the estimate's amount and currency are carried over, because an estimate has
 *    a single total and no line items in the current schema;
 *  - the estimate is marked `converted` only after the invoice exists, so a
 *    failure leaves the estimate convertible instead of stranding it.
 */
export async function convertEstimateToInvoice(id: string, input: EstimateConvertInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.update');
  await requirePermission(userId, organizationId, 'invoice.create');

  const dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    throw codedError('Due date is not a valid date', 400);
  }

  const result = await prisma.$transaction(
    async (tx: PrismaTransactionClient): Promise<{ invoiceId: string; invoiceNumber: string }> => {
      // Two conversions of the same estimate must not both create an invoice.
      await tx.$queryRawUnsafe('SELECT id FROM "Estimate" WHERE id = $1 FOR UPDATE', id);

      const estimate = await tx.estimate.findFirst({ where: { id, organizationId } });
      if (!estimate) throw codedError('Not found', 404);

      if (estimate.status !== 'accepted') {
        throw codedError('Only accepted estimates can be converted to invoices', 400);
      }

      const { number } = await allocateDocumentNumber(tx, organizationId, 'invoice');

      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          number,
          clientId: estimate.clientId,
          title: input.invoiceTitle,
          status: 'draft',
          currency: estimate.currency,
          subtotal: estimate.total,
          tax: 0,
          total: estimate.total,
          dueDate,
          notes: estimate.notes ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await tx.estimate.update({ where: { id }, data: { status: 'converted' } });

      return { invoiceId: invoice.id, invoiceNumber: invoice.number };
    }
  );

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'estimate.convert',
    entityType: 'Estimate',
    entityId: id,
    after: {
      estimateId: id,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
    },
    organizationId,
  });

  return {
    estimateId: id,
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
  };
}
