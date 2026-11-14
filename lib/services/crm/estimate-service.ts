/**
 * Estimate service — historical, read-only.
 *
 * Estimates were retired when the approved Quotation → Invoice workflow
 * (agreement optional) replaced them. Existing estimate rows are preserved for
 * history and stay fully readable: listing, detail, PDF rendering and public
 * share links keep working, scoped to the caller's organization and gated by
 * `estimate.read`.
 *
 * There is intentionally **no write path here any more**. Create, edit,
 * duplicate, send, status changes, delete and conversion to invoice were
 * removed rather than merely hidden, so no internal caller, automation or
 * integration can mutate a historical estimate:
 *
 *  - the mutation functions are gone (they throw
 *    {@link estimateRetiredError} with 403 if anything still calls them);
 *  - the retired API routes answer the same coded refusal before doing any
 *    work;
 *  - automation cannot write an Estimate either, because the workflow
 *    executor's writable-record allow-list no longer contains it.
 *
 * New billing starts from an accepted quotation:
 *   POST /api/v1/crm/quotations/[id]/invoice
 *   POST /api/v1/crm/quotations/[id]/agreement
 */

'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  RETIRED_ESTIMATE_ACTIONS,
  estimateRetiredError,
  type RetiredEstimateAction,
} from '@/lib/sales/estimate-retirement';

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

/**
 * Retired write paths.
 *
 * The product no longer offers any estimate mutation. These exported stubs keep
 * a stable, typed symbol for anything (an internal caller, a server action, a
 * script) that still references them, and fail closed with the same coded 403
 * refusal the retired API routes return instead of silently writing a
 * historical record.
 *
 * They perform **no** session lookup, permission check or database access: the
 * refusal is unconditional, so it cannot leak record existence and cannot be
 * side-stepped by a caller that skips authorization.
 */
function refuseEstimateMutation(action: RetiredEstimateAction): never {
  throw estimateRetiredError(action);
}

/** @deprecated Estimates are read-only; create invoices from an accepted quotation. */
export async function createEstimate(): Promise<never> {
  return refuseEstimateMutation('create');
}

/** @deprecated Estimates are read-only; create invoices from an accepted quotation. */
export async function updateEstimate(): Promise<never> {
  return refuseEstimateMutation('edit');
}

/** @deprecated Estimates are read-only; create invoices from an accepted quotation. */
export async function duplicateEstimate(): Promise<never> {
  return refuseEstimateMutation('duplicate');
}

/** @deprecated Estimates are read-only; create invoices from an accepted quotation. */
export async function sendEstimate(): Promise<never> {
  return refuseEstimateMutation('send');
}

/** @deprecated Estimates are read-only; create invoices from an accepted quotation. */
export async function transitionEstimateStatus(): Promise<never> {
  return refuseEstimateMutation('status_change');
}

/** @deprecated Estimates are read-only; create invoices from an accepted quotation. */
export async function deleteEstimate(): Promise<never> {
  return refuseEstimateMutation('delete');
}

/** @deprecated Estimates are read-only; create invoices from an accepted quotation. */
export async function convertEstimateToInvoice(): Promise<never> {
  return refuseEstimateMutation('convert');
}

/**
 * Every retired action, exported for tests and callers that want to document
 * the full refusal surface in one place.
 */
export { RETIRED_ESTIMATE_ACTIONS };
