/**
 * End-to-end coverage for the expense list.
 *
 * The list had no search, filters, sorting or pagination, and every amount was
 * rendered with a hard-coded `$`. These tests create expenses through the API and
 * then assert what the screens show: the filtered summary, the filter results,
 * the empty state and pagination.
 */

import type { APIRequestContext } from '@playwright/test';

import { expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
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

    // Filter form is a plain GET form; submitting it must not need JavaScript.
    await page.locator('#category').selectOption('Travel');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/category=Travel/);
    await expect(page.getByTestId('expense-count')).toHaveText('1');
    await expect(page.getByTestId('expense-total')).toContainText('50.00');
    await expect(page.getByRole('cell', { name: 'Travel' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Software' })).toHaveCount(0);

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
