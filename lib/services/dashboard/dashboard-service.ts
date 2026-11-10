/**
 * Dashboard metrics.
 *
 * Every figure is derived from real, organization-scoped rows — this service
 * replaces the hardcoded `$0.00 / "No invoices yet"` placeholders that made the
 * dashboard lie after invoices had been created.
 *
 * Definitions (deliberately distinct):
 *
 *  • Total Invoiced            invoices that have been issued (sent / paid /
 *                              overdue). Drafts are not invoiced; voided
 *                              invoices and soft-deleted rows never count.
 *  • Total Collected           payments actually recorded against issued
 *                              invoices (`Payment.paidAt` is required by the
 *                              schema, so every row is collected money).
 *  • Outstanding Receivables   per invoice: max(total − payments, 0), summed
 *                              over issued invoices.
 *  • Overdue Amount            the same outstanding amount, limited to issued
 *                              invoices whose due date has passed.
 *
 * Money rules:
 *  • amounts are summed per currency in SQL and never combined across
 *    currencies — there is no exchange-rate conversion anywhere;
 *  • every sum is exact integer minor units (NUMERIC sums cast to text, parsed
 *    digit by digit), never floating point;
 *  • partial payments are included, multiple payments per invoice are summed
 *    once per invoice (the LEFT JOIN aggregates them first, so an invoice with
 *    three payments cannot triple its total);
 *  • historical rows are never modified — this is a read-only projection.
 */

import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { hasPermission, requireOrganization } from '@/lib/permissions';
import { normalizeOrganizationSettings } from '@/lib/schemas/settings/organization.schema';
import { parseAmountToMinorUnits, normalizeCurrencyCode, DEFAULT_CURRENCY } from '@/lib/currencies';

import {
  DASHBOARD_TOTALS_SQL,
  buildDashboardMetrics,
  type DashboardMetrics,
  type Permissioned,
  type RawCurrencyTotals,
} from '@/lib/services/dashboard/dashboard-metrics';

export {
  DASHBOARD_TOTALS_SQL,
  EMPTY_CURRENCY_TOTALS,
  buildDashboardMetrics,
  mapRawCurrencyTotals,
} from '@/lib/services/dashboard/dashboard-metrics';
export type {
  CurrencyTotals,
  DashboardMetrics,
  Permissioned,
  RawCurrencyTotals,
} from '@/lib/services/dashboard/dashboard-metrics';

const FINANCIAL_PERMISSION = 'invoice.read';

/** Resolve the signed-in user and their organization, or null when signed out. */
async function getActor(): Promise<{ userId: string; organizationId: string } | null> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({ headers: { cookie: cookieStore.toString() } });
  if (!result?.session || !result.user) return null;
  const { organizationId } = await requireOrganization(result.user.id);
  return { userId: result.user.id, organizationId };
}

/**
 * Dashboard financial metrics for the signed-in user's organization.
 *
 * Returns `{ ok: false }` for a user without `invoice.read` so the dashboard can
 * explain the restriction instead of rendering misleading zeros. Organization
 * isolation is enforced by the `organizationId` parameter resolved from the
 * session — never from the client.
 */
export async function getDashboardMetrics(): Promise<Permissioned<DashboardMetrics>> {
  const actor = await getActor();
  if (!actor) return { ok: false, reason: 'forbidden' };

  const { userId, organizationId } = actor;
  if (!(await hasPermission(userId, organizationId, FINANCIAL_PERMISSION))) {
    return { ok: false, reason: 'forbidden' };
  }

  const [rows, organization, invoiceCount, issuedInvoiceCount] = await Promise.all([
    prisma.$queryRawUnsafe(DASHBOARD_TOTALS_SQL, organizationId) as Promise<RawCurrencyTotals[]>,
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    }),
    prisma.invoice.count({ where: { organizationId, deletedAt: null } }),
    prisma.invoice.count({
      where: { organizationId, deletedAt: null, status: { in: ['sent', 'paid', 'overdue'] } },
    }),
  ]);

  const settings = normalizeOrganizationSettings(organization?.settings);
  const safeRows = rows.map((row) => ({
    ...row,
    // The driver may hand back numbers for small aggregates; normalise to text
    // so minor-unit parsing stays exact.
    invoiced: String(row.invoiced ?? '0'),
    collected: String(row.collected ?? '0'),
    outstanding: String(row.outstanding ?? '0'),
    overdue: String(row.overdue ?? '0'),
  }));

  return {
    ok: true,
    data: buildDashboardMetrics(safeRows, {
      defaultCurrency: normalizeCurrencyCode(settings.defaultCurrency) ?? DEFAULT_CURRENCY,
      invoiceCount,
      issuedInvoiceCount,
    }),
  };
}

export interface OpenOpportunities {
  count: number;
  defaultCurrencyValueMinor: number;
  defaultCurrency: string;
}

/** Open opportunity count and pipeline value in the organization's default currency. */
export async function getOpenOpportunities(): Promise<Permissioned<OpenOpportunities>> {
  const actor = await getActor();
  if (!actor) return { ok: false, reason: 'forbidden' };

  const { userId, organizationId } = actor;
  if (!(await hasPermission(userId, organizationId, 'opportunity.read'))) {
    return { ok: false, reason: 'forbidden' };
  }

  const [organization, openRows] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    prisma.opportunity.findMany({
      where: { organizationId, deletedAt: null, status: 'open' },
      select: { currency: true, value: true },
    }),
  ]);

  const settings = normalizeOrganizationSettings(organization?.settings);
  const defaultCurrency = normalizeCurrencyCode(settings.defaultCurrency) ?? DEFAULT_CURRENCY;

  let count = 0;
  let valueMinor = 0;
  for (const row of openRows) {
    count += 1;
    if ((normalizeCurrencyCode(row.currency) ?? row.currency) === defaultCurrency) {
      valueMinor += parseAmountToMinorUnits(row.value?.toString() ?? '0');
    }
  }

  return {
    ok: true,
    data: { count, defaultCurrencyValueMinor: valueMinor, defaultCurrency },
  };
}

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  createdAt: Date;
}

/**
 * Recent organization activity, from the audit log.
 *
 * Requires `audit_log.read`. The query is scoped to the caller's organization;
 * there is no sample or placeholder data anywhere in this path.
 */
export async function getRecentActivity(limit = 6): Promise<Permissioned<ActivityEntry[]>> {
  const actor = await getActor();
  if (!actor) return { ok: false, reason: 'forbidden' };

  const { userId, organizationId } = actor;
  if (!(await hasPermission(userId, organizationId, 'audit_log.read'))) {
    return { ok: false, reason: 'forbidden' };
  }

  const logs = (await prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 25),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorName: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  })) as Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    actorName: string | null;
    createdAt: Date;
    actor: { name: string | null; email: string | null } | null;
  }>;

  return {
    ok: true,
    data: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      actorName: log.actorName ?? log.actor?.name ?? log.actor?.email ?? null,
      createdAt: log.createdAt,
    })),
  };
}
