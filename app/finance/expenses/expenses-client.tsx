'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoExpensesView } from '@/components/finance/bento-expenses-view';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import type { ExpenseResponse } from '@/lib/services/crm/expense-service';

interface ExpensesClientProps {
  expenses: ExpenseResponse[];
  currency: string;
  categories: string[];
  summary: {
    count: number;
    totalAmount: string;
    billableAmount: string;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  filters: {
    q: string;
    category: string;
    billable: string;
    from: string;
    to: string;
    sort: string;
    page: string;
    pageSize: string;
  };
  isFiltered: boolean;
  pageHref: (page: number) => string;
}

export function ExpensesClient(props: ExpensesClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoExpensesView {...props} />;
  }

  // Legacy Presentation
  const { expenses, currency, summary, pagination, isFiltered, pageHref } = props;

  const money = (amount: string) =>
    formatMinorUnitsAsCurrency(Math.round(Number(amount || 0) * 100), currency);

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Summary{isFiltered ? ' (filtered)' : ''}</h2>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Expenses</dt>
            <dd className="font-medium text-lg" data-testid="expense-count">
              {summary.count}
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Amount</dt>
            <dd className="font-medium text-lg" data-testid="expense-total">
              {money(summary.totalAmount)}
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Billable</dt>
            <dd className="font-medium text-lg" data-testid="expense-billable">
              {money(summary.billableAmount)}
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
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  {isFiltered
                    ? 'No expenses match these filters.'
                    : 'No expenses found. Add an expense to get started.'}
                </td>
              </tr>
            ) : (
              expenses.map((expense) => (
                <tr key={expense.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{expense.category}</td>
                  <td className="py-4 text-sm text-muted-foreground">{expense.projectId ?? '—'}</td>
                  <td className="py-4 text-right text-sm font-medium">{money(expense.amount)}</td>
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-muted-foreground">
        <span>
          Showing {expenses.length === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}–
          {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
        </span>
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-2">
            {pagination.page > 1 ? (
              <Link
                href={pageHref(pagination.page - 1)}
                className="px-3 py-1 rounded border border-input text-xs hover:bg-muted"
              >
                Previous
              </Link>
            ) : null}
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            {pagination.page < pagination.totalPages ? (
              <Link
                href={pageHref(pagination.page + 1)}
                className="px-3 py-1 rounded border border-input text-xs hover:bg-muted"
              >
                Next
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
