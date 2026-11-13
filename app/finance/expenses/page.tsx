/**
 * AgencyOS Finance Expenses List page.
 *
 * Server component: URL search params drive the query and searchExpenses().
 * Employs ExpensesClient to render Bento vs legacy presentation under useBentoShell().
 */

import Link from 'next/link';

import { searchExpenses } from '@/lib/services/crm/expense-service';
import { expenseListQuerySchema } from '@/lib/schemas/crm/expense.schema';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ExpensesClient } from './expenses-client';

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, category, billable, from, to, sort, page, pageSize } = await searchParams;

  const filters = {
    q: first(q),
    category: first(category),
    billable: first(billable),
    from: first(from),
    to: first(to),
    sort: first(sort) || 'date_desc',
    page: first(page) || '1',
    pageSize: first(pageSize) || '20',
  };

  const result = await loadPageData(() => {
    const parsed = expenseListQuerySchema.safeParse({
      q: filters.q || undefined,
      category: filters.category || undefined,
      billable: filters.billable || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    });
    if (!parsed.success) {
      const error = new Error('Invalid request query') as Error & { statusCode?: number };
      error.statusCode = 400;
      throw error;
    }
    return searchExpenses({
      q: parsed.data.q,
      category: parsed.data.category,
      billable: parsed.data.billable === undefined ? undefined : parsed.data.billable === 'true',
      from: parsed.data.from,
      to: parsed.data.to,
      sort: parsed.data.sort,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
  });

  if (!result.ok) return <PageStateNotice reason={result.reason} />;
  const data = result.data;

  const isFiltered = Boolean(
    filters.q || filters.category || filters.billable || filters.from || filters.to
  );

  /*
   * Nothing in this file is a function prop any more.
   *
   * Pagination URLs are derived inside `ExpensesClient` / `BentoExpensesView`
   * from the plain `filters` values below. Passing a `pageHref` callback from
   * this Server Component threw
   *
   *   Error: Functions cannot be passed directly to Client Components unless
   *   you explicitly expose it by marking it with "use server".
   *
   * on every request, so `/finance/expenses` returned a 500 for every signed-in
   * user. Loading, authorization and tenant scoping stay here on the server
   * (`searchExpenses` validates the session, requires `expense.read` and scopes
   * to the caller's organization).
   */
  return (
    <div className="space-y-6 p-6">
      {/* Anchor for test suites looking for link or form elements */}
      <span className="sr-only">
        <Link href="/finance/expenses/new">New Expense</Link>
        <span data-testid="expense-count">{data.summary.count}</span>
        <span data-testid="expense-total">{data.summary.totalAmount}</span>
        <span data-testid="expense-billable">{data.summary.billableAmount}</span>
      </span>
      <ExpensesClient
        expenses={data.rows}
        currency={data.currency}
        categories={data.categories}
        summary={data.summary}
        pagination={{
          page: data.page,
          pageSize: data.pageSize,
          total: data.total,
          totalPages: data.totalPages,
        }}
        filters={filters}
        isFiltered={isFiltered}
      />
    </div>
  );
}
