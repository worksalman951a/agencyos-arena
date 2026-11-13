import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  type TestAccount,
} from './batch4-provisioning';
import { SERVER_URL } from './test-config';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const createdOrganizations: string[] = [];

async function createProject(
  organizationId: string,
  name: string,
  data: {
    budget?: string | null;
    status?: string;
    deletedAt?: Date | null;
    clientId?: string | null;
  } = {}
) {
  return prisma.project.create({
    data: {
      organizationId,
      name,
      budget: data.budget ?? null,
      status: data.status ?? 'active',
      deletedAt: data.deletedAt ?? null,
      clientId: data.clientId ?? null,
    },
  });
}

async function createInvoice(
  organizationId: string,
  projectId: string,
  number: string,
  data: {
    status?: string;
    currency?: string;
    clientId?: string | null;
    subtotal?: string;
    tax?: string;
    total?: string;
    deletedAt?: Date | null;
  } = {}
) {
  return prisma.invoice.create({
    data: {
      organizationId,
      projectId,
      clientId: data.clientId ?? null,
      number,
      title: number,
      status: data.status ?? 'sent',
      currency: data.currency ?? 'USD',
      subtotal: data.subtotal ?? '0.00',
      tax: data.tax ?? '0.00',
      total: data.total ?? '0.00',
      deletedAt: data.deletedAt ?? null,
    },
  });
}

