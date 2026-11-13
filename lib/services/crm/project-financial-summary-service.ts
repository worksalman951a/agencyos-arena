'use server';

import { cookies } from 'next/headers';

import { auth } from '@/lib/auth-server';
import { prisma } from '@/lib/db';
import { normalizeOrganizationSettings } from '@/lib/schemas/settings/organization.schema';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currencies';
import { requireOrganization, requirePermission } from '@/lib/permissions';
import { calculateProjectFinancialSummary } from '@/lib/finance/project-financial-summary';

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Read-only, project-scoped financial roll-up. Every source query is bounded
 * by the authenticated tenant and the project's own id; invoices must also
 * match the project's client so a corrupt or legacy cross-client link cannot
 * leak another client's billing.
 */
export async function getProjectFinancialSummary(projectId: string) {
  const cookieStore = await cookies();
  const session = await auth.api.getSession({ headers: { cookie: cookieStore.toString() } });
  if (!session?.session || !session.user) throw codedError('Unauthenticated', 401);

  const userId = session.user.id;
  const { organizationId } = await requireOrganization(userId);
  await requirePermission(userId, organizationId, 'project.read');
  await requirePermission(userId, organizationId, 'invoice.read');
  await requirePermission(userId, organizationId, 'expense.read');
  await requirePermission(userId, organizationId, 'time.entry.read');
  await requirePermission(userId, organizationId, 'change.order.read');

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      name: true,
      status: true,
      deletedAt: true,
      clientId: true,
      budget: true,
    },
  });
  if (!project) throw codedError('Project not found', 404);

  const [organization, invoices, expenses, changeOrders, timeEntries] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId,
        projectId,
        clientId: project.clientId,
        deletedAt: null,
        // Draft and voided invoices are not billed revenue or outstanding debt.
        status: { in: ['sent', 'overdue', 'paid'] },
      },
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        subtotal: true,
        total: true,
        dueDate: true,
        createdAt: true,
        payments: { select: { amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.expenseItem.findMany({
      where: { organizationId, projectId },
      select: {
        id: true,
        category: true,
        amount: true,
        expenseDate: true,
        billable: true,
        billedInvoiceItem: {
          select: { invoice: { select: { status: true, deletedAt: true } } },
        },
      },
      orderBy: { expenseDate: 'desc' },
    }),
    prisma.changeOrder.findMany({
      where: { organizationId, projectId },
      select: {
        id: true,
        description: true,
        amount: true,
        status: true,
        createdAt: true,
        billedInvoiceItem: {
          select: { invoice: { select: { status: true, deletedAt: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.timeEntry.findMany({
      where: {
        organizationId,
        OR: [{ projectId }, { projectId: null, task: { is: { projectId, organizationId } } }],
      },
      select: { id: true, hours: true, billable: true, hourlyRate: true, currency: true },
    }),
  ]);

  const projectCurrency =
    normalizeCurrencyCode(normalizeOrganizationSettings(organization?.settings).defaultCurrency) ??
    DEFAULT_CURRENCY;

  return calculateProjectFinancialSummary({
    project,
    projectCurrency,
    invoices,
    expenses,
    changeOrders,
    timeEntries,
  });
}
