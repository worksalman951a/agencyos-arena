/**
 * AgencyOS Expense Detail page.
 *
 * Server-rendered from the id so the record is always read through the service
 * (which applies the RBAC `expense.read` check and the organization scope). The
 * expenses list links here, and the create form redirects here after saving —
 * without this page both flows dead-ended on a 404.
 */

import Link from 'next/link';

import { getExpense } from '@/lib/services/crm/expense-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';

export const dynamic = 'force-dynamic';

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getExpense(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/finance/expenses"
        backLabel="Back to expenses"
      />
    );
  }

  const expense = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expense: {expense.category}</h1>
          <p className="text-sm text-muted-foreground">
            Recorded {new Date(expense.createdAt).toLocaleDateString()} •{' '}
            {expense.billable ? 'Billable' : 'Not billable'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/finance/expenses"
            className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80"
          >
            Back to Expenses
          </Link>
          <Link
            href={`/finance/expenses/${expense.id}/edit`}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
          >
            Edit Expense
          </Link>
        </div>
      </div>

      <div className="rounded-md border bg-background p-4">
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="font-medium">{expense.category}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-medium">
              {formatMinorUnitsAsCurrency(
                Math.round(Number(expense.amount) * 100),
                expense.currency
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Expense date</dt>
            <dd className="font-medium">{new Date(expense.expenseDate).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Billable</dt>
            <dd className="font-medium">{expense.billable ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Project</dt>
            <dd className="font-medium">
              {expense.projectId ? (
                <Link
                  href={`/projects/${expense.projectId}`}
                  className="text-accent hover:underline"
                >
                  {expense.projectId}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Receipt</dt>
            <dd className="font-medium break-all">
              {expense.receiptUrl ? (
                <a
                  href={expense.receiptUrl}
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {expense.receiptUrl}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