async function financialSummary(account: TestAccount, projectId: string) {
  const response = await fetch(
    `${SERVER_URL}/api/v1/crm/projects/${encodeURIComponent(projectId)}/financial-summary`,
    { headers: authHeaders(account.token) }
  );
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

describeIfDb('project financial summary (real PostgreSQL and HTTP)', () => {
  let admin: TestAccount;

  beforeAll(async () => {
    admin = await createBootstrappedAccount('project-financial-summary');
    createdOrganizations.push(admin.organizationId);
  });

  afterAll(async () => {
    await cleanupOrganizations(createdOrganizations);
  });

  it('aggregates project budget, invoices, payments, sources, expenses and billable time without mixing currencies', async () => {
    const project = await createProject(admin.organizationId, 'Financial Rollup', {
      budget: '1000.00',
    });
    const foreignContact = await prisma.contact.create({
      data: { organizationId: admin.organizationId, firstName: 'Other', lastName: 'Client' },
    });

    const billedExpense = await prisma.expenseItem.create({
      data: {
        organizationId: admin.organizationId,
        projectId: project.id,
        category: 'Travel',
        amount: '100.00',
        expenseDate: new Date('2026-02-01T00:00:00.000Z'),
        billable: true,
      },
    });
    await prisma.expenseItem.create({
      data: {
        organizationId: admin.organizationId,
        projectId: project.id,
        category: 'Supplies',
        amount: '25.00',
        expenseDate: new Date('2026-02-02T00:00:00.000Z'),
        billable: true,
      },
    });
    await prisma.expenseItem.create({
      data: {
        organizationId: admin.organizationId,
        projectId: project.id,
        category: 'Internal',
        amount: '30.00',
        expenseDate: new Date('2026-02-03T00:00:00.000Z'),
        billable: false,
      },
    });

    const billedChangeOrder = await prisma.changeOrder.create({
      data: {
        organizationId: admin.organizationId,
        projectId: project.id,
        description: 'Approved and billed scope',
        amount: '50.00',
        status: 'approved',
        approvedBy: admin.userId,
      },
    });
    await prisma.changeOrder.create({
      data: {
        organizationId: admin.organizationId,
        projectId: project.id,
        description: 'Approved but not billed',
        amount: '100.00',
        status: 'approved',
        approvedBy: admin.userId,
      },
    });
    await prisma.changeOrder.create({
      data: {
        organizationId: admin.organizationId,
        projectId: project.id,
        description: 'Not approved',
        amount: '900.00',
        status: 'pending',
      },
    });

    const sentInvoice = await createInvoice(
      admin.organizationId,
      project.id,
      `PS-${randomUUID()}`,
      {
        subtotal: '500.00',
        tax: '50.00',
        total: '550.00',
      }
    );
    await prisma.payment.create({
      data: {
        invoiceId: sentInvoice.id,
        amount: '200.00',
        method: 'bank_transfer',
        paidAt: new Date(),
      },
    });
    await prisma.invoiceItem.create({
      data: {
        invoiceId: sentInvoice.id,
        description: 'Expense source',
        quantity: '1',
        unitPrice: '100.00',
        taxRate: '0',
        amount: '100.00',
        sourceExpenseId: billedExpense.id,
      },
    });
    await prisma.invoiceItem.create({
      data: {
        invoiceId: sentInvoice.id,
        description: 'Change order source',
        quantity: '1',
        unitPrice: '50.00',
        taxRate: '0',
        amount: '50.00',
        sourceChangeOrderId: billedChangeOrder.id,
      },
    });

    const paidInvoice = await createInvoice(
      admin.organizationId,
      project.id,
      `PS-${randomUUID()}`,
      {
        status: 'paid',
        subtotal: '200.00',
        tax: '20.00',
        total: '220.00',
      }
    );
    await prisma.payment.createMany({
      data: [100, 120].map((amount) => ({
        invoiceId: paidInvoice.id,
        amount: amount.toFixed(2),
        method: 'bank_transfer',
        paidAt: new Date(),
      })),
    });
    await createInvoice(admin.organizationId, project.id, `PS-DRAFT-${randomUUID()}`, {
      status: 'draft',
      subtotal: '900.00',
      total: '900.00',
    });
    await createInvoice(admin.organizationId, project.id, `PS-VOID-${randomUUID()}`, {
      status: 'voided',
      subtotal: '800.00',
      total: '800.00',
    });
    await createInvoice(admin.organizationId, project.id, `PS-DELETED-${randomUUID()}`, {
      deletedAt: new Date(),
      subtotal: '700.00',
      total: '700.00',
    });
    await createInvoice(admin.organizationId, project.id, `PS-OTHER-CLIENT-${randomUUID()}`, {
      clientId: foreignContact.id,
      subtotal: '600.00',
      total: '600.00',
    });
    const euroInvoice = await createInvoice(
      admin.organizationId,
      project.id,
      `PS-EUR-${randomUUID()}`,
      {
        status: 'overdue',
        currency: 'EUR',
        subtotal: '90.00',
        tax: '9.00',
        total: '99.00',
      }
    );
    await prisma.payment.create({
      data: {
        invoiceId: euroInvoice.id,
        amount: '40.00',
        method: 'bank_transfer',
        paidAt: new Date(),
      },
    });

    await prisma.timeEntry.createMany({
      data: [
        {
          organizationId: admin.organizationId,
          userId: admin.userId,
          projectId: project.id,
          date: new Date(),
          hours: '2.0000',
          billable: true,
          hourlyRate: '100.00',
          currency: 'USD',
        },
        {
          organizationId: admin.organizationId,
          userId: admin.userId,
          projectId: project.id,
          date: new Date(),
          hours: '1.2500',
          billable: true,
          hourlyRate: '80.00',
          currency: 'EUR',
        },
        {
          organizationId: admin.organizationId,
          userId: admin.userId,
          projectId: project.id,
          date: new Date(),
          hours: '1.0000',
          billable: true,
          hourlyRate: null,
          currency: null,
        },
        {
          organizationId: admin.organizationId,
          userId: admin.userId,
          projectId: project.id,
          date: new Date(),
          hours: '5.0000',
          billable: false,
          hourlyRate: '999.00',
          currency: 'USD',
        },
      ],
    });

    const beforeAuditCount = await prisma.auditLog.count({
      where: { organizationId: admin.organizationId, entityType: 'Project', entityId: project.id },
    });
    const result = await financialSummary(admin, project.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({
      projectCurrency: 'USD',
      budget: {
        original: '1000.00',
        approvedChangeOrders: '150.00',
        revised: '1150.00',
        utilizationPercent: '60.9',
      },
      invoices: {
        activeCount: 3,
        byCurrency: [
          {
            currency: 'EUR',
            invoicedIncludingTax: '99.00',
            invoicedRevenueExcludingTax: '90.00',
            paymentsReceived: '40.00',
            outstandingBalance: '59.00',
          },
          {
            currency: 'USD',
            invoicedIncludingTax: '770.00',
            invoicedRevenueExcludingTax: '700.00',
            paymentsReceived: '420.00',
            outstandingBalance: '350.00',
          },
        ],
      },
      expenses: {
        recordedDirectCosts: '155.00',
        billable: '125.00',
        nonBillable: '30.00',
        unbilledBillable: '25.00',
        unbilledCount: 1,
        linkedToInvoicesCount: 1,
      },
      changeOrders: {
        approvedAmount: '150.00',
        unbilledApprovedAmount: '100.00',
        unbilledApprovedCount: 1,
      },
      billableTime: {
        estimatedValueByCurrency: [
          { currency: 'EUR', amount: '100.00', entryCount: 1 },
          { currency: 'USD', amount: '200.00', entryCount: 1 },
        ],
        ratedEntryCount: 2,
        unratedEntryCount: 1,
      },
      comparisonInProjectCurrency: {
        invoicedRevenueExcludingTax: '700.00',
        recordedDirectCosts: '155.00',
        revenueLessRecordedDirectCosts: '545.00',
        partialMarginPercent: '77.9',
        netProfitability: null,
      },
    });
    expect(
      (result.body.invoices.details as Array<{ number: string }>).some(
        (invoice) =>
          invoice.number.includes('PS-DRAFT') ||
          invoice.number.includes('PS-VOID') ||
          invoice.number.includes('PS-DELETED') ||
          invoice.number.includes('PS-OTHER-CLIENT')
      )
    ).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: admin.organizationId,
          entityType: 'Project',
          entityId: project.id,
        },
      })
    ).toBe(beforeAuditCount);
  });

  it('classifies expense and change-order sources from PostgreSQL links without releasing any source', async () => {
    const project = await createProject(admin.organizationId, 'Source Billing States');
    const cases = [
      { key: 'available', invoiceStatus: null, deleted: false },
      { key: 'reserved', invoiceStatus: 'draft', deleted: false },
      { key: 'billed-sent', invoiceStatus: 'sent', deleted: false },
      { key: 'billed-overdue', invoiceStatus: 'overdue', deleted: false },
      { key: 'billed-paid', invoiceStatus: 'paid', deleted: false },
      { key: 'locked-voided', invoiceStatus: 'voided', deleted: false },
      { key: 'locked-cancelled', invoiceStatus: 'cancelled', deleted: false },
      { key: 'locked-deleted', invoiceStatus: 'sent', deleted: true },
    ] as const;

    const expenses = await Promise.all(
      cases.map(({ key }, index) =>
        prisma.expenseItem.create({
          data: {
            organizationId: admin.organizationId,
            projectId: project.id,
            category: key,
            amount: `${index + 1}.00`,
            expenseDate: new Date(),
            billable: true,
          },
        })
      )
    );
    const changeOrders = await Promise.all(
      cases.map(({ key }, index) =>
        prisma.changeOrder.create({
          data: {
            organizationId: admin.organizationId,
            projectId: project.id,
            description: key,
            amount: `${(index + 1) * 10}.00`,
            status: 'approved',
            approvedBy: admin.userId,
          },
        })
      )
    );

    const linkedSourceItems: Array<{
      invoiceId: string;
      sourceExpenseId?: string;
      sourceChangeOrderId?: string;
    }> = [];
    for (const [index, testCase] of cases.entries()) {
      if (testCase.invoiceStatus === null) continue;
      const invoice = await createInvoice(
        admin.organizationId,
        project.id,
        `PS-SOURCE-${testCase.key}-${randomUUID()}`,
        {
          status: testCase.invoiceStatus,
          deletedAt: testCase.deleted ? new Date() : null,
        }
      );
      linkedSourceItems.push(
        {
          invoiceId: invoice.id,
          sourceExpenseId: expenses[index].id,
        },
        {
          invoiceId: invoice.id,
          sourceChangeOrderId: changeOrders[index].id,
        }
      );
    }
    await prisma.invoiceItem.createMany({
      data: linkedSourceItems.map((item, index) => ({
        ...item,
        description: `Source link ${index}`,
        quantity: '1',
        unitPrice: '1.00',
        taxRate: '0',
        amount: '1.00',
      })),
    });

    const result = await financialSummary(admin, project.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    const expensesByCategory = Object.fromEntries(
      (
        result.body.expenses.details as Array<{
          category: string;
          billingStatus: string;
        }>
      ).map((expense) => [expense.category, expense.billingStatus])
    );
    const changeOrdersByDescription = Object.fromEntries(
      (
        result.body.changeOrders.details as Array<{
          description: string;
          billingStatus: string;
        }>
      ).map((changeOrder) => [changeOrder.description, changeOrder.billingStatus])
    );
    for (const { key } of cases) {
      const expected = key.startsWith('available')
        ? 'available'
        : key.startsWith('reserved')
          ? 'reserved'
          : key.startsWith('billed')
            ? 'billed'
            : 'locked';
      expect(expensesByCategory[key]).toBe(expected);
      expect(changeOrdersByDescription[key]).toBe(expected);
    }

    expect(result.body.expenses).toMatchObject({
      unbilledBillable: '1.00',
      unbilledCount: 1,
      billingStatusTotals: {
        available: { amount: '1.00', count: 1 },
        reserved: { amount: '2.00', count: 1 },
        billed: { amount: '12.00', count: 3 },
        locked: { amount: '21.00', count: 3 },
      },
    });
    expect(result.body.changeOrders).toMatchObject({
      unbilledApprovedAmount: '10.00',
      unbilledApprovedCount: 1,
      billingStatusTotals: {
        available: { amount: '10.00', count: 1 },
        reserved: { amount: '20.00', count: 1 },
        billed: { amount: '120.00', count: 3 },
        locked: { amount: '210.00', count: 3 },
      },
    });

    const persistedLinks = await prisma.invoiceItem.findMany({
      where: {
        OR: [
          { sourceExpenseId: { in: expenses.map(({ id }) => id) } },
          { sourceChangeOrderId: { in: changeOrders.map(({ id }) => id) } },
        ],
      },
      select: { sourceExpenseId: true, sourceChangeOrderId: true },
    });
    expect(persistedLinks).toHaveLength(14);
  });

  it('reflects partial and completed payments after the existing payment workflow changes the invoice', async () => {
    const project = await createProject(admin.organizationId, 'Payment Updates', {
      budget: '100.00',
    });
    const invoice = await createInvoice(
      admin.organizationId,
      project.id,
      `PS-PAY-${randomUUID()}`,
      {
        subtotal: '100.00',
        total: '100.00',
      }
    );

    const first = await financialSummary(admin, project.id);
    expect(first.body.invoices.byCurrency[0]).toMatchObject({
      paymentsReceived: '0.00',
      outstandingBalance: '100.00',
    });

    const partial = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${invoice.id}/payments`, {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ amount: '40.00', method: 'bank_transfer' }),
    });
    expect(partial.status).toBe(201);
    const afterPartial = await financialSummary(admin, project.id);
    expect(afterPartial.body.invoices.byCurrency[0]).toMatchObject({
      paymentsReceived: '40.00',
      outstandingBalance: '60.00',
    });

    const rest = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${invoice.id}/payments`, {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ amount: '60.00', method: 'bank_transfer' }),
    });
    expect(rest.status).toBe(201);
    const afterPaid = await financialSummary(admin, project.id);
    expect(afterPaid.body.invoices.byCurrency[0]).toMatchObject({
      paymentsReceived: '100.00',
      outstandingBalance: '0.00',
    });
  });

  it('returns empty and archived/deleted project summaries without inventing zero budgets', async () => {
    const empty = await createProject(admin.organizationId, 'Empty Financial Project');
    const emptyResult = await financialSummary(admin, empty.id);
    expect(emptyResult.status).toBe(200);
    expect(emptyResult.body).toMatchObject({
      budget: { original: null, revised: null, utilizationPercent: null },
      invoices: { activeCount: 0, byCurrency: [] },
      expenses: { recordedDirectCosts: '0.00', unbilledCount: 0 },
      changeOrders: { approvedAmount: '0.00', unbilledApprovedCount: 0 },
      billableTime: { estimatedValueByCurrency: [] },
    });

    const archived = await createProject(admin.organizationId, 'Archived Financial Project', {
      status: 'archived',
      budget: '200.00',
      deletedAt: new Date(),
    });
    const archivedResult = await financialSummary(admin, archived.id);
    expect(archivedResult.status).toBe(200);
    expect(archivedResult.body.project).toMatchObject({ status: 'archived', isDeleted: true });
  });

  it('denies users without all financial read permissions and hides cross-tenant projects', async () => {
    const project = await createProject(admin.organizationId, 'Access Control Project', {
      budget: '1.00',
    });
    const reader = await createMemberWithPermissions(admin.organizationId, 'project-only-reader', [
      'project.read',
    ]);
    const denied = await financialSummary(reader, project.id);
    expect(denied.status).toBe(403);

    const other = await createOrganizationWithAdmin('financial-summary-other');
    createdOrganizations.push(other.organizationId);
    const otherProject = await createProject(other.organizationId, 'Other Tenant Project', {
      budget: '999999.00',
    });
    const crossTenant = await financialSummary(admin, otherProject.id);
    expect(crossTenant.status).toBe(404);
    expect(JSON.stringify(crossTenant.body)).not.toContain('999999.00');
  });
});
