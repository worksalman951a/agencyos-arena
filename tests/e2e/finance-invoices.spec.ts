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

    // The accounting-register summary lives in the Bento page header, one of the
    // subtrees React streams inside this page's <Suspense> boundary. Until that
    // boundary hydrates, React keeps a second copy of the chunk in a hidden
    // staging node (`<div hidden id="S:0">`) outside `#main-content`; it is never
    // displayed and is removed once hydration swaps it in. Both copies carry the
    // same text, so `getByText` is momentarily ambiguous - scope to the rendered
    // shell rather than racing it, and never mask it with .first(), which would
    // also accept the copy a user cannot see.
    const registerSummary = page
      .locator('#main-content')
      .getByText(/invoices? tracked in accounting register/);
    await expect(registerSummary).toBeVisible();

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
    // Same streaming caveat as the register summary above.
    await expect(
      page.locator('#main-content').getByText('No invoices match those filters')
    ).toBeVisible();

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

/**
 * The invoice list gained a "Filter by project" control. Arriving from
 * Project Workspace -> Invoices -> "View all" lands on
 * `/finance/invoices?projectId=<id>`; the control must report that project,
 * narrow the register to it, and restore the full list when cleared - all by
 * navigating, with the server doing the filtering.
 */
test.describe('invoice list project filter', () => {
  test('shows the active project, excludes unrelated invoices and restores the list on clear', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const suffix = Date.now();
    const project = await createProject(api, account, { name: `E2E Filter Project ${suffix}` });
    const linkedInvoice = await createInvoice(api, account, {
      title: `E2E Linked Invoice ${suffix}`,
      projectId: project.id,
    });
    const unrelatedInvoice = await createInvoice(api, account, {
      title: `E2E Loose Invoice ${suffix}`,
    });

    // 1. Arriving from the project workspace, the control reports the project
    //    and the register is already scoped to it by the server.
    const response = await page.goto(`/finance/invoices?projectId=${project.id}`);
    expect(response?.status(), 'the filtered list must render').toBe(200);

    const projectFilter = page.getByLabel('Filter by project').first();
    await expect(projectFilter).toBeVisible();
    await expect(projectFilter).toHaveValue(project.id);

    await expect(page.getByText(`#${linkedInvoice.number}`).first()).toBeVisible();
    await expect(page.getByText(`#${unrelatedInvoice.number}`)).toHaveCount(0);

    // 2. Clearing the filter navigates (no client-side filtering) and brings
    //    the unrelated invoice back.
    await projectFilter.selectOption('');
    await page.waitForURL((url) => !url.searchParams.has('projectId'));

    // Clearing the only filter leaves the bare list URL (no stray `?page=1`),
    // which is the first page by definition.
    expect(new URL(page.url()).pathname).toBe('/finance/invoices');
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByText(`#${unrelatedInvoice.number}`).first()).toBeVisible();
  });

  test('selecting a project keeps the search and status filters', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const suffix = Date.now();
    const project = await createProject(api, account, { name: `E2E Keep Project ${suffix}` });
    const sentInvoice = await createInvoice(api, account, {
      title: `E2E Sent Linked ${suffix}`,
      projectId: project.id,
      status: 'sent',
    });
    await createInvoice(api, account, {
      title: `E2E Draft Linked ${suffix}`,
      projectId: project.id,
    });

    // Arrive with a search and a status already applied, plus a stale page.
    await page.goto(
      `/finance/invoices?search=${encodeURIComponent(sentInvoice.number)}&status=sent&page=2`
    );

    await page.getByLabel('Filter by project').first().selectOption(project.id);
    await page.waitForURL((url) => url.searchParams.get('projectId') === project.id);

    const url = new URL(page.url());
    expect(url.searchParams.get('search')).toBe(sentInvoice.number);
    expect(url.searchParams.get('status')).toBe('sent');
    expect(url.searchParams.get('page')).toBe('1');

    // The server ANDed all three, so only the matching invoice remains.
    await expect(page.getByText(`#${sentInvoice.number}`).first()).toBeVisible();
  });

  test('never offers a project the caller was not authorized to see', async ({
    authedPage: page,
  }) => {
    // A project id from another tenant (or a deleted one) matches nothing: the
    // list stays organization-scoped and comes back empty. The control must not
    // reveal a name for it, but it must still show that a filter is applied.
    const foreign = 'proj_does_not_exist_for_this_org';
    await page.goto(`/finance/invoices?projectId=${foreign}`);

    const projectFilter = page.getByLabel('Filter by project');
    await expect(projectFilter).toHaveValue(foreign);
    await expect(projectFilter.locator(`option[value="${foreign}"]`)).toHaveText(
      'Unavailable project'
    );
    // Same streaming caveat as the register summary above.
    await expect(
      page.locator('#main-content').getByText('No invoices match those filters')
    ).toBeVisible();
  });
});
