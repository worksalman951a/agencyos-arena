/**
 * Unit tests for expense search, filtering, sorting and pagination.
 *
 * The list was previously an unfiltered `findMany` with no pagination and a
 * hard-coded `$` in the UI. These tests pin the query shape (organization scope,
 * filters, ordering, paging), the summary math and the currency label, without
 * needing a database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    expenseItem: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organization: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { listExpenses, searchExpenses } from '@/lib/services/crm/expense-service';

const mockFindMany = prisma.expenseItem.findMany as unknown as ReturnType<typeof vi.fn>;
const mockCount = prisma.expenseItem.count as unknown as ReturnType<typeof vi.fn>;
const mockAggregate = prisma.expenseItem.aggregate as unknown as ReturnType<typeof vi.fn>;
const mockOrganizationFindUnique = prisma.organization.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;

const expense = {
  id: 'exp-1',
  organizationId: 'org-1',
  projectId: null,
  category: 'Software',
  amount: { toString: () => '120.00' },
  expenseDate: new Date('2026-03-01T00:00:00.000Z'),
  receiptUrl: null,
  billable: true,
  createdAt: new Date('2026-03-02T00:00:00.000Z'),
};

/**
 * `searchExpenses` issues two `findMany` calls: the distinct category list first,
 * then the page of rows. These tests assert against the paged query.
 */
const rowsQuery = () =>
  (mockFindMany.mock.calls.find((call) => call[0]?.take !== undefined)?.[0] ?? {}) as {
    where: Record<string, unknown>;
    orderBy?: unknown;
    skip?: number;
    take?: number;
  };

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue({ toString: () => 'session=abc' });
  mockGetSession.mockResolvedValue({
    session: { id: 's1' },
    user: { id: 'user-1', email: 'user@example.com' },
  });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue(undefined);
  mockOrganizationFindUnique.mockResolvedValue({ settings: { defaultCurrency: 'EUR' } });
  mockFindMany.mockResolvedValue([expense]);
  mockCount.mockResolvedValue(1);
  mockAggregate.mockResolvedValue({ _sum: { amount: '120.00' } });
});

describe('searchExpenses', () => {
  it('scopes every query to the organization and the expense.read permission', async () => {
    await searchExpenses();

    expect(rowsQuery().where).toMatchObject({ organizationId: 'org-1' });
    expect(mockCount.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1' });
    expect(mockAggregate.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1' });
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'expense.read');
  });

  it('searches the category and receipt URL case-insensitively', async () => {
    await searchExpenses({ q: '  software ' });

    const where = rowsQuery().where;
    expect(where.OR).toEqual([
      { category: { contains: 'software', mode: 'insensitive' } },
      { receiptUrl: { contains: 'software', mode: 'insensitive' } },
    ]);
  });

  it('applies category, billable and date range filters together', async () => {
    await searchExpenses({
      category: 'Software',
      billable: false,
      from: '2026-01-01',
      to: '2026-01-31',
    });

    const where = rowsQuery().where;
    expect(where.category).toBe('Software');
    expect(where.billable).toBe(false);
    expect(where.expenseDate).toEqual({
      gte: new Date('2026-01-01T00:00:00.000Z'),
      lte: new Date('2026-01-31T23:59:59.999Z'),
    });
  });

  it('rejects an invalid date filter', async () => {
    await expect(searchExpenses({ from: 'not-a-date' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a reversed date range', async () => {
    await expect(searchExpenses({ from: '2026-05-01', to: '2026-04-01' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('paginates with skip/take and reports the page count', async () => {
    mockCount.mockResolvedValue(45);

    const result = await searchExpenses({ page: 3, pageSize: 20 });

    expect(rowsQuery()).toMatchObject({ skip: 40, take: 20 });
    expect(result.page).toBe(3);
    expect(result.totalPages).toBe(3);
    expect(result.total).toBe(45);
  });

  it('clamps out-of-range pages and page sizes', async () => {
    mockCount.mockResolvedValue(5);

    const result = await searchExpenses({ page: 99, pageSize: 5000 });

    expect(rowsQuery()).toMatchObject({ skip: 0, take: 100 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });

  it.each([
    ['date_desc', { expenseDate: 'desc', createdAt: 'desc' }],
    ['date_asc', { expenseDate: 'asc', createdAt: 'asc' }],
    ['amount_desc', { amount: 'desc' }],
    ['amount_asc', { amount: 'asc' }],
    ['category_asc', { category: 'asc', expenseDate: 'desc' }],
  ] as const)('sorts by %s', async (sort, orderBy) => {
    await searchExpenses({ sort });
    expect(rowsQuery().orderBy).toEqual(orderBy);
  });

  it('falls back to the newest-first order for an unknown sort', async () => {
    await searchExpenses({ sort: 'nonsense' as never });
    expect(rowsQuery().orderBy).toEqual({
      expenseDate: 'desc',
      createdAt: 'desc',
    });
  });

  it('returns the summary, categories and the workspace currency', async () => {
    mockAggregate
      .mockResolvedValueOnce({ _sum: { amount: '120.00' } })
      .mockResolvedValueOnce({ _sum: { amount: '30.50' } });
    mockFindMany
      .mockResolvedValueOnce([{ category: 'Software' }, { category: 'Travel' }])
      .mockResolvedValueOnce([expense]);

    const result = await searchExpenses();

    expect(result.summary).toEqual({ count: 1, totalAmount: '120.00', billableAmount: '30.50' });
    expect(result.categories).toEqual(['Software', 'Travel']);
    // No currency conversion: the workspace currency labels the amounts.
    expect(result.currency).toBe('EUR');
    expect(result.rows[0].amount).toBe('120.00');
  });

  it('falls back to USD when the workspace has no currency setting', async () => {
    mockOrganizationFindUnique.mockResolvedValue({ settings: null });
    const result = await searchExpenses();
    expect(result.currency).toBe('USD');
  });
});

describe('listExpenses', () => {
  it('keeps returning every expense as an array for existing callers', async () => {
    const result = await listExpenses();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'exp-1', amount: '120.00' });
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1' });
  });
});
