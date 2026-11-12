'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoExpenseRecordView } from '@/components/finance/bento-expense-record-view';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import type { ExpenseResponse } from '@/lib/services/crm/expense-service';

interface ExpenseDetailClientProps {
  expense: ExpenseResponse & { currency: string };
}

export function ExpenseDetailClient({ expense }: ExpenseDetailClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoExpenseRecordView expense={expense} />;
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
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
            <dd className="font-medium">
              {expense.receiptUrl ? (
                <a
                  href={expense.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  View receipt
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
