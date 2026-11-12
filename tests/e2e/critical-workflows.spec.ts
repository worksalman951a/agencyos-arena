/**
 * Critical-path end-to-end coverage (Phase 3A audit).
 *
 * These tests exercise the workflows that a release candidate cannot regress:
 * the authenticated shell and dashboard, CRM contacts (list → detail → search →
 * persistence), finance invoices (list → detail), settings persistence and
 * validation, and organization isolation between two real accounts.
 *
 * They run against a real Next.js server backed by an isolated database and are
 * skipped when DATABASE_URL / BETTER_AUTH_SECRET are not configured.
 */

import type { APIRequestContext } from '@playwright/test';

import { APP_URL, createAccount, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
  // Same-origin marker: every mutating API request must name a trusted Origin
  // (CSRF protection in middleware.ts). A browser sends this on its own; the
  // API request context does not.
  Origin: APP_URL,
});

/** Create a contact through the public API, so the UI is tested against real data. */
async function createContact(
  api: APIRequestContext,
  account: TestAccount,
  lastName: string
): Promise<{ id: string; lastName: string }> {
  const res = await api.post('/api/v1/crm/contacts', {
    headers: authHeader(account),
    data: { firstName: 'E2E', lastName },
  });
  expect(res.status(), `contact create failed: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { id?: string };
  expect(body.id, 'contact response should include an id').toBeTruthy();
  return { id: body.id!, lastName };
}

test.describe('authenticated shell and dashboard', () => {
  test('renders the shared shell, the real metrics and a working New Project link', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    // Shared navigation comes from the single ModuleShell implementation.
    await expect(page.getByRole('link', { name: 'Contacts', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true }).first()).toBeVisible();

    // Real financial section instead of the old placeholder figures.
    await expect(page.getByText('Total Invoiced').first()).toBeVisible();

    await page.getByRole('link', { name: 'New Project' }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('CRM contacts', () => {
  test('lists, opens, searches and persists a created contact', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const contact = await createContact(api, account, `Audit${Date.now()}`);

    await page.goto('/crm/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts', level: 1 })).toBeVisible();

    const row = page.getByRole('link', { name: new RegExp(contact.lastName) }).first();
    await expect(row).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/crm/contacts/${contact.id}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(contact.lastName);

    // Persistence: a full reload of the detail page still serves the record.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(contact.lastName);

    // Search finds it, and a query with no matches shows the empty state.
    await page.goto('/crm/contacts');
    await page.getByPlaceholder('Search contacts...').fill(contact.lastName);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(new RegExp(`search=${contact.lastName}`));
    await expect(
      page.getByRole('link', { name: new RegExp(contact.lastName) }).first()
    ).toBeVisible();

    await page.goto('/crm/contacts?search=no-such-contact-4f2b1c');
    await expect(page.getByText('No contacts found.').first()).toBeVisible();
  });
});

test.describe('finance invoices', () => {
  test('numbers a created invoice and shows it in the list and detail view', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const contact = await createContact(api, account, `Billing${Date.now()}`);

    const created = await api.post('/api/v1/crm/invoices', {
      headers: authHeader(account),
      data: {
        title: 'E2E audit invoice',
        clientId: contact.id,
        currency: 'USD',
        lineItems: [
          { description: 'Audit work', quantity: '1', unitPrice: '100.00', taxRate: '0' },
        ],
      },
    });
    expect(created.status(), `invoice create failed: ${await created.text()}`).toBe(201);
    const invoice = (await created.json()) as { id: string; number: string };
    expect(invoice.number).toMatch(/^[A-Z]+-\d{4}-\d{4,}$/);

    await page.goto('/finance/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: invoice.number }).first()).toBeVisible();

    await page.goto(`/finance/invoices/${invoice.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(invoice.number);
    await expect(page.getByText('E2E audit invoice').first()).toBeVisible();
  });
});

test.describe('settings', () => {
  test('saves organization details and keeps them after a reload', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('Organization Information').first()).toBeVisible();

    const nameInput = page.locator('#org-name');
    await expect(nameInput).toBeVisible();

    const updatedName = `Renamed ${Date.now()}`;
    await nameInput.fill(updatedName);
    await page.getByRole('button', { name: 'Save organization information' }).click();

    await expect(page.getByText('Organization information saved.').first()).toBeVisible();

    await page.reload();
    await expect(page.locator('#org-name')).toHaveValue(updatedName);
  });

  test('rejects an empty organization name with a field error instead of saving', async ({
    authedPage: page,
  }) => {
    await page.goto('/settings');
    const nameInput = page.locator('#org-name');
    await expect(nameInput).toBeVisible();

    await nameInput.fill('');
    await page.getByRole('button', { name: 'Save organization information' }).click();

    // The API answers 400 with fieldErrors and the section renders them inline.
    await expect(page.getByRole('alert').first()).toBeVisible();

    await page.reload();
    await expect(page.locator('#org-name')).not.toHaveValue('');
  });
});

test.describe('organization isolation', () => {
  test('another tenant cannot open a contact from a different organization', async ({
    authedPage: page,
    api,
    account,
    appUrl,
  }) => {
    const contact = await createContact(api, account, `Private${Date.now()}`);

    // A second, unrelated account with its own organization.
    const intruder = await createAccount(api, 'intruder');
    const context = page.context();
    await context.clearCookies();
    await context.addCookies([
      { name: 'better-auth.session_token', value: intruder.sessionToken, url: appUrl },
    ]);

    // The contact detail page is a client view: a record from another
    // organization renders its "not found" state, never the record itself.
    await page.goto(`/crm/contacts/${contact.id}`);
    await expect(page.getByText('Contact not found.')).toBeVisible();
    await expect(page.getByText(contact.lastName)).toHaveCount(0);
  });
});
