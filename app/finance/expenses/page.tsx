/**
 * AgencyOS Finance Expenses List page.
 * Server component that lists expense items for the current organization.
 */

import Link from 'next/link';
import { listExpenses } from '@/lib/services/crm/expense-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function ExpensesListPage() {
  const result = await loadPageData(() => listExpenses());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const expenses = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <Link
          href="/finance/expenses/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Expense
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Summary</h2>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Expenses</dt>
            <dd className="font-medium text-lg">{(expenses as Array<unknown>).length}</dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Amount</dt>
            <dd className="font-medium text-lg">
              {(
                (expenses as Array<{ amount: string }>).reduce(
                  (sum, e) => sum + Number(e.amount || 0),
                  0
                ) || 0
              ).toFixed(2)}
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Billable</dt>
            <dd className="font-medium text-lg">
              {(
                (expenses as Array<{ amount: string; billable: boolean }>).reduce(
                  (sum, e) => (e.billable ? sum + Number(e.amount || 0) : sum),
                  0
                ) || 0
              ).toFixed(2)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Category</th>
              <th className="pb-3 font-medium">Project</th>
              <th className="pb-3 font-medium text-right">Amount</th>
              <th className="pb-3 font-medium w-24">Date</th>
              <th className="pb-3 font-medium w-20">Billable</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(
              expenses as Array<{
                id: string;
                category: string;
                projectId: string | null;
                amount: string;
                expenseDate: Date;
                billable: boolean;
                receiptUrl: string | null;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No expenses found. Add an expense to get started.
                </td>
              </tr>
            ) : (
              (
                expenses as Array<{
                  id: string;
                  category: string;
                  projectId: string | null;
                  amount: string;
                  expenseDate: Date;
                  billable: boolean;
                  receiptUrl: string | null;
                  createdAt: Date;
                }>
              ).map((expense) => (
                <tr key={expense.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{expense.category}</td>
                  <td className="py-4 text-sm text-muted-foreground">{expense.projectId ?? '—'}</td>
                  <td className="py-4 text-right text-sm font-medium">
                    ${Number(expense.amount).toLocaleString()}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {new Date(expense.expenseDate).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        expense.billable
                          ? 'bg-green-100 text-green-800'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {expense.billable ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(expense.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/finance/expenses/${expense.id}`}
                      className="text-sm text-accent hover:underline mr-2"
                    >
                      View
                    </Link>
                    <Link
                      href={`/finance/expenses/${expense.id}/edit`}
                      className="text-sm text-muted-foreground hover:text-accent transition-colors"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
