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

export interface EstimateClientSummary {
  id: string;
  firstName: string | null;
  lastName: string;
  email: string | null;
}

export interface EstimateResponse {
  id: string;
  organizationId: string;
  number: string;
  clientId: string;
  client: EstimateClientSummary | null;
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
  total: { toString: () => string } | number | string;
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const EDITABLE_ESTIMATE_STATUSES = ['draft', 'sent'];

const VALID_ESTIMATE_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'accepted', 'rejected', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [], // immutable except conversion via convertEstimateToInvoice
  rejected: [],
  expired: [],
  converted: [],
};

function formatMoneyValue(value: { toString: () => string } | number | string): string {
  const num = Number(
    typeof value === 'string' || typeof value === 'number' ? value : value.toString()
  );
  return Number.isFinite(num) ? num.toFixed(2) : String(value);
}

async function resolveContactsById(
  organizationId: string,
  clientIds: string[]
): Promise<Map<string, EstimateClientSummary>> {
  const map = new Map<string, EstimateClientSummary>();
  if (clientIds.length === 0) return map;
  const contactModel = (
    prisma as unknown as {
      contact?: {
        findMany?: (args: unknown) => Promise<EstimateClientSummary[]>;
      };
    }
  ).contact;
  if (typeof contactModel?.findMany !== 'function') {
    return map;
  }

  const uniqueIds = Array.from(new Set(clientIds));
  const contacts = await contactModel.findMany({
    where: { organizationId, id: { in: uniqueIds }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  for (const c of contacts) {
    map.set(c.id, {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
    });
  }
  return map;
}

function serializeEstimate(
  estimate: EstimateRecord,
  client: EstimateClientSummary | null = null
): EstimateResponse {
  return {
    id: estimate.id,
    organizationId: estimate.organizationId,
    number: estimate.number,
    clientId: estimate.clientId,
    client,
    status: estimate.status,
    total: formatMoneyValue(estimate.total),
    currency: estimate.currency,
    validUntil: estimate.validUntil,
    notes: estimate.notes,
    createdAt: estimate.createdAt,
    updatedAt: estimate.updatedAt,
  };
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

export async function listEstimates(): Promise<EstimateResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.read');

  const estimates = (await prisma.estimate.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  })) as EstimateRecord[];

  const contactsMap = await resolveContactsById(
    organizationId,
    estimates.map((e) => e.clientId)
  );

  return estimates.map((e) => serializeEstimate(e, contactsMap.get(e.clientId) ?? null));
}

export async function getEstimate(id: string): Promise<EstimateResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.read');

  const estimate = (await prisma.estimate.findFirst({
    where: { id, organizationId },
  })) as EstimateRecord | null;

  if (!estimate) {
    throw codedError('Not found', 404);
  }

  const contactsMap = await resolveContactsById(organizationId, [estimate.clientId]);
  return serializeEstimate(estimate, contactsMap.get(estimate.clientId) ?? null);
}

export async function createEstimate(input: EstimateCreateInput): Promise<EstimateResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.create');

  // Verify client belongs to org and is not soft-deleted
  const client = await prisma.contact.findFirst({
    where: { id: input.clientId, organizationId },
  });

  if (!client || (client as { deletedAt?: Date | null }).deletedAt) {
    throw codedError('Client not found', 404);
  }

  // Prevent duplicate estimate numbers inside the same organization
  const duplicate = await prisma.estimate.findFirst({
    where: { organizationId, number: input.number },
  });
  if (duplicate) {
    throw codedError(`Estimate number ${input.number} already exists in this organization`, 409);
  }

  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) {
    throw codedError('Valid until date is not valid', 400);
  }

  const estimate = (await prisma.estimate.create({
    data: {
      organizationId,
      number: input.number,
      clientId: input.clientId,
      status: input.status,
      total: formatMoneyValue(input.total),
      currency: input.currency,
      validUntil,
      notes: input.notes ?? null,
    },
  })) as EstimateRecord;

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
      total: formatMoneyValue(estimate.total),
      status: estimate.status,
    },
    organizationId,
  });

  const c = client as {
    id: string;
    firstName?: string | null;
    lastName?: string;
    email?: string | null;
  };

  return serializeEstimate(estimate, {
    id: c.id,
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? '',
    email: c.email ?? null,
  });
}

export async function updateEstimate(
  id: string,
  input: EstimateUpdateInput
): Promise<EstimateResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.update');

  const existing = (await prisma.estimate.findFirst({
    where: { id, organizationId },
  })) as EstimateRecord | null;

  if (!existing) {
    throw codedError('Not found', 404);
  }

  if (!EDITABLE_ESTIMATE_STATUSES.includes(existing.status)) {
    throw codedError(`Cannot modify an estimate in ${existing.status} status`, 400);
  }

  if (input.status !== undefined && input.status !== existing.status) {
    const allowed = VALID_ESTIMATE_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw codedError(
        `Invalid estimate status transition from ${existing.status} to ${input.status}`,
        400
      );
    }
  }

  // Validate cross-org clientId if changed
  if (input.clientId !== undefined) {
    const client = await prisma.contact.findFirst({
      where: { id: input.clientId, organizationId },
    });
    if (!client || (client as { deletedAt?: Date | null }).deletedAt) {
      throw codedError('Client not found', 404);
    }
  }

  // Prevent duplicate estimate numbers inside the same organization
  if (input.number !== undefined && input.number !== existing.number) {
    const duplicate = await prisma.estimate.findFirst({
      where: { organizationId, number: input.number },
    });
    if (duplicate && duplicate.id !== id) {
      throw codedError(`Estimate number ${input.number} already exists in this organization`, 409);
    }
  }

  let nextValidUntil = existing.validUntil;
  if (input.validUntil !== undefined) {
    if (input.validUntil === null || input.validUntil === '') {
      nextValidUntil = null;
    } else {
      const parsedDate = new Date(input.validUntil);
      if (Number.isNaN(parsedDate.getTime())) {
        throw codedError('Valid until date is not valid', 400);
      }
      nextValidUntil = parsedDate;
    }
  }

  const estimate = (await prisma.estimate.update({
    where: { id },
    data: {
      clientId: input.clientId ?? existing.clientId,
      number: input.number ?? existing.number,
      status: input.status ?? existing.status,
      total: input.total !== undefined ? formatMoneyValue(input.total) : existing.total,
      currency: input.currency ?? existing.currency,
      validUntil: nextValidUntil,
      notes: input.notes !== undefined ? input.notes : existing.notes,
    },
  })) as EstimateRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'estimate.update',
    entityType: 'Estimate',
    entityId: estimate.id,
    before: { id: existing.id, status: existing.status, total: formatMoneyValue(existing.total) },
    after: { id: estimate.id, status: estimate.status, total: formatMoneyValue(estimate.total) },
    organizationId,
  });

  const contactsMap = await resolveContactsById(organizationId, [estimate.clientId]);
  return serializeEstimate(estimate, contactsMap.get(estimate.clientId) ?? null);
}

export async function deleteEstimate(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'estimate.delete');

  const existing = await prisma.estimate.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw codedError('Not found', 404);
  }

  if (existing.status === 'accepted' || existing.status === 'converted') {
    throw codedError(`Cannot delete an ${existing.status} estimate`, 400);
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
