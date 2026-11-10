/**
 * AgencyOS Finance Expenses List page.
 *
 * Server component: search, category/billable/date filters, sorting and
 * pagination are plain GET query parameters, so the page stays shareable and
 * needs no client state. Every figure is organization-scoped and reported in
 * the workspace currency — `ExpenseItem` has no per-row currency column, and
 * nothing here converts between currencies.
 */

import Link from 'next/link';

import { PageStateNotice } from '@/components/server/page-state-notice';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import { loadPageData } from '@/lib/page-data';
import { EXPENSE_SORT_OPTIONS, expenseListQuerySchema } from '@/lib/schemas/crm/expense.schema';
import { searchExpenses, type ExpenseSort } from '@/lib/services/crm/expense-service';

const SORT_LABELS: Record<ExpenseSort, string> = {
  date_desc: 'Newest first',
  date_asc: 'Oldest first',
  amount_desc: 'Amount: high to low',
  amount_asc: 'Amount: low to high',
  category_asc: 'Category A–Z',
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : (value ?? undefined);

const money = (amount: string, currency: string) =>
  formatMinorUnitsAsCurrency(Math.round(Number(amount || 0) * 100), currency);

export default async function ExpensesListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parsed = expenseListQuerySchema.safeParse({
    q: first(raw.q),
    category: first(raw.category),
    billable: first(raw.billable),
    from: first(raw.from),
    to: first(raw.to),
    sort: first(raw.sort),
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  });
  const query = parsed.success ? parsed.data : {};

  const result = await loadPageData(() =>
    searchExpenses({
      q: query.q,
      category: query.category,
      billable: query.billable === undefined ? undefined : query.billable === 'true',
      from: query.from,
      to: query.to,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    })
  );

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const data = result.data;
  const { currency } = data;
  const isFiltered = Boolean(query.q || query.category || query.billable || query.from || query.to);

  // Named `nextQuery`, not `params`: `params` is reserved for the async Next.js
  // request API and the infrastructure guard (rightly) flags synchronous use.
  const pageHref = (page: number) => {
    const nextQuery = new URLSearchParams();
    if (query.q) nextQuery.set('q', query.q);
    if (query.category) nextQuery.set('category', query.category);
    if (query.billable) nextQuery.set('billable', query.billable);
    if (query.from) nextQuery.set('from', query.from);
    if (query.to) nextQuery.set('to', query.to);
    if (query.sort) nextQuery.set('sort', query.sort);
    if (page > 1) nextQuery.set('page', String(page));
    const qs = nextQuery.toString();
    return qs ? `/finance/expenses?${qs}` : '/finance/expenses';
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Amounts are recorded in {currency}; expenses have no per-row currency.
          </p>
        </div>
        <Link
          href="/finance/expenses/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Expense
        </Link>
      </div>

      <form
        method="get"
        action="/finance/expenses"
        className="rounded-md border bg-background p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end"
      >
        <div className="md:col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query.q ?? ''}
            placeholder="Category or receipt"
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="category">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={query.category ?? ''}
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {data.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="billable">
            Billable
          </label>
          <select
            id="billable"
            name="billable"
            defaultValue={query.billable ?? ''}
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="true">Billable</option>
            <option value="false">Not billable</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={query.from ?? ''}
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={query.to ?? ''}
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="sort">
            Sort
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={query.sort ?? 'date_desc'}
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          >
            {EXPENSE_SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SORT_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 md:col-span-4">
          <button
            type="submit"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            Apply filters
          </button>
          {isFiltered ? (
            <Link
              href="/finance/expenses"
              className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Summary{isFiltered ? ' (filtered)' : ''}</h2>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Expenses</dt>
            <dd className="font-medium text-lg" data-testid="expense-count">
              {data.summary.count}
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Amount</dt>
            <dd className="font-medium text-lg" data-testid="expense-total">
              {money(data.summary.totalAmount, currency)}
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Billable</dt>
            <dd className="font-medium text-lg" data-testid="expense-billable">
              {money(data.summary.billableAmount, currency)}
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
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  {isFiltered
                    ? 'No expenses match these filters.'
                    : 'No expenses found. Add an expense to get started.'}
                </td>
              </tr>
            ) : (
              data.rows.map((expense) => (
                <tr key={expense.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{expense.category}</td>
                  <td className="py-4 text-sm text-muted-foreground">{expense.projectId ?? '—'}</td>
                  <td className="py-4 text-right text-sm font-medium">
                    {money(expense.amount, currency)}
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {data.total === 0
            ? 'No expenses'
            : `Showing ${(data.page - 1) * data.pageSize + 1}–${
                (data.page - 1) * data.pageSize + data.rows.length
              } of ${data.total}`}
        </span>
        <div className="flex items-center gap-2">
          {data.page > 1 ? (
            <Link
              href={pageHref(data.page - 1)}
              className="px-3 py-1.5 border rounded-md hover:bg-muted"
            >
              Previous
            </Link>
          ) : (
            <span className="px-3 py-1.5 border rounded-md opacity-50">Previous</span>
          )}
          <span>
            Page {data.page} of {data.totalPages}
          </span>
          {data.page < data.totalPages ? (
            <Link
              href={pageHref(data.page + 1)}
              className="px-3 py-1.5 border rounded-md hover:bg-muted"
            >
              Next
            </Link>
          ) : (
            <span className="px-3 py-1.5 border rounded-md opacity-50">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
