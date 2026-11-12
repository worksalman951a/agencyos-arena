/**
 * AgencyOS Expense Detail page.
 *
 * Server-rendered from the id through getExpense(id) and wrapped in
 * ExpenseDetailClient to toggle Bento vs legacy presentation.
 */

import Link from 'next/link';

import { getExpense } from '@/lib/services/crm/expense-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ExpenseDetailClient } from './expense-detail-client';

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
      <span className="sr-only">
        <Link href="/finance/expenses">Back to Expenses</Link>
        <Link href={`/finance/expenses/${expense.id}/edit`}>Edit Expense</Link>
      </span>
      <ExpenseDetailClient expense={expense} />
    </div>
  );
}
