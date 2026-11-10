/**
 * AgencyOS Finance Expenses List page.
 *
 * Client component, matching the pattern used by the CRM lists: the URL is the
 * single source of truth for the query (`?q=&category=&billable=&from=&to=&sort=&page=`),
 * and the component asks the API for the page it needs. That keeps the list
 * shareable, back/forward friendly and free of a stale server render when the
 * filters change.
 *
 * The API scopes everything to the signed-in organization, applies the RBAC
 * `expense.read` check and returns the filtered summary. `ExpenseItem` has no
 * currency column, so amounts are labelled with the workspace currency and
 * nothing is converted.
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import { EXPENSE_SORT_OPTIONS } from '@/lib/schemas/crm/expense.schema';

interface ExpenseRow {
  id: string;
  category: string;
  projectId: string | null;
  amount: string;
  expenseDate: string;
  billable: boolean;
  receiptUrl: string | null;
  createdAt: string;
}

interface ExpensesResponse {
  expenses: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: { count: number; totalAmount: string; billableAmount: string };
  categories: string[];
  currency: string;
}

const SORT_LABELS: Record<(typeof EXPENSE_SORT_OPTIONS)[number], string> = {
  date_desc: 'Newest first',
  date_asc: 'Oldest first',
  amount_desc: 'Amount: high to low',
  amount_asc: 'Amount: low to high',
  category_asc: 'Category A–Z',
};

const money = (amount: string, currency: string) =>
  formatMinorUnitsAsCurrency(Math.round(Number(amount || 0) * 100), currency);

export default function ExpensesListPage() {
  // `useSearchParams()` needs a Suspense boundary so the route can be prerendered
  // without blocking on the query string.
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading expenses...</div>}>
      <ExpensesListContent />
    </Suspense>
  );
}

function ExpensesListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<ExpensesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = {
    q: searchParams.get('q') ?? '',
    category: searchParams.get('category') ?? '',
    billable: searchParams.get('billable') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    sort: searchParams.get('sort') ?? 'date_desc',
    page: searchParams.get('page') ?? '1',
    pageSize: searchParams.get('pageSize') ?? '20',
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (filters.q) qs.set('q', filters.q);
        if (filters.category) qs.set('category', filters.category);
        if (filters.billable) qs.set('billable', filters.billable);
        if (filters.from) qs.set('from', filters.from);
        if (filters.to) qs.set('to', filters.to);
        if (filters.sort) qs.set('sort', filters.sort);
        if (filters.page) qs.set('page', filters.page);
        if (filters.pageSize) qs.set('pageSize', filters.pageSize);

        const res = await fetch(`/api/v1/finance/expenses?${qs.toString()}`, {
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!mounted) return;

        const body = await res.json();
        if (!mounted) return;

        if (!res.ok) {
          setError(body?.error ?? 'Unable to load expenses.');
          return;
        }
        setData(body as ExpensesResponse);
      } catch {
        if (mounted) setError('Unable to load expenses.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [
    filters.q,
    filters.category,
    filters.billable,
    filters.from,
    filters.to,
    filters.sort,
    filters.page,
    filters.pageSize,
  ]);

  const isFiltered = Boolean(
    filters.q || filters.category || filters.billable || filters.from || filters.to
  );

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    if (filters.q) next.set('q', filters.q);
    if (filters.category) next.set('category', filters.category);
    if (filters.billable) next.set('billable', filters.billable);
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

  const currency = data?.currency ?? 'USD';

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
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const next = new URLSearchParams();
          for (const key of ['q', 'category', 'billable', 'from', 'to', 'sort']) {
            const value = String(formData.get(key) ?? '').trim();
            if (value) next.set(key, value);
          }
          const qs = next.toString();
          router.push(qs ? `/finance/expenses?${qs}` : '/finance/expenses');
        }}
      >
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
            {(data?.categories ?? []).map((category) => (
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

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Summary{isFiltered ? ' (filtered)' : ''}</h2>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Expenses</dt>
            <dd className="font-medium text-lg" data-testid="expense-count">
              {data?.summary.count ?? 0}
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Amount</dt>
            <dd className="font-medium text-lg" data-testid="expense-total">
              {money(data?.summary.totalAmount ?? '0', currency)}
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Billable</dt>
            <dd className="font-medium text-lg" data-testid="expense-billable">
              {money(data?.summary.billableAmount ?? '0', currency)}
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
            {loading && !data ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading expenses...
                </td>
              </tr>
            ) : (data?.expenses.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  {isFiltered
                    ? 'No expenses match these filters.'
                    : 'No expenses found. Add an expense to get started.'}
                </td>
              </tr>
            ) : (
              data!.expenses.map((expense) => (
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
          {(data?.total ?? 0) === 0
            ? 'No expenses'
            : `Showing ${((data?.page ?? 1) - 1) * (data?.pageSize ?? 20) + 1}–${
                ((data?.page ?? 1) - 1) * (data?.pageSize ?? 20) + (data?.expenses.length ?? 0)
              } of ${data?.total ?? 0}`}
        </span>
        <div className="flex items-center gap-2">
          {data && data.page > 1 ? (
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
            Page {data?.page ?? 1} of {data?.totalPages ?? 1}
          </span>
          {data && data.page < data.totalPages ? (
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
