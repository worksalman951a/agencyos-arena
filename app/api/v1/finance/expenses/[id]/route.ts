/**
 * AgencyOS Finance Expense API - Single Expense
 *
 * GET    /api/v1/finance/expenses/[id] - Get expense by ID
 * PUT    /api/v1/finance/expenses/[id] - Update expense
 * DELETE /api/v1/finance/expenses/[id] - Delete expense
 */

import { NextResponse } from 'next/server';

import { getExpense, updateExpense, deleteExpense } from '@/lib/services/crm/expense-service';
import { expenseUpdateSchema } from '@/lib/schemas/crm/expense.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const expense = await getExpense(id);
    return NextResponse.json(expense);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = expenseUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const expense = await updateExpense(id, parsed.data);
    return NextResponse.json(expense);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteExpense(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
