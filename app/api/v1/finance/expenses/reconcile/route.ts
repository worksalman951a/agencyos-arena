/**
 * AgencyOS Finance Expenses Administrative Reconciliation API
 *
 * POST /api/v1/finance/expenses/reconcile - Batch reconcile historical expenses currency
 */

import { NextResponse } from 'next/server';
import { reconcileHistoricalExpenses } from '@/lib/services/crm/expense-service';
import { expenseReconcileSchema } from '@/lib/schemas/crm/expense.schema';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = expenseReconcileSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const result = await reconcileHistoricalExpenses(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    const message = (err as Error).message;
    return errorResponse(message || 'An error occurred during reconciliation', statusCode);
  }
}
