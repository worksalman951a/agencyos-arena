/**
 * End-to-end journey for Phase 5A: linking invoices to projects.
 *
 * A team member starts in the project workspace, hands off to the invoice form
 * with the project preselected, creates the invoice, and sees it from both
 * sides: on the invoice (linked project) and in the project (related invoices),
 * plus the project filter of the invoice list.
 *
 * Tenant isolation, database constraints and lifecycle rules are covered by the
 * PostgreSQL integration suite
 * (lib/__tests__/integration/finance.project-invoices.integration.test.ts); this
 * file only asserts what a user sees. Runs against the isolated Playwright
 * database.
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

async function createContact(api: APIRequestContext, account: TestAccount, lastName: string) {
  const res = await api.post('/api/v1/crm/contacts', {
    headers: authHeader(account),
    data: { firstName: 'Billing', lastName },
  });
  expect(res.status(), `contact create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string };
}

async function createProject(
  api: APIRequestContext,
  account: TestAccount,
  data: { name: string; clientId?: string; status?: string }
) {
  const res = await api.post('/api/v1/crm/projects', { headers: authHeader(account), data });
  expect(res.status(), `project create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createInvoice(api: APIRequestContext, account: TestAccount, title: string) {
  const res = await api.post('/api/v1/crm/invoices', {
    headers: authHeader(account),
    data: {
      title,
      lineItems: [{ description: 'Work', quantity: '1', unitPrice: '75.00', taxRate: '0' }],
    },
  });
  expect(res.status(), `invoice create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string; number: string; projectId: string | null };
}

test.describe('project invoices', () => {
  test('creates an invoice from a project and shows the link on both sides', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const suffix = Date.now();
    const contact = await createContact(api, account, `Billing${suffix}`);
    const project = await createProject(api, account, {
      name: `E2E Billing Project ${suffix}`,
      clientId: contact.id,
    });
    // An invoice that has nothing to do with the project: it must stay unlinked
    // and must not show up under the project.
    const unrelatedTitle = `E2E Unrelated Invoice ${suffix}`;
    const unrelated = await createInvoice(api, account, unrelatedTitle);
    expect(unrelated.projectId).toBeNull();

    // 1. The project workspace starts without invoices and offers the handoff.
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();
    const projectInvoices = page.getByTestId('project-invoices');
    await expect(projectInvoices.getByRole('heading', { name: 'Invoices (0)' })).toBeVisible();
    await expect(
      projectInvoices.getByText('No invoices linked to this project yet.')
    ).toBeVisible();

    // 2. Handoff: the invoice form opens with the project (and its client) preselected.
    await projectInvoices.getByRole('link', { name: '+ New Invoice' }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/invoices/new\\?projectId=${project.id}$`));
    await expect(page.getByTestId('invoice-project-handoff')).toContainText(project.name);
    await expect(page.locator('#projectId')).toHaveValue(project.id);
    // Bento orgs render the shell form view, whose client select is #invoice-client
    // (the legacy #clientId belongs to the non-Bento markup).
    await expect(page.locator('#invoice-client')).toHaveValue(contact.id);

    // 3. Create the invoice through the regular form.
    const invoiceTitle = `E2E Project Invoice ${suffix}`;
    await page.locator('#invoice-title').fill(invoiceTitle);
    await page.getByLabel('Line 1 description').fill('Discovery workshop');
    await page.getByLabel('Line 1 quantity').fill('2');
    await page.getByLabel('Line 1 unit price').fill('150.00');
    await page.getByLabel('Line 1 tax rate').fill('0');
    await page.getByRole('button', { name: 'Create Invoice' }).click();

    // 4. The invoice shows its project.
    await expect(page).toHaveURL(/\/finance\/invoices\/(?!new)[^/?]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Invoice ');
    const invoiceProject = page.getByTestId('invoice-project');
    await expect(invoiceProject.getByRole('link', { name: project.name })).toBeVisible();
    // Totals are still computed server-side from the line items (2 × 150.00).
    await expect(page.getByText('300.00').first()).toBeVisible();

    // 5. Back in the project workspace the invoice is listed — and only that one.
    await invoiceProject.getByRole('link', { name: project.name }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));
    await expect(projectInvoices.getByRole('heading', { name: 'Invoices (1)' })).toBeVisible();
    await expect(projectInvoices.getByText(invoiceTitle)).toBeVisible();
    await expect(projectInvoices.getByText(unrelatedTitle)).toHaveCount(0);

    // 6. "View all" opens the invoice list filtered by the project.
    await projectInvoices.getByRole('link', { name: 'View all' }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/invoices\\?projectId=${project.id}$`));

    // The filter control reports the project the workspace handed over.
    const projectFilter = page.getByLabel('Filter by project');
    await expect(projectFilter).toHaveValue(project.id);

    // The register is scoped by the server: the linked invoice is listed and the
    // unrelated one is not. (The Bento register renders rows as buttons, so this
    // matches on text rather than a table row role.)
    await expect(page.getByText(invoiceTitle).first()).toBeVisible();
    await expect(page.getByText(unrelatedTitle)).toHaveCount(0);

    // Clearing the project filter restores the unfiltered list, server-side.
    await projectFilter.selectOption('');
    await expect(page).toHaveURL(/\/finance\/invoices$/);
    await expect(page.getByText(unrelatedTitle).first()).toBeVisible();
  });

  test('does not preselect an archived project in the invoice form', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const archived = await createProject(api, account, {
      name: `E2E Archived Project ${Date.now()}`,
      status: 'archived',
    });

    // The archived workspace offers no invoice handoff …
    await page.goto(`/projects/${archived.id}`);
    await expect(page.getByRole('heading', { name: archived.name, level: 1 })).toBeVisible();
    await expect(
      page.getByTestId('project-invoices').getByRole('link', { name: '+ New Invoice' })
    ).toHaveCount(0);

    // … and a hand-typed handoff URL is refused rather than silently honoured.
    await page.goto(`/finance/invoices/new?projectId=${archived.id}`);
    await expect(page.getByTestId('invoice-project-unavailable')).toBeVisible();
    await expect(page.getByTestId('invoice-project-handoff')).toHaveCount(0);
    await expect(page.locator('#projectId')).toHaveValue('');
    await expect(page.locator(`#projectId option[value="${archived.id}"]`)).toHaveCount(0);
  });
});
