'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { ExpenseCreateInput, ExpenseUpdateInput } from '@/lib/schemas/crm/expense.schema';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currencies';
import { normalizeOrganizationSettings } from '@/lib/schemas/settings/organization.schema';

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export interface ExpenseResponse {
  id: string;
  organizationId: string;
  projectId: string | null;
  category: string;
  amount: string;
  expenseDate: Date;
  receiptUrl: string | null;
  billable: boolean;
  createdAt: Date;
}

interface ExpenseRecord {
  id: string;
  organizationId: string;
  projectId: string | null;
  category: string;
  amount: { toString: () => string };
  expenseDate: Date;
  receiptUrl: string | null;
  billable: boolean;
  createdAt: Date;
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

const EXPENSE_SORTS: ExpenseSort[] = [
  'date_desc',
  'date_asc',
  'amount_desc',
  'amount_asc',
  'category_asc',
];

export type ExpenseSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'category_asc';

export interface ExpenseListQuery {
  /** Free-text search over the category (and receipt URL). */
  q?: string;
  /** Exact category filter. */
  category?: string;
  billable?: boolean;
  /** Inclusive `expenseDate` bounds, `YYYY-MM-DD` or ISO. */
  from?: string;
  to?: string;
  sort?: ExpenseSort;
  page?: number;
  pageSize?: number;
}

export interface ExpenseListResult {
  rows: ExpenseResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: { count: number; totalAmount: string; billableAmount: string };
  /** Categories already in use, for the filter dropdown. */
  categories: string[];
  /** Workspace currency. `ExpenseItem` has no per-row currency column. */
  currency: string;
}

/**
 * Sort clause per option.
 *
 * One key per object and a plain object (not an array): this Prisma version
 * rejects a multi-key order-by object, so the shapes stay literal and
 * single-key, exactly like the rest of the services in this repository.
 */
function orderByFor(sort: ExpenseSort) {
  switch (sort) {
    case 'date_asc':
      return { expenseDate: 'asc' as const };
    case 'amount_desc':
      return { amount: 'desc' as const };
    case 'amount_asc':
      return { amount: 'asc' as const };
    case 'category_asc':
      return { category: 'asc' as const };
    case 'date_desc':
    default:
      return { expenseDate: 'desc' as const };
  }
}

function parseDateBound(value: string | undefined, label: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) {
    throw codedError(`The ${label} date filter is not a valid date`, 400);
  }
  if (endOfDay && value.length === 10) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function serializeExpense(expense: ExpenseRecord): ExpenseResponse {
  return {
    id: expense.id,
    organizationId: expense.organizationId,
    projectId: expense.projectId,
    category: expense.category,
    // Postgres hands back `100` for 100.00; keep one money format for the API
    // and the UI (storage is untouched).
    amount: Number(expense.amount.toString()).toFixed(2),
    expenseDate: expense.expenseDate,
    receiptUrl: expense.receiptUrl,
    billable: expense.billable,
    createdAt: expense.createdAt,
  };
}

/**
 * Search, filter, sort and paginate the organization's expenses.
 *
 * Everything is organization-scoped and permission-gated like the plain list.
 * `ExpenseItem` has no currency column, so the summary is reported in the
 * workspace currency and no conversion happens.
 */
export async function searchExpenses(query: ExpenseListQuery = {}): Promise<ExpenseListResult> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'expense.read');

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 20)));
  const sort: ExpenseSort = EXPENSE_SORTS.includes(query.sort as ExpenseSort)
    ? (query.sort as ExpenseSort)
    : 'date_desc';
  const search = query.q?.trim();
  const from = parseDateBound(query.from, 'from');
  const to = parseDateBound(query.to, 'to', true);

  if (from && to && from > to) {
    throw codedError('The from date must be before the to date', 400);
  }

  const filters: Record<string, unknown> = { organizationId };
  if (query.category) filters.category = query.category;
  if (query.billable !== undefined) filters.billable = query.billable;
  if (from || to) {
    filters.expenseDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (search) {
    // Only text columns that exist: category and receipt URL.
    filters.OR = [
      { category: { contains: search, mode: 'insensitive' } },
      { receiptUrl: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Count first so an out-of-range `page` is clamped before paging: asking for
  // page 99 of 3 must show the last page, not an empty table.
  const [organization, filteredCount, categoryRows] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    prisma.expenseItem.count({ where: filters }),
    prisma.expenseItem.findMany({
      where: { organizationId },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  const [rows, totals, billableTotals] = await Promise.all([
    prisma.expenseItem.findMany({
      where: filters,
      orderBy: orderByFor(sort),
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.expenseItem.aggregate({ where: filters, _sum: { amount: true } }),
    prisma.expenseItem.aggregate({
      where: { ...filters, billable: true },
      _sum: { amount: true },
    }),
  ]);

  const settings = normalizeOrganizationSettings(organization?.settings);
  const currency = normalizeCurrencyCode(settings.defaultCurrency) ?? DEFAULT_CURRENCY;

  return {
    rows: (rows as ExpenseRecord[]).map(serializeExpense),
    total: filteredCount,
    page: currentPage,
    pageSize,
    totalPages,
    summary: {
      count: filteredCount,
      totalAmount: Number(totals?._sum?.amount ?? 0).toFixed(2),
      billableAmount: Number(billableTotals?._sum?.amount ?? 0).toFixed(2),
    },
    categories: (categoryRows as Array<{ category: string }>).map(
      (row: { category: string }) => row.category
    ),
    currency,
  };
}

export async function listExpenses() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'expense.read');

  const expenses = await prisma.expenseItem.findMany({
    where: { organizationId },
    orderBy: { expenseDate: 'desc' },
  });

  return (expenses as ExpenseRecord[]).map(serializeExpense);
}

export async function getExpense(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'expense.read');

  const expense = await prisma.expenseItem.findFirst({
    where: { id, organizationId },
  });

  if (!expense) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return {
    id: expense.id,
    organizationId: expense.organizationId,
    projectId: expense.projectId,
    category: expense.category,
    // Postgres hands back `100` for 100.00; keep one money format for the API
    // and the UI (storage is untouched).
    amount: Number(expense.amount.toString()).toFixed(2),
    expenseDate: expense.expenseDate,
    receiptUrl: expense.receiptUrl,
    billable: expense.billable,
    createdAt: expense.createdAt,
  };
}

export async function createExpense(input: ExpenseCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'expense.create');

  // Verify project belongs to org if provided
  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId },
    });
    if (!project) {
      const error = new Error('Project not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const expense = await prisma.expenseItem.create({
    data: {
      organizationId,
      projectId: input.projectId ?? null,
      category: input.category,
      amount: Number(input.amount),
      expenseDate: new Date(input.expenseDate),
      receiptUrl: input.receiptUrl ?? null,
      billable: input.billable,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'expense.create',
    entityType: 'ExpenseItem',
    entityId: expense.id,
    after: {
      id: expense.id,
      category: expense.category,
      // Postgres hands back `100` for 100.00; keep one money format for the API
      // and the UI (storage is untouched).
      amount: Number(expense.amount.toString()).toFixed(2),
      billable: expense.billable,
    },
    organizationId,
  });

  return {
    id: expense.id,
    organizationId: expense.organizationId,
    projectId: expense.projectId,
    category: expense.category,
    // Postgres hands back `100` for 100.00; keep one money format for the API
    // and the UI (storage is untouched).
    amount: Number(expense.amount.toString()).toFixed(2),
    expenseDate: expense.expenseDate,
    receiptUrl: expense.receiptUrl,
    billable: expense.billable,
    createdAt: expense.createdAt,
  };
}

export async function updateExpense(id: string, input: ExpenseUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'expense.update');

  const existing = await prisma.expenseItem.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.projectId !== undefined && input.projectId !== null) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId },
    });
    if (!project) {
      const error = new Error('Project not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const expense = await prisma.expenseItem.update({
    where: { id },
    data: {
      projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
      category: input.category ?? existing.category,
      amount: input.amount !== undefined ? Number(input.amount) : existing.amount,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : existing.expenseDate,
      receiptUrl: input.receiptUrl !== undefined ? input.receiptUrl : existing.receiptUrl,
      billable: input.billable !== undefined ? input.billable : existing.billable,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'expense.update',
    entityType: 'ExpenseItem',
    entityId: expense.id,
    before: { id: existing.id, amount: existing.amount.toString(), billable: existing.billable },
    after: { id: expense.id, amount: expense.amount.toString(), billable: expense.billable },
    organizationId,
  });

  return {
    id: expense.id,
    organizationId: expense.organizationId,
    projectId: expense.projectId,
    category: expense.category,
    // Postgres hands back `100` for 100.00; keep one money format for the API
    // and the UI (storage is untouched).
    amount: Number(expense.amount.toString()).toFixed(2),
    expenseDate: expense.expenseDate,
    receiptUrl: expense.receiptUrl,
    billable: expense.billable,
    createdAt: expense.createdAt,
  };
}

export async function deleteExpense(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'expense.delete');

  const existing = await prisma.expenseItem.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await prisma.expenseItem.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'expense.delete',
    entityType: 'ExpenseItem',
    entityId: id,
    before: { id: existing.id, category: existing.category, amount: existing.amount.toString() },
    after: null,
    organizationId,
  });

  return { id };
}
