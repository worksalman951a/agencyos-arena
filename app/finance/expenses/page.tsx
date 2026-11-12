/**
 * AgencyOS Finance Expenses List page.
 *
 * Server component: the URL is the single source of truth for the query
 * (`?q=&category=&billable=&from=&to=&sort=&page=`) and the page is rendered
 * from it on every request.
 *
 * This page used to fetch its data from the API in a client `useEffect` after
 * mount. That made the first paint an empty summary and left a window in which
 * the DOM held a client-rendered tree that was replaced once data arrived —
 * which is what made `finance-expenses.spec.ts` intermittently read a stale
 * count after navigating and reloading (and, under load, briefly observe two
 * copies of the filter form). Rendering on the server removes that window
 * entirely: a reload can only produce the complete, correctly filtered page.
 *
 * The service scopes everything to the signed-in organization, applies the RBAC
 * `expense.read` check and returns the filtered summary. `ExpenseItem` has no
 * currency column, so amounts are labelled with the workspace currency and
 * nothing is converted.
 */

import Link from 'next/link';

import { searchExpenses } from '@/lib/services/crm/expense-service';
import { expenseListQuerySchema, EXPENSE_SORT_OPTIONS } from '@/lib/schemas/crm/expense.schema';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';

const SORT_LABELS: Record<(typeof EXPENSE_SORT_OPTIONS)[number], string> = {
  date_desc: 'Newest first',
  date_asc: 'Oldest first',
  amount_desc: 'Amount: high to low',
  amount_asc: 'Amount: low to high',
  category_asc: 'Category A–Z',
};

const money = (amount: string, currency: string) =>
  formatMinorUnitsAsCurrency(Math.round(Number(amount || 0) * 100), currency);

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, category, billable, projectId, from, to, sort, page, pageSize } = await searchParams;

  const filters = {
    q: first(q),
    category: first(category),
    billable: first(billable),
    projectId: first(projectId),
    from: first(from),
    to: first(to),
    sort: first(sort) || 'date_desc',
    page: first(page) || '1',
    pageSize: first(pageSize) || '20',
  };

  // An invalid query is a 400 from the service; the page reports it instead of
  // silently rendering an unfiltered list.
  const result = await loadPageData(() => {
    const parsed = expenseListQuerySchema.safeParse({
      q: filters.q || undefined,
      category: filters.category || undefined,
      billable: filters.billable || undefined,
      projectId: filters.projectId || undefined,
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
      projectId: parsed.data.projectId,
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
    filters.q ||
    filters.category ||
    filters.billable ||
    filters.projectId ||
    filters.from ||
    filters.to
  );

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    if (filters.q) next.set('q', filters.q);
    if (filters.category) next.set('category', filters.category);
    if (filters.billable) next.set('billable', filters.billable);
    if (filters.projectId) next.set('projectId', filters.projectId);
    if (filters.from) next.set('from', filters.from);
    if (filters.to) next.set('to', filters.to);
    if (filters.sort) next.set('sort', filters.sort);
    // Keep the page size: without it "Next" silently resets to 20 rows and the
    // page count the user is looking at changes underneath them.
    if (filters.pageSize && filters.pageSize !== '20') next.set('pageSize', filters.pageSize);
    if (page > 1) next.set('page', String(page));
    const qs = next.toString();
    return qs ? `/finance/expenses?${qs}` : '/finance/expenses';
  };

  const currency = data.currency;

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
        {filters.projectId ? (
          <input type="hidden" name="projectId" value={filters.projectId} />
        ) : null}
        <div className="md:col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q}
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
            defaultValue={filters.category}
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
            defaultValue={filters.billable}
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
            defaultValue={filters.from}
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
            defaultValue={filters.to}
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
            defaultValue={filters.sort}
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
              <th className="pb-3 font-medium w-28">Billing status</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  {isFiltered
                    ? 'No expenses match these filters.'
                    : 'No expenses found. Add an expense to get started.'}
                </td>
              </tr>
            ) : (
              data.rows.map((expense) => (
                <tr key={expense.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{expense.category}</td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {expense.projectId ? (
                      <Link
                        href={`/projects/${expense.projectId}`}
                        className="text-accent hover:underline"
                      >
                        Open project
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
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
                  <td className="py-4 text-sm">
                    {expense.billed
                      ? 'Billed'
                      : expense.billable && expense.projectId
                        ? 'Unbilled'
                        : '—'}
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
