// @vitest-environment node
/** Real PostgreSQL coverage for secure project expense/change-order billing. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  jsonFetch,
  type TestAccount,
} from './batch4-provisioning';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Project source billing (real PostgreSQL)', () => {
  const organizations: string[] = [];
  let admin: TestAccount;
  let financeOnly: TestAccount;
  let foreign: TestAccount;
  let foreignExpenseId = '';
  let projectId = '';
  let otherProjectId = '';
  let clientId = '';

  const request = (account: TestAccount, path: string, method = 'GET', body?: unknown) =>
    jsonFetch(path, {
      method,
      headers: authHeaders(account.token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const createInvoice = async (overrides: Record<string, unknown> = {}) => {
    const result = await request(admin, '/api/v1/crm/invoices', 'POST', {
      title: `Source invoice ${Date.now()} ${Math.random()}`,
      projectId,
      clientId,
      currency: 'USD',
      lineItems: [
        { description: 'Existing work', quantity: '1', unitPrice: '100.00', taxRate: '0' },
      ],
      ...overrides,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body as {
      id: string;
      number: string;
      subtotal: string;
      tax: string;
      total: string;
    };
  };

  const createExpense = async (account: TestAccount, billable: boolean, project = projectId) => {
    const result = await request(account, '/api/v1/finance/expenses', 'POST', {
      projectId: project,
      category: 'Travel',
      amount: '10.25',
      expenseDate: new Date().toISOString(),
      billable,
    });
    return result;
  };

  const createChangeOrder = async (status: 'approved' | 'pending' | 'rejected') =>
    request(admin, '/api/v1/projects/change-orders', 'POST', {
      projectId,
      description: `Scope ${status}`,
      amount: '20.00',
      status,
    });

  const addSources = (invoiceId: string, account: TestAccount, body: unknown) =>
    request(account, `/api/v1/crm/invoices/${invoiceId}/billable-sources`, 'POST', body);

  beforeAll(async () => {
    await prisma.$connect();
    admin = await createBootstrappedAccount('source-billing');
    organizations.push(admin.organizationId);
    foreign = await createOrganizationWithAdmin('source-billing-foreign');
    organizations.push(foreign.organizationId);
    financeOnly = await createMemberWithPermissions(
      admin.organizationId,
      'source-billing-limited',
      ['invoice.read', 'invoice.update', 'project.read']
    );
    const contact = await request(admin, '/api/v1/crm/contacts', 'POST', {
      firstName: 'Billing',
      lastName: `Client${Date.now()}`,
    });
    expect(contact.status, JSON.stringify(contact.body)).toBe(201);
    clientId = (contact.body as { id: string }).id;
    const project = await request(admin, '/api/v1/crm/projects', 'POST', {
      name: `Source Billing ${Date.now()}`,
      clientId,
    });
    expect(project.status, JSON.stringify(project.body)).toBe(201);
    projectId = (project.body as { id: string }).id;
    const sameOrgOtherProject = await request(admin, '/api/v1/crm/projects', 'POST', {
      name: `Other project ${Date.now()}`,
    });
    expect(sameOrgOtherProject.status).toBe(201);
    otherProjectId = (sameOrgOtherProject.body as { id: string }).id;
    const foreignProject = await request(foreign, '/api/v1/crm/projects', 'POST', {
      name: `Foreign source project ${Date.now()}`,
    });
    expect(foreignProject.status).toBe(201);
    const source = await createExpense(foreign, true, (foreignProject.body as { id: string }).id);
    expect(source.status).toBe(201);
    foreignExpenseId = (source.body as { id: string }).id;
  });

  afterAll(async () => {
    await cleanupOrganizations(organizations);
    await prisma.user
      .deleteMany({
        where: {
          id: { in: [admin?.userId, financeOnly?.userId, foreign?.userId].filter(Boolean) },
        },
      })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('preserves unlinked and non-billable expenses; only explicit authorized billing links a billable project expense', async () => {
    const unlinked = await createExpense(admin, true, '');
    // Empty projectId is rejected by schema; use a legacy-compatible omitted link instead.
    expect(unlinked.status).toBe(400);
    const unlinkedExpense = await request(admin, '/api/v1/finance/expenses', 'POST', {
      category: 'Legacy',
      amount: '4.10',
      expenseDate: new Date().toISOString(),
      billable: true,
    });
    expect(unlinkedExpense.status).toBe(201);
    const nonBillable = await createExpense(admin, false);
    expect(nonBillable.status).toBe(201);
    const eligible = await createExpense(admin, true);
    expect(eligible.status).toBe(201);
    const expense = eligible.body as { id: string };
    const invoice = await createInvoice();
    const response = await addSources(invoice.id, admin, {
      expenses: [{ id: expense.id, taxRate: '10' }],
      changeOrders: [],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ subtotal: '110.25', tax: '1.03', total: '111.28' });
    const stored = await prisma.invoiceItem.findFirst({ where: { sourceExpenseId: expense.id } });
    expect(stored?.invoiceId).toBe(invoice.id);
    const listed = await request(admin, `/api/v1/finance/expenses?projectId=${projectId}`);
    expect((listed.body as { expenses: Array<{ id: string; billed: boolean }> }).expenses).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expense.id, billed: true })])
    );
    const blockedEdit = await request(admin, `/api/v1/finance/expenses/${expense.id}`, 'PUT', {
      billable: false,
    });
    expect(blockedEdit.status).toBe(409);
    const blockedDelete = await request(admin, `/api/v1/finance/expenses/${expense.id}`, 'DELETE');
    expect(blockedDelete.status).toBe(409);
  });

  it('rejects excessive and unsupported tax rates before writing, then bills a supported fractional rate', async () => {
    const sourceResponse = await createExpense(admin, true);
    expect(sourceResponse.status).toBe(201);
    const sourceId = (sourceResponse.body as { id: string }).id;
    const invoice = await createInvoice();

    for (const taxRate of ['-0.01', '100.01', '101', '8.251', '1e2', 'Infinity']) {
      const rejected = await addSources(invoice.id, admin, {
        expenses: [{ id: sourceId, taxRate }],
        changeOrders: [],
      });
      expect(rejected.status, `tax rate ${taxRate}: ${JSON.stringify(rejected.body)}`).toBe(400);
      expect(await prisma.invoiceItem.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect(
        await prisma.invoiceItem.findFirst({ where: { sourceExpenseId: sourceId } })
      ).toBeNull();
      const unchanged = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect([
        unchanged.subtotal.toString(),
        unchanged.tax.toString(),
        unchanged.total.toString(),
      ]).toEqual(['100', '0', '100']);
    }

    const valid = await addSources(invoice.id, admin, {
      expenses: [{ id: sourceId, taxRate: '8.25' }],
      changeOrders: [],
    });
    expect(valid.status, JSON.stringify(valid.body)).toBe(200);
    expect(valid.body).toMatchObject({ subtotal: '110.25', tax: '0.85', total: '111.10' });
    const line = await prisma.invoiceItem.findFirst({ where: { sourceExpenseId: sourceId } });
    expect(line?.taxRate.toString()).toBe('8.25');
  });

  it('bills only approved change orders, rejects unapproved sources and preserves source history', async () => {
    const approved = await createChangeOrder('approved');
    const pending = await createChangeOrder('pending');
    const rejectedOrder = await createChangeOrder('rejected');
    expect(approved.status).toBe(201);
    expect(pending.status).toBe(201);
    expect(rejectedOrder.status).toBe(201);
    const approvedId = (approved.body as { id: string }).id;
    const pendingId = (pending.body as { id: string }).id;
    const rejectedId = (rejectedOrder.body as { id: string }).id;
    const invoice = await createInvoice();
    const rejected = await addSources(invoice.id, admin, {
      expenses: [],
      changeOrders: [{ id: pendingId }],
    });
    expect(rejected.status).toBe(400);
    expect(await prisma.invoiceItem.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect(
      (await addSources(invoice.id, admin, { expenses: [], changeOrders: [{ id: rejectedId }] }))
        .status
    ).toBe(400);
    const billed = await addSources(invoice.id, admin, {
      expenses: [],
      changeOrders: [{ id: approvedId }],
    });
    expect(billed.status).toBe(200);
    expect(billed.body).toMatchObject({ subtotal: '120.00', total: '120.00' });
    expect(
      (await request(admin, `/api/v1/projects/change-orders?projectId=${projectId}`)).body
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: approvedId, billed: true })]));
    expect(
      (
        await request(admin, `/api/v1/projects/change-orders/${approvedId}`, 'PUT', {
          description: 'tamper',
        })
      ).status
    ).toBe(409);
    expect(
      (await request(admin, `/api/v1/projects/change-orders/${approvedId}`, 'DELETE')).status
    ).toBe(409);
  });

  it('enforces tenant, RBAC, project/client/currency consistency and invoice lifecycle', async () => {
    const expense = await createExpense(admin, true);
    const expenseId = (expense.body as { id: string }).id;
    const invoice = await createInvoice();
    expect(
      (
        await addSources(invoice.id, financeOnly, {
          expenses: [{ id: expenseId }],
          changeOrders: [],
        })
      ).status
    ).toBe(403);
    expect(
      (
        await addSources(invoice.id, admin, {
          expenses: [{ id: 'cm00000000000000000000000' }],
          changeOrders: [],
        })
      ).status
    ).toBe(404);
    expect(
      (
        await addSources(invoice.id, admin, {
          expenses: [{ id: foreignExpenseId }],
          changeOrders: [],
        })
      ).status
    ).toBe(404);

    const mismatch = await createInvoice({ clientId: null });
    expect(
      (await addSources(mismatch.id, admin, { expenses: [{ id: expenseId }], changeOrders: [] }))
        .status
    ).toBe(400);

    const wrongProjectInvoice = await createInvoice({
      projectId: otherProjectId,
      clientId: null,
    });
    expect(
      (
        await addSources(wrongProjectInvoice.id, admin, {
          expenses: [{ id: expenseId }],
          changeOrders: [],
        })
      ).status
    ).toBe(404);

    const euroInvoice = await createInvoice({ currency: 'EUR' });
    expect(
      (await addSources(euroInvoice.id, admin, { expenses: [{ id: expenseId }], changeOrders: [] }))
        .status
    ).toBe(400);

    const voided = await createInvoice();
    const voidResult = await request(admin, `/api/v1/crm/invoices/${voided.id}`, 'PUT', {
      status: 'voided',
    });
    expect(voidResult.status).toBe(200);
    expect(
      (await addSources(voided.id, admin, { expenses: [{ id: expenseId }], changeOrders: [] }))
        .status
    ).toBe(400);
  });

  it('uses database uniqueness under concurrent billing and rolls back failed additions', async () => {
    const expense = await createExpense(admin, true);
    const expenseId = (expense.body as { id: string }).id;
    const invoiceA = await createInvoice();
    const invoiceB = await createInvoice();
    const attempts = await Promise.all([
      addSources(invoiceA.id, admin, { expenses: [{ id: expenseId }], changeOrders: [] }),
      addSources(invoiceB.id, admin, { expenses: [{ id: expenseId }], changeOrders: [] }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 409]);
    expect(await prisma.invoiceItem.count({ where: { sourceExpenseId: expenseId } })).toBe(1);

    const pending = await createChangeOrder('pending');
    const pendingId = (pending.body as { id: string }).id;
    const rollbackInvoice = await createInvoice();
    const fail = await addSources(rollbackInvoice.id, admin, {
      expenses: [],
      changeOrders: [{ id: pendingId }],
    });
    expect(fail.status).toBe(400);
    expect(await prisma.invoiceItem.count({ where: { invoiceId: rollbackInvoice.id } })).toBe(1);
    const unchanged = await prisma.invoice.findUniqueOrThrow({ where: { id: rollbackInvoice.id } });
    expect(unchanged.total.toString()).toBe('100');

    const retainedExpense = await createExpense(admin, true);
    const retainedId = (retainedExpense.body as { id: string }).id;
    const deletedInvoice = await createInvoice();
    expect(
      (
        await addSources(deletedInvoice.id, admin, {
          expenses: [{ id: retainedId }],
          changeOrders: [],
        })
      ).status
    ).toBe(200);
    expect(
      (await request(admin, `/api/v1/crm/invoices/${deletedInvoice.id}`, 'DELETE')).status
    ).toBe(200);
    const retryInvoice = await createInvoice();
    expect(
      (
        await addSources(retryInvoice.id, admin, {
          expenses: [{ id: retainedId }],
          changeOrders: [],
        })
      ).status
    ).toBe(409);
  });
});
