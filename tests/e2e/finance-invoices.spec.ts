/**
 * Regression: `/finance/invoices` crashed with a server error.
 *
 * The page is a Server Component and passed `onSearchChange` /
 * `onStatusFilterChange` callbacks down to the client `InvoicesClient`. React
 * refuses to serialise functions across the server/client boundary, so every
 * request to the page failed with:
 *
 *   Error: Event handlers cannot be passed to Client Component props.
 *   <... onSearchChange={function onSearchChange} onStatusFilterChange={...}>
 *   GET /finance/invoices 500
 *
 * The handlers now live inside `InvoicesClient`, which navigates to a new query
 * string instead of receiving a function. This spec asserts what a user sees:
 * the list loads, the search box and status filters work in the Bento invoices
 * view, and the server stays the only thing that loads invoices - a filtered
 * result arrives as a new server render with the other query parameters
 * preserved and pagination reset.
 *
 * Invoice loading keeps its authorization and tenant scoping on the server
 * (service + integration suites cover those); this spec only asserts the
 * visible contract.
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
    data: { firstName: 'Finance', lastName },
  });
  expect(res.status(), `contact create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string };
}

async function createProject(
  api: APIRequestContext,
  account: TestAccount,
  data: { name: string; clientId?: string }
) {
  const res = await api.post('/api/v1/crm/projects', { headers: authHeader(account), data });
  expect(res.status(), `project create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createInvoice(
  api: APIRequestContext,
  account: TestAccount,
  data: { title: string; projectId?: string; status?: 'draft' | 'sent' }
) {
  const res = await api.post('/api/v1/crm/invoices', {
    headers: authHeader(account),
    data: {
      ...data,
      lineItems: [{ description: 'Work', quantity: '1', unitPrice: '75.00', taxRate: '0' }],
    },
  });
  expect(res.status(), `invoice create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string; number: string; title: string };
}

test.describe('finance invoices list', () => {
  test('loads without a server error and applies filters through URL navigation', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const suffix = Date.now();
    const contact = await createContact(api, account, `Invoices${suffix}`);
    const project = await createProject(api, account, {
      name: `E2E Finance Project ${suffix}`,
      clientId: contact.id,
    });

    const projectInvoice = await createInvoice(api, account, {
      title: `E2E Project Invoice ${suffix}`,
      projectId: project.id,
    });
    const otherInvoice = await createInvoice(api, account, {
      title: `E2E Unrelated Invoice ${suffix}`,
    });

    // 1. The page renders at all. Before the fix this request returned a 500 and
    //    the user only saw the framework's "This page couldn't load" screen.
    const response = await page.goto('/finance/invoices');
    expect(response?.status(), 'the invoice list must not fail to render').toBe(200);
    await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
    await expect(page.getByText(/invoices? tracked in accounting register/)).toBeVisible();

    // 2. Both invoices are listed: loading stays server-side and organization-scoped.
    await expect(page.getByText(`#${projectInvoice.number}`).first()).toBeVisible();
    await expect(page.getByText(`#${otherInvoice.number}`).first()).toBeVisible();

    // 3. Search navigates instead of filtering client-side, keeps the other
    //    parameters (`projectId`) and resets pagination to page 1.
    await page.goto(`/finance/invoices?projectId=${project.id}&page=2`);

    await page.getByLabel('Search invoices').fill(otherInvoice.number);
    await page.getByLabel('Search invoices').press('Enter');
    await page.waitForURL((url) => url.searchParams.get('search') === otherInvoice.number);

    const searched = new URL(page.url());
    expect(searched.pathname).toBe('/finance/invoices');
    expect(searched.searchParams.get('projectId')).toBe(project.id);
    expect(searched.searchParams.get('page')).toBe('1');

    // The server ANDed both filters, so nothing matches: the client never
    // narrows a result set on its own, and the empty state is a server render.
    await expect(page.getByText('No invoices match those filters')).toBeVisible();

    // 4. Clearing the search restores the project-scoped list, again server-side.
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.waitForURL((url) => !url.searchParams.has('search'));
    await expect(page.getByText(`#${projectInvoice.number}`).first()).toBeVisible();
    await expect(page.getByText(`#${otherInvoice.number}`)).toHaveCount(0);
  });

  test('applies the status filter through URL navigation', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const suffix = Date.now();
    const draftInvoice = await createInvoice(api, account, {
      title: `E2E Draft Invoice ${suffix}`,
    });
    const sentInvoice = await createInvoice(api, account, {
      title: `E2E Sent Invoice ${suffix}`,
      status: 'sent',
    });

    await page.goto('/finance/invoices');
    await expect(page.getByText(`#${draftInvoice.number}`).first()).toBeVisible();
    await expect(page.getByText(`#${sentInvoice.number}`).first()).toBeVisible();

    // Filtering by status is a navigation to `?status=…&page=1`.
    await page.getByRole('tab', { name: 'Sent' }).click();
    await page.waitForURL((url) => url.searchParams.get('status') === 'sent');

    const filtered = new URL(page.url());
    expect(filtered.searchParams.get('page')).toBe('1');

    // Only the matching invoice comes back - from the server, not the client.
    await expect(page.getByText(`#${sentInvoice.number}`).first()).toBeVisible();
    await expect(page.getByText(`#${draftInvoice.number}`)).toHaveCount(0);

    // Returning to "All" drops the filter parameter entirely.
    await page.getByRole('tab', { name: 'All' }).click();
    await page.waitForURL((url) => !url.searchParams.has('status'));
    await expect(page.getByText(`#${draftInvoice.number}`).first()).toBeVisible();
  });
});
