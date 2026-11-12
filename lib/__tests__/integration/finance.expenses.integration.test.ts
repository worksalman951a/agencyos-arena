/**
 * Integration: expense list search, filters, sorting and pagination.
 *
 * Exercises the real HTTP endpoint against PostgreSQL, including the summary
 * math, tenant isolation and the 400 for an invalid query. Expenses carry no
 * currency, so the response reports the workspace currency and never converts.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

async function createUserWithOrg(label: string) {
  const email = `${label}-${Date.now()}@expenses-test.invalid`;

  const signUp = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD, name: `Expenses ${label}` }),
  });
  expect(signUp.status).toBe(200);

  const signIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(signIn.status).toBe(200);
  const token =
    (signIn.headers.get('set-cookie') ?? '').match(/better-auth\.session_token=([^;]+)/)?.[1] ?? '';
  expect(token).toBeTruthy();

  const bootstrap = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: SERVER_URL,
    },
    body: JSON.stringify({ organizationName: `Expenses Org ${label}` }),
  });
  expect(bootstrap.status).toBe(200);

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeTruthy();
  const org = await prisma.organization.findFirstOrThrow({
    where: { userRoles: { some: { userId: user!.id } } },
    select: { id: true },
  });

  return { user: user!, token, organizationId: org.id };
}

describeIfDb('Expense list (real PostgreSQL)', () => {
  let token = '';
  let userId = '';
  let organizationId = '';
  let foreignOrgId = '';
  let foreignUserId = '';

  const auth = () => ({
    Cookie: `better-auth.session_token=${token}`,
    Accept: 'application/json',
  });

  const createExpense = async (body: Record<string, unknown>) => {
    const res = await fetch(`${SERVER_URL}/api/v1/finance/expenses`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    expect(res.status, `expense create failed: ${text}`).toBe(201);
    return JSON.parse(text) as { id: string; category: string; amount: string };
  };

  const list = async (query = '') => {
    const res = await fetch(`${SERVER_URL}/api/v1/finance/expenses${query}`, { headers: auth() });
    const text = await res.text();
    return {
      status: res.status,
      body: JSON.parse(text) as {
        expenses: Array<{ id: string; category: string; amount: string; billable: boolean }>;
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
        summary: { count: number; totalAmount: string; billableAmount: string };
        categories: string[];
        currency: string;
      },
    };
  };

  beforeAll(async () => {
    await prisma.$connect();
    const account = await createUserWithOrg('primary');
    token = account.token;
    userId = account.user.id;
    organizationId = account.organizationId;

    await createExpense({
      category: 'Software',
      amount: '100.00',
      expenseDate: '2026-02-10T00:00:00.000Z',
      billable: true,
    });
    await createExpense({
      category: 'Travel',
      amount: '50.00',
      expenseDate: '2026-02-15T00:00:00.000Z',
      billable: false,
    });
    await createExpense({
      category: 'Software',
      amount: '25.00',
      expenseDate: '2026-03-05T00:00:00.000Z',
      billable: true,
    });

    const foreign = await createUserWithOrg('foreign');
    foreignUserId = foreign.user.id;
    foreignOrgId = foreign.organizationId;
    await prisma.expenseItem.create({
      data: {
        organizationId: foreignOrgId,
        category: 'Software',
        amount: '999.00',
        expenseDate: new Date('2026-02-10T00:00:00.000Z'),
        billable: true,
      },
    });
  });

  afterAll(async () => {
    for (const orgId of [organizationId, foreignOrgId].filter(Boolean)) {
      await prisma.expenseItem.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.role.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    }
    for (const id of [userId, foreignUserId].filter(Boolean)) {
      await prisma.session.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('requires a session', async () => {
    const res = await fetch(`${SERVER_URL}/api/v1/finance/expenses`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('returns the page, totals and summary for the organization only', async () => {
    const { status, body } = await list();

    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.summary).toEqual({ count: 3, totalAmount: '175.00', billableAmount: '125.00' });
    expect(body.categories).toEqual(['Software', 'Travel']);
    expect(body.currency).toBe('USD');
    // The other tenant's 999.00 expense is never included.
    expect(body.summary.totalAmount).not.toBe('1174.00');
    expect(body.expenses.every((row) => row.amount !== '999.00')).toBe(true);
  });

  it('filters by exact category and recomputes the summary', async () => {
    const { body } = await list('?category=Travel');
    expect(body.total).toBe(1);
    expect(body.expenses[0].category).toBe('Travel');
    expect(body.summary).toEqual({ count: 1, totalAmount: '50.00', billableAmount: '0.00' });
  });

  it('filters by billable', async () => {
    const { body } = await list('?billable=true');
    expect(body.total).toBe(2);
    expect(body.summary.billableAmount).toBe('125.00');
    expect(body.expenses.every((row) => row.billable)).toBe(true);
  });

  it('searches the category case-insensitively', async () => {
    const { body } = await list('?q=soft');
    expect(body.total).toBe(2);
    expect(body.expenses.every((row) => row.category === 'Software')).toBe(true);
  });

  it('filters by an expense date range', async () => {
    const { body } = await list('?from=2026-03-01&to=2026-03-31');
    expect(body.total).toBe(1);
    expect(body.expenses[0].amount).toBe('25.00');
  });

  it('sorts by amount', async () => {
    const { body } = await list('?sort=amount_desc');
    expect(body.expenses.map((row) => row.amount)).toEqual(['100.00', '50.00', '25.00']);
  });

  it('paginates and clamps an out-of-range page', async () => {
    const first = await list('?pageSize=2&page=1');
    expect(first.body.expenses).toHaveLength(2);
    expect(first.body.totalPages).toBe(2);

    const second = await list('?pageSize=2&page=2');
    expect(second.body.expenses).toHaveLength(1);
    expect(second.body.page).toBe(2);

    const clamped = await list('?pageSize=2&page=99');
    expect(clamped.body.page).toBe(2);
    expect(clamped.body.expenses).toHaveLength(1);
  });

  it('rejects an invalid query with 400 and a usable message', async () => {
    const { status, body } = await list('?page=0');
    expect(status).toBe(400);
    expect((body as unknown as { error: string }).error).toBe('Invalid request query');
  });

  it('rejects a reversed date range', async () => {
    const { status } = await list('?from=2026-05-01&to=2026-04-01');
    expect(status).toBe(400);
  });
});
