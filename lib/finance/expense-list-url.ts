/**
 * Expense list URL building.
 *
 * Why this lives here and not in the page
 * ---------------------------------------
 * `/finance/expenses` is a Server Component and `ExpensesClient` is a Client
 * Component. React cannot serialise a function across that boundary, so the page
 * may only hand over plain data. Pagination therefore builds its links from the
 * `filters` values that came out of the query string: the same defaults, the
 * same ordering and the same omission rules for every page link.
 *
 * The function is pure and framework-free so both presentations (Bento and
 * legacy) share one implementation, and so it can be unit tested without a
 * React tree.
 */

/** The filter values as read from the URL — plain strings, safe to serialise. */
export interface ExpenseListFilters {
  q: string;
  category: string;
  billable: string;
  from: string;
  to: string;
  sort: string;
  page: string;
  pageSize: string;
}

/** Default page size in `searchExpenses`. */
export const DEFAULT_EXPENSE_PAGE_SIZE = '20';

/** Default sort in `searchExpenses`. */
export const DEFAULT_EXPENSE_SORT = 'date_desc';

/**
 * Build the list URL for `page`, carrying every active filter.
 *
 * Only `page` differs from the current URL, so following a pagination link can
 * never widen or narrow the result set. Defaults are omitted so a filter-free
 * first page stays exactly `/finance/expenses`, and `page=1` is never written.
 */
export function expenseListHref(filters: ExpenseListFilters, page: number): string {
  const next = new URLSearchParams();
  if (filters.q) next.set('q', filters.q);
  if (filters.category) next.set('category', filters.category);
  if (filters.billable) next.set('billable', filters.billable);
  if (filters.from) next.set('from', filters.from);
  if (filters.to) next.set('to', filters.to);
  if (filters.sort && filters.sort !== DEFAULT_EXPENSE_SORT) next.set('sort', filters.sort);
  if (filters.pageSize && filters.pageSize !== DEFAULT_EXPENSE_PAGE_SIZE) {
    next.set('pageSize', filters.pageSize);
  }
  if (page > 1) next.set('page', String(page));

  const queryString = next.toString();
  return queryString ? `/finance/expenses?${queryString}` : '/finance/expenses';
}
