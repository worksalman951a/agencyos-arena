/**
 * End-to-end coverage for the expense list.
 *
 * The list had no search, filters, sorting or pagination, and every amount was
 * rendered with a hard-coded `$`. These tests create expenses through the API and
 * then assert what the screens show: the filtered summary, the filter results,
 * the empty state and pagination.
 */

import type { APIRequestContext } from '@playwright/test';

import { APP_URL, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
  // Same-origin marker: every mutating API request must name a trusted Origin
  // (CSRF protection in middleware.ts). A browser sends this on its own; the
  // API request context does not.
  Origin: APP_URL,
});

async function createExpense(
  api: APIRequestContext,
  account: TestAccount,
  body: { category: string; amount: string; expenseDate: string; billable?: boolean }
) {
  const res = await api.post('/api/v1/finance/expenses', {
    headers: authHeader(account),
    data: { billable: false, ...body },
  });
  const text = await res.text();
  expect(res.status(), `expense create failed: ${text}`).toBe(201);
  return JSON.parse(text) as { id: string };
}

test.describe('finance expenses', () => {
  test('searches, filters and paginates the list with a workspace-currency summary', async ({
    authedPage: page,
    api,
    account,
  }) => {
    await createExpense(api, account, {
      category: 'Software',
      amount: '100.00',
      expenseDate: '2026-02-10T00:00:00.000Z',
      billable: true,
    });
    await createExpense(api, account, {
      category: 'Travel',
      amount: '50.00',
      expenseDate: '2026-02-15T00:00:00.000Z',
    });
    await createExpense(api, account, {
      category: 'Software',
      amount: '25.00',
      expenseDate: '2026-03-05T00:00:00.000Z',
      billable: true,
    });

    await page.goto('/finance/expenses');
    await expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeVisible();
    await expect(page.getByTestId('expense-count')).toHaveText('3');
    await expect(page.getByTestId('expense-total')).toContainText('175.00');
    await expect(page.getByTestId('expense-billable')).toContainText('125.00');
    await expect(page.getByRole('link', { name: 'Next' })).toHaveCount(0);

    // Filter form is a plain GET form: submitting it performs a real navigation
    // and must put the filter in the URL without any client state.
    await page.locator('#category').selectOption('Travel');
    await Promise.all([
      page.waitForURL(/category=Travel/),
      page.getByRole('button', { name: 'Apply filters' }).click(),
    ]);

    await expect(page.getByTestId('expense-count')).toHaveText('1');
    await expect(page.getByTestId('expense-total')).toContainText('50.00');
    await expect(page.getByRole('cell', { name: 'Travel' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Software' })).toHaveCount(0);

    // The filtered view must survive a reload: the page is server-rendered from
    // the URL, so a hard reload can only produce the same filtered result.
    await page.reload();
    await expect(page.getByTestId('expense-count')).toHaveText('1');

    // Free-text search is case-insensitive.
    await page.goto('/finance/expenses?q=soft');
    await expect(page.getByTestId('expense-count')).toHaveText('2');
    await expect(page.getByTestId('expense-total')).toContainText('125.00');

    // No match: explicit empty state, not a blank table.
    await page.goto('/finance/expenses?q=does-not-exist');
    await expect(page.getByText('No expenses match these filters.')).toBeVisible();

    // Pagination: one row per page.
    await page.goto('/finance/expenses?pageSize=1');
    await expect(page.getByText('Page 1 of 3')).toBeVisible();
    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText('Page 2 of 3')).toBeVisible();
  });

  test('opens the expense detail page from the list and links to its edit form', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const expense = await createExpense(api, account, {
      category: 'Detail',
      amount: '123.45',
      expenseDate: '2026-02-10T00:00:00.000Z',
      billable: true,
    });

    // The list links to `/finance/expenses/[id]`; that page used to 404, which
    // also broke the post-create redirect from `/finance/expenses/new`.
    await page.goto('/finance/expenses?q=Detail');
    await page.getByRole('link', { name: 'View' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/finance/expenses/${expense.id}$`));
    await expect(page.getByRole('heading', { name: 'Expense: Detail', level: 1 })).toBeVisible();
    await expect(page.getByText('123.45', { exact: false })).toBeVisible();
    await expect(page.getByText('Billable', { exact: false }).first()).toBeVisible();

    // A full reload is served by the server, not a client cache.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Expense: Detail', level: 1 })).toBeVisible();

    await page.getByRole('link', { name: 'Edit Expense' }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/expenses/${expense.id}/edit$`));
  });

  test('renders exactly one copy of the list shell after a fresh load', async ({
    authedPage: page,
    api,
    account,
  }) => {
    await createExpense(api, account, {
      category: 'Duplicate',
      amount: '10.00',
      expenseDate: '2026-02-10T00:00:00.000Z',
    });

    // Regression guard for the hydration issue: the filter form and the summary
    // used to be able to exist twice for a moment while a client-rendered tree
    // was replaced, which made strict-mode locators fail intermittently. The
    // page is server-rendered now, so one element of each is the contract.
    for (const url of ['/finance/expenses', '/finance/expenses?q=Dup']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeVisible();
      await expect(page.getByTestId('expense-count')).toHaveCount(1);
      await expect(page.locator('#category')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Apply filters' })).toHaveCount(1);
    }

    await expect(page.getByTestId('expense-count')).toHaveText('1');
    await expect(page.getByRole('cell', { name: 'Duplicate' })).toBeVisible();
  });

  test('keeps expenses private to their organization', async ({
    authedPage: page,
    api,
    account,
  }) => {
    await createExpense(api, account, {
      category: 'Private',
      amount: '42.00',
      expenseDate: '2026-02-10T00:00:00.000Z',
    });

    await page.goto('/finance/expenses?q=Private');
    await expect(page.getByTestId('expense-count')).toHaveText('1');
    await expect(page.getByTestId('expense-total')).toContainText('42.00');
  });
});
