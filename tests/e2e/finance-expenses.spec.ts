/**
 * End-to-end coverage for the expense list.
 *
 * The list had no search, filters, sorting or pagination, and every amount was
 * rendered with a hard-coded `$`. These tests create expenses through the API and
 * then assert what the screens show: the filtered summary, the filter results,
 * the empty state and pagination.
 *
 * Regression: `/finance/expenses` used to render a 500 for every signed-in user.
 * `page.tsx` is a Server Component and it built the pagination links with a
 * `pageHref` callback that it passed down to the client `ExpensesClient`. React
 * refuses to serialise a function across the server/client boundary, so the
 * request failed before anything reached the browser:
 *
 *   Error: Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *   <... pageHref={function pageHref}>
 *   GET /finance/expenses 500
 *
 * `pageHref` is gone: the client derives each page URL from the serialisable
 * `filters` values (`lib/finance/expense-list-url.ts`), so this spec also pins
 * the boundary contract — the page must render, and pagination must stay a
 * server render that keeps the active filters.
 *
 * The list renders the Bento presentation by default (an organization with no
 * `bento_shell` flag means enabled, see `isBentoShellEnabled`), so these
 * assertions target the Bento markup a user actually sees: rows are buttons in
 * the Expense Register that drive the Expense Inspector rail on the right.
 *
 * Loading, authorization and tenant scoping stay on the server (`searchExpenses`
 * requires `expense.read` and scopes to the caller's organization); this spec
 * only asserts the visible contract.
 */

import type { APIRequestContext, Page } from '@playwright/test';

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

/** Rows of the Bento Expense Register (each row is a button in the table grid). */
const registerRows = (page: Page) => page.locator('.bento-sales-table-row');

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

    // 1. The page renders at all. Before the fix this request returned a 500
    //    because a function crossed the server/client boundary.
    const response = await page.goto('/finance/expenses');
    expect(response?.status(), 'the expense list must not fail to render').toBe(200);
    await expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeVisible();
    await expect(page.getByTestId('expense-count')).toHaveText('3');
    await expect(page.getByTestId('expense-total')).toContainText('175.00');
    await expect(page.getByTestId('expense-billable')).toContainText('125.00');

    // The summary is reported in the workspace currency, not a hard-coded `$`.
    await expect(page.getByText(/expenses recorded in/)).toContainText('USD');
    await expect(registerRows(page)).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Next' })).toHaveCount(0);

    // 2. Filter form is a plain GET form: submitting it performs a real
    //    navigation and must put the filter in the URL without any client state.
    await page.locator('#category').selectOption('Travel');
    await Promise.all([
      page.waitForURL(/category=Travel/),
      page.getByRole('button', { name: 'Apply filters' }).click(),
    ]);

    await expect(page.getByTestId('expense-count')).toHaveText('1');
    await expect(page.getByTestId('expense-total')).toContainText('50.00');
    await expect(registerRows(page)).toHaveCount(1);
    await expect(registerRows(page).first()).toContainText('Travel');
    await expect(registerRows(page).filter({ hasText: 'Software' })).toHaveCount(0);

    // The filtered view must survive a reload: the page is server-rendered from
    // the URL, so a hard reload can only produce the same filtered result.
    await page.reload();
    await expect(page.getByTestId('expense-count')).toHaveText('1');

    // 3. Free-text search is case-insensitive.
    await page.goto('/finance/expenses?q=soft');
    await expect(page.getByTestId('expense-count')).toHaveText('2');
    await expect(page.getByTestId('expense-total')).toContainText('125.00');

    // No match: explicit empty state, not a blank table.
    await page.goto('/finance/expenses?q=does-not-exist');
    await expect(page.getByText('No expenses match those filters')).toBeVisible();

    // 4. Pagination: one row per page, and a Next link that keeps the filter.
    await page.goto('/finance/expenses?pageSize=1&category=Software');
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    const next = page.getByRole('link', { name: 'Next' }).first();
    // The page link is built on the client from serialisable filters, so the
    // active filter has to be part of it.
    await expect(next).toHaveAttribute('href', /category=Software/);
    await Promise.all([page.waitForURL(/page=2/), next.click()]);
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    // Filter retained, not reset: still only the two Software expenses.
    await expect(page.getByTestId('expense-count')).toHaveText('2');
    await expect(registerRows(page).filter({ hasText: 'Travel' })).toHaveCount(0);
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
    await expect(registerRows(page)).toHaveCount(1);

    // Selecting the row drives the Expense Inspector; "Open Detail" is the
    // link to the record (the legacy table had a "View" link per row).
    await registerRows(page).first().click();
    await expect(page.getByText('Expense Inspector')).toBeVisible();
    const openDetail = page.getByRole('link', { name: /Open Detail/ }).first();
    await expect(openDetail).toHaveAttribute('href', `/finance/expenses/${expense.id}`);
    await Promise.all([
      page.waitForURL(new RegExp(`/finance/expenses/${expense.id}$`)),
      openDetail.click(),
    ]);
    await expect(page.getByRole('heading', { name: 'Expense: Detail', level: 1 })).toBeVisible();
    await expect(page.getByText('123.45', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Client Billable', { exact: false }).first()).toBeVisible();

    // A full reload is served by the server, not a client cache.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Expense: Detail', level: 1 })).toBeVisible();

    // The page carries a screen-reader anchor for the same destination before the
    // action bar. `sr-only` clips it to 1×1 px, which Playwright still counts as
    // "visible" but cannot click, so take the real action-bar link (the last one).
    const editLink = page.getByRole('link', { name: 'Edit Expense' }).last();
    await editLink.click();
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
    await expect(registerRows(page)).toHaveCount(1);
    await expect(registerRows(page).first()).toContainText('Duplicate');
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
