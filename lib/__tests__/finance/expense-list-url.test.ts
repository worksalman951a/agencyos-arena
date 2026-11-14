/**
 * `/finance/expenses` pagination URLs.
 *
 * The expense list is a Server Component; its pagination used to be a
 * `pageHref(page)` function handed to the client `ExpensesClient`, which made
 * every request fail with "Functions cannot be passed directly to Client
 * Components". The URL is now built on the client from the serialisable
 * `filters` values. These cases pin the contract that makes that safe:
 * a page link changes only `page`, every active filter is carried over, and
 * defaults never leak into the URL.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPENSE_PAGE_SIZE,
  DEFAULT_EXPENSE_SORT,
  expenseListHref,
  type ExpenseListFilters,
} from '@/lib/finance/expense-list-url';

const noFilters: ExpenseListFilters = {
  q: '',
  category: '',
  billable: '',
  from: '',
  to: '',
  sort: DEFAULT_EXPENSE_SORT,
  page: '1',
  pageSize: DEFAULT_EXPENSE_PAGE_SIZE,
};

describe('expenseListHref', () => {
  it('keeps an unfiltered first page at the bare list URL', () => {
    expect(expenseListHref(noFilters, 1)).toBe('/finance/expenses');
  });

  it('adds only the page number for a later page', () => {
    expect(expenseListHref(noFilters, 3)).toBe('/finance/expenses?page=3');
  });

  it('carries every active filter into the page link', () => {
    const filters: ExpenseListFilters = {
      q: 'soft',
      category: 'Software',
      billable: 'true',
      from: '2026-02-01',
      to: '2026-02-28',
      sort: 'amount_desc',
      page: '1',
      pageSize: '5',
    };

    const href = expenseListHref(filters, 2);
    const query = new URLSearchParams(href.split('?')[1]);

    expect(href.startsWith('/finance/expenses?')).toBe(true);
    expect(query.get('q')).toBe('soft');
    expect(query.get('category')).toBe('Software');
    expect(query.get('billable')).toBe('true');
    expect(query.get('from')).toBe('2026-02-01');
    expect(query.get('to')).toBe('2026-02-28');
    expect(query.get('sort')).toBe('amount_desc');
    expect(query.get('pageSize')).toBe('5');
    expect(query.get('page')).toBe('2');
  });

  it('does not write defaults or page=1 into the URL', () => {
    const href = expenseListHref({ ...noFilters, category: 'Travel' }, 1);
    const query = new URLSearchParams(href.split('?')[1]);

    expect(query.get('category')).toBe('Travel');
    expect(query.has('sort')).toBe(false);
    expect(query.has('pageSize')).toBe(false);
    expect(query.has('page')).toBe(false);
  });

  it('percent-encodes filter values instead of breaking the URL', () => {
    const href = expenseListHref({ ...noFilters, q: 'travel & lodging' }, 2);
    expect(href).toBe('/finance/expenses?q=travel+%26+lodging&page=2');
  });
});
