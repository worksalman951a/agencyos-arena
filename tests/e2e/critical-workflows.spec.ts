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

import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createAccount, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
});

/** A Bento panel, scoped to the rendered shell so hidden copies cannot match. */
function bentoPanel(page: Page, name: string | RegExp): Locator {
  return page
    .locator('#main-content')
    .locator('section')
    .filter({ has: page.getByRole('heading', { name }) });
}

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
    const main = page.locator('#main-content');

    await page.goto('/crm/contacts');
    await expect(main.getByRole('heading', { name: 'Contacts', level: 1 })).toBeVisible();

    // Bento lists contacts as selectable rows that drive an overview rail; the
    // record itself is opened from that rail, not from a link in the row.
    const directory = main.getByRole('table', { name: 'Contacts list' });
    const row = directory.getByRole('row').filter({ hasText: contact.lastName });
    await expect(row).toHaveCount(1);
    await row.click();

    const overview = bentoPanel(page, 'Contact Overview');
    await expect(overview.getByRole('heading', { name: `E2E ${contact.lastName}` })).toBeVisible();
    await overview.getByRole('link', { name: 'Full Profile' }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/contacts/${contact.id}`));
    await expect(main.getByRole('heading', { level: 1 })).toContainText(contact.lastName);

    // Persistence: a full reload of the detail page still serves the record.
    await page.reload();
    await expect(main.getByRole('heading', { level: 1 })).toContainText(contact.lastName);

    // Search finds it, and a query with no matches shows the empty state.
    await page.goto('/crm/contacts');
    const search = main.getByRole('textbox', { name: 'Search contacts' });
    await search.fill(contact.lastName);
    // The Bento toolbar submits the search form; there is no separate button.
    await search.press('Enter');
    await expect(page).toHaveURL(new RegExp(`search=${contact.lastName}`));
    await expect(
      main.getByRole('table', { name: 'Contacts list' }).getByRole('row').filter({
        hasText: contact.lastName,
      })
    ).toHaveCount(1);

    await page.goto('/crm/contacts?search=no-such-contact-4f2b1c');
    await expect(main.getByRole('status')).toContainText('No contacts match');
    await expect(main.getByRole('status')).toContainText('no-such-contact-4f2b1c');
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

    const main = page.locator('#main-content');
    // Enter through the visible Bento navigation rather than deep-linking past
    // the shell. Bootstrap enables bento_shell for this isolated organization.
    await page.goto('/dashboard');
    const sidebar = page.getByRole('complementary', { name: 'Main navigation' });
    await expect(sidebar).toBeVisible();
    const invoicesLink = sidebar.getByRole('link', { name: 'Invoices', exact: true });
    await expect(invoicesLink).toBeVisible();
    await invoicesLink.click();
    await expect(page).toHaveURL(/\/finance\/invoices$/);
    await expect(main.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();

    // Bento renders the register as button rows with an inspector rail. Select
    // the seeded invoice by its generated number, never an unrelated row.
    const row = bentoPanel(page, /^Invoices Register/)
      .getByRole('button')
      .filter({ hasText: invoice.number });
    await expect(row).toHaveCount(1);
    await row.click();

    const inspector = bentoPanel(page, 'Invoice Inspector');
    await expect(inspector).toContainText(invoice.number);
    const openDetail = inspector.getByRole('link', { name: 'Open Detail' });
    await expect(openDetail).toHaveAttribute('href', `/finance/invoices/${invoice.id}`);
    await openDetail.click();
    await expect(page).toHaveURL(new RegExp(`/finance/invoices/${invoice.id}$`));
    await expect(main.getByRole('heading', { level: 1 })).toContainText(invoice.number);
    await expect(main.getByText('E2E audit invoice').first()).toBeVisible();
  });
});

test.describe('settings', () => {
  test('saves organization details and keeps them after a reload', async ({ authedPage: page }) => {
    const main = page.locator('#main-content');
    await page.goto('/settings');
    await expect(
      main.getByRole('heading', { name: 'Settings & Branding', level: 1 })
    ).toBeVisible();

    // Bento replaces the long scroll of sections with a Settings Center rail.
    await bentoPanel(page, 'Settings Center')
      .getByRole('button', { name: /Organization Profile/ })
      .click();
    const organization = bentoPanel(page, 'Organisation Profile');
    await expect(organization).toBeVisible();

    const nameInput = organization.locator('#bento-org-name');
    await expect(nameInput).toBeVisible();

    const updatedName = `Renamed ${Date.now()}`;
    await nameInput.fill(updatedName);
    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/settings/organization') &&
          response.request().method() === 'PUT'
      ),
      organization.getByRole('button', { name: 'Save Organization' }).click(),
    ]);
    expect(saved.status(), `organization save failed: ${await saved.text()}`).toBe(200);

    await expect(organization.getByText('Organization information saved.')).toBeVisible();

    await page.reload();
    await expect(main.locator('#bento-org-name')).toHaveValue(updatedName);
  });

  test('rejects an empty organization name with a field error instead of saving', async ({
    authedPage: page,
  }) => {
    const main = page.locator('#main-content');
    await page.goto('/settings');
    const organization = bentoPanel(page, 'Organisation Profile');
    const nameInput = organization.locator('#bento-org-name');
    await expect(nameInput).toBeVisible();
    const savedName = await nameInput.inputValue();
    expect(savedName, 'the workspace starts with a name to protect').not.toBe('');

    const saveRequests: string[] = [];
    const recordSave = (request: { url: () => string; method: () => string }) => {
      if (request.url().endsWith('/api/v1/settings/organization') && request.method() === 'PUT') {
        saveRequests.push(request.url());
      }
    };
    page.on('request', recordSave);

    await nameInput.fill('');
    await organization.getByRole('button', { name: 'Save Organization' }).click();

    // The Bento field is `required`, so the browser reports the field error on
    // the input and blocks the submit before any write can reach the API.
    await expect(nameInput).toHaveAttribute('required', '');
    expect(await nameInput.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(
      true
    );
    expect(
      await nameInput.evaluate((input: HTMLInputElement) => input.validationMessage),
      'the empty field must explain itself to the user'
    ).not.toBe('');
    expect(saveRequests, 'an empty name must never reach the save endpoint').toHaveLength(0);
    page.off('request', recordSave);

    await page.reload();
    await expect(main.locator('#bento-org-name')).not.toHaveValue('');
    await expect(main.locator('#bento-org-name')).toHaveValue(savedName);

    // A blank name that does reach the API (whitespace passes `required`) is
    // still refused with 400 + fieldErrors, rendered inline by the section.
    await main.locator('#bento-org-name').fill('   ');
    const [rejected] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/settings/organization') &&
          response.request().method() === 'PUT'
      ),
      bentoPanel(page, 'Organisation Profile')
        .getByRole('button', { name: 'Save Organization' })
        .click(),
    ]);
    expect(rejected.status(), 'the API must refuse a blank organization name').toBe(400);
    expect((await rejected.json()) as { fieldErrors?: Record<string, string> }).toMatchObject({
      fieldErrors: { name: expect.any(String) },
    });
    await expect(
      bentoPanel(page, 'Organisation Profile').getByText('Organization name is required')
    ).toBeVisible();

    await page.reload();
    await expect(main.locator('#bento-org-name')).toHaveValue(savedName);
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
