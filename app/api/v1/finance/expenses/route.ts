/**
 * AgencyOS Finance Expenses API
 *
 * GET    /api/v1/finance/expenses - List expenses
 * POST   /api/v1/finance/expenses - Create an expense
 */

import { NextResponse } from 'next/server';

import { searchExpenses, createExpense } from '@/lib/services/crm/expense-service';
import { expenseCreateSchema, expenseListQuerySchema } from '@/lib/schemas/crm/expense.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = expenseListQuerySchema.safeParse({
      q: searchParams.get('q') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      billable: searchParams.get('billable') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    });
    if (!parsed.success) {
      return errorResponse('Invalid request query', 400, parsed.error.issues);
    }

    const result = await searchExpenses({
      q: parsed.data.q,
      category: parsed.data.category,
      billable: parsed.data.billable === undefined ? undefined : parsed.data.billable === 'true',
      from: parsed.data.from,
      to: parsed.data.to,
      sort: parsed.data.sort,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });

    return NextResponse.json({
      expenses: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      summary: result.summary,
      categories: result.categories,
      currency: result.currency,
    });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = expenseCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const expense = await createExpense(parsed.data);
    return NextResponse.json(expense, { status: 201 });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    return errorResponse(
      statusCode === 401 ? 'Unauthenticated' : statusCode === 403 ? 'Forbidden' : 'Not found',
      statusCode
    );
  }
}
