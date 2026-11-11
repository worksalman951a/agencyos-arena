/**
 * End-to-end Playwright journeys for the Phase 4C client portal.
 *
 * These run in a real browser against the real app: the client signs up from the
 * invitation page, activates, lands in the portal, approves work, leaves feedback,
 * downloads a shared file, and is cut off the moment access is revoked. The team
 * side is exercised through its admin UI.
 *
 * Every record is created by the test (unique suffix per test) and nothing touches
 * an existing developer organization.
 */

import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { ensurePortalInviteeAccount, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
  Origin: process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
});

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface PortalFixture {
  contactId: string;
  email: string;
  password: string;
  projectId: string;
  unsharedProjectId: string;
  token: string;
  acceptPath: string;
}

/** Team-side API setup: contact, project, invitation. */
async function seedInvitation(
  api: APIRequestContext,
  account: TestAccount
): Promise<PortalFixture> {
  const unique = suffix();
  const email = `portal-client-${unique}@e2e.agencyos.invalid`;

  const contact = await api.post('/api/v1/crm/contacts', {
    headers: authHeader(account),
    data: { firstName: 'Portal', lastName: `Client${unique}`, email },
  });
  expect(contact.status(), `contact create failed: ${await contact.text()}`).toBe(201);
  const contactId = ((await contact.json()) as { id: string }).id;

  const project = await api.post('/api/v1/crm/projects', {
    headers: authHeader(account),
    data: { name: `Portal E2E Project ${unique}`, clientId: contactId },
  });
  expect(project.status(), `project create failed: ${await project.text()}`).toBe(201);
  const projectId = ((await project.json()) as { id: string }).id;

  const hidden = await api.post('/api/v1/crm/projects', {
    headers: authHeader(account),
    data: { name: `Portal E2E Hidden ${unique}`, clientId: contactId },
  });
  expect(hidden.status(), `hidden project create failed: ${await hidden.text()}`).toBe(201);

  const invitation = await api.post('/api/v1/admin/client-invitations', {
    headers: authHeader(account),
    data: { email, contactId, role: 'client_approver' },
  });
  expect(invitation.status(), `invitation failed: ${await invitation.text()}`).toBe(201);
  const body = (await invitation.json()) as { token: string; acceptPath: string };

  return {
    contactId,
    email,
    password: 'portal-e2e-password-2026',
    projectId,
    unsharedProjectId: ((await hidden.json()) as { id: string }).id,
    token: body.token,
    acceptPath: body.acceptPath,
  };
}

/**
 * Activate a client through the UI: invite page → create password → accept.
 *
 * The account may already exist (a Playwright retry of a test that got as far as
 * signing up, or Better Auth's sign-up rate limiter answering 429), so if the
 * create-password submit comes back with an alert the helper falls back to the
 * sign-in half of the same form instead of failing.
 */
/**
 * Sign in on the invitation page and accept it.
 *
 * The account itself is created through the API (`ensurePortalInviteeAccount`), so
 * this journey is about the portal's sign-in + acceptance path rather than about
 * Better Auth's sign-up rate limiter. The create-password path has its own test.
 */
async function activateThroughInvitePage(
  browser: Browser,
  api: APIRequestContext,
  fixture: PortalFixture
): Promise<Page> {
  await ensurePortalInviteeAccount(api, fixture.email, fixture.password);

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(fixture.acceptPath);
  await expect(page.getByRole('heading', { name: 'Client portal invitation' })).toBeVisible();
  // The address appears in the invitation copy and again in the sign-in hint.
  await expect(page.getByText(fixture.email).first()).toBeVisible();

  await page.getByLabel('E-mail').fill(fixture.email);
  await page.getByLabel('Password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const acceptButton = page.getByTestId('accept-invitation');
  await expect(acceptButton).toBeVisible({ timeout: 30_000 });
  await acceptButton.click();

  await expect(page).toHaveURL(/\/portal$/, { timeout: 30_000 });
  return page;
}

async function grantProject(
  api: APIRequestContext,
  account: TestAccount,
  clientAccessId: string,
  projectId: string
): Promise<void> {
  const grant = await api.post(`/api/v1/admin/client-access/${clientAccessId}/grants`, {
    headers: authHeader(account),
    data: { resourceType: 'project', resourceId: projectId, canComment: true, canApprove: true },
  });
  expect(grant.status(), `grant failed: ${await grant.text()}`).toBe(201);
}

async function clientAccessIdFor(
  api: APIRequestContext,
  account: TestAccount,
  email: string
): Promise<string> {
  const list = await api.get('/api/v1/admin/client-access', { headers: authHeader(account) });
  expect(list.status()).toBe(200);
  const rows = ((await list.json()) as { data: Array<{ id: string; email: string }> }).data;
  // The worker owns one agency across its tests, so several client identities can
  // exist; select the one belonging to this journey rather than "the last one".
  const row = rows.find((candidate) => candidate.email === email);
  expect(row, `no client access for ${email}`).toBeDefined();
  return row!.id;
}

// Each journey provisions an agency, a client identity, a grant and then drives the
// browser through activation/approval. That is several server renders, well past
// Playwright's 30s default.
test.describe.configure({ timeout: 120_000 });

test.describe('Client portal end-to-end journeys', () => {
  test('an invitee creates their password from the invitation page and accepts it', async ({
    api,
    account,
    browser,
  }) => {
    const fixture = await seedInvitation(api, account);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(fixture.acceptPath);
    await page.getByRole('button', { name: 'First time here? Create your password' }).click();
    await page.getByLabel('Your name').fill('Portal Signup');
    await page.getByLabel('E-mail').fill(fixture.email);
    await page.getByLabel('Password').fill(fixture.password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Either the invitation re-renders signed in (the happy path) or the form
    // reports why it could not create the account — asserted below.
    const acceptButton = page.getByTestId('accept-invitation');
    // The form's own error banner, never Next's empty route announcer.
    const formError = page.locator('form [role="alert"]');
    await Promise.race([
      acceptButton.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => undefined),
      formError.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => undefined),
    ]);

    const alertText = await formError
      .first()
      .textContent()
      .catch(() => null);
    expect(alertText, 'the invitation page reported an error instead of activating').toBeNull();

    await expect(acceptButton).toBeVisible({ timeout: 30_000 });
    await acceptButton.click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 30_000 });

    // The accepting identity is a client: no workspace, no team surfaces.
    await page.goto('/admin/client-portal');
    await expect(page).toHaveURL(/\/portal$/, { timeout: 30_000 });

    await page.context().close();
  });

  test('a client activates from the invitation, logs in, and sees only the shared project', async ({
    api,
    account,
    browser,
  }) => {
    const fixture = await seedInvitation(api, account);

    // --- the team shares the project before the client activates
    const page = await activateThroughInvitePage(browser, api, fixture);
    const accessId = await clientAccessIdFor(api, account, fixture.email);
    await grantProject(api, account, accessId, fixture.projectId);
    await page.reload();

    await expect(page.getByRole('link', { name: /Portal E2E Project/ }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Portal E2E Hidden', { exact: false })).toHaveCount(0);

    // --- project detail is reachable for the shared project…
    await page
      .getByRole('link', { name: /Portal E2E Project/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: /Portal E2E Project/ })).toBeVisible();
    await expect(page.getByTestId('project-progress')).toBeVisible();

    // --- …and answers 404 for the project that was never shared, with the same
    //     copy a nonexistent id would produce.
    const hidden = await page.goto(`/portal/projects/${fixture.unsharedProjectId}`);
    expect(hidden?.status()).toBe(404);
    await expect(page.getByText('This item is not available to you')).toBeVisible();

    // --- signing out of the portal ends the session for the client surface
    await page.goto('/portal');
    await page.context().clearCookies();
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 20_000 });

    // --- and logging back in through the portal form works
    await page.getByLabel('E-mail').fill(fixture.email);
    await page.getByLabel('Password').fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 20_000 });
    await expect(page.getByText(/signed in as/i)).toBeVisible();

    await page.context().close();
  });

  test('a client approves a request and the decision is recorded in the history', async ({
    api,
    account,
    browser,
  }) => {
    const fixture = await seedInvitation(api, account);
    const page = await activateThroughInvitePage(browser, api, fixture);
    const accessId = await clientAccessIdFor(api, account, fixture.email);
    await grantProject(api, account, accessId, fixture.projectId);

    const approval = await api.post('/api/v1/admin/client-approvals', {
      headers: authHeader(account),
      data: {
        clientAccessId: accessId,
        resourceType: 'project',
        resourceId: fixture.projectId,
        title: `Approve the homepage ${suffix()}`,
      },
    });
    expect(approval.status(), `approval create failed: ${await approval.text()}`).toBe(201);
    const approvalBody = (await approval.json()) as { id: string; title: string };

    await page.goto('/portal/approvals');
    await page
      .getByRole('link', { name: new RegExp(approvalBody.title) })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: approvalBody.title })).toBeVisible();

    await page.getByLabel('Note (optional)').fill('Approved from the E2E journey.');
    await page.getByTestId('approve-button').click();

    await expect(page.getByText(/approved/i).first()).toBeVisible({ timeout: 20_000 });

    // The decision form is gone: a decided request is terminal.
    await expect(page.getByTestId('approve-button')).toHaveCount(0);
    await expect(page.getByTestId('approval-decision')).toContainText(
      'Approved from the E2E journey.'
    );

    // History shows both the request (by the team) and the decision (by the client).
    const history = page.getByTestId('approval-history');
    await expect(history.getByText(/requested/i)).toBeVisible();
    await expect(history.getByText(/You\s+approved/i)).toBeVisible();

    await page.context().close();
  });

  test('a client leaves feedback and never sees the internal note', async ({
    api,
    account,
    browser,
  }) => {
    const fixture = await seedInvitation(api, account);
    const page = await activateThroughInvitePage(browser, api, fixture);
    const accessId = await clientAccessIdFor(api, account, fixture.email);
    await grantProject(api, account, accessId, fixture.projectId);

    // Team-side internal note (never client-visible).
    const internal = await api.post('/api/v1/admin/client-comments', {
      headers: authHeader(account),
      data: {
        resourceType: 'project',
        resourceId: fixture.projectId,
        body: 'Internal: margin is thin on this one',
        visibility: 'internal',
      },
    });
    expect(internal.status(), `internal note failed: ${await internal.text()}`).toBe(201);

    await page.goto(`/portal/projects/${fixture.projectId}`);
    await page.getByLabel('Comment').fill('Client feedback from the E2E journey.');
    await page.getByRole('button', { name: 'Post comment' }).click();

    await expect(page.getByText('Client feedback from the E2E journey.')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Internal: margin is thin on this one')).toHaveCount(0);

    // The team does see both, in its own inbox.
    const inbox = await api.get(
      `/api/v1/admin/client-comments?resourceType=project&resourceId=${fixture.projectId}`,
      { headers: authHeader(account) }
    );
    expect(inbox.status()).toBe(200);
    const bodies = ((await inbox.json()) as { data: Array<{ body: string }> }).data.map(
      (row) => row.body
    );
    expect(bodies).toContain('Client feedback from the E2E journey.');
    expect(bodies).toContain('Internal: margin is thin on this one');

    await page.context().close();
  });

  test('revoking access logs the client out and blocks re-entry', async ({
    api,
    account,
    browser,
  }) => {
    const fixture = await seedInvitation(api, account);
    const page = await activateThroughInvitePage(browser, api, fixture);
    const accessId = await clientAccessIdFor(api, account, fixture.email);
    await grantProject(api, account, accessId, fixture.projectId);

    await page.goto('/portal');
    await expect(page.getByText(/signed in as/i)).toBeVisible();

    const revoked = await api.post(`/api/v1/admin/client-access/${accessId}/revoke`, {
      headers: authHeader(account),
      data: { reason: 'E2E journey end' },
    });
    expect(revoked.status(), `revoke failed: ${await revoked.text()}`).toBe(200);

    await page.goto('/portal');
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 20_000 });

    // Re-entry is refused: the account can no longer mint a session.
    await page.getByLabel('E-mail').fill(fixture.email);
    await page.getByLabel('Password').fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const formError = page.locator('form [role="alert"]');
    await expect(formError).toBeVisible({ timeout: 20_000 });
    await expect(formError).not.toBeEmpty();
    await expect(page).toHaveURL(/\/portal\/login/);

    await page.context().close();
  });

  test('the team administers the portal from the admin surface', async ({
    authedPage: page,
    api,
    account,
  }) => {
    // The invite form is only rendered once the agency has a CRM contact to invite.
    const contact = await api.post('/api/v1/crm/contacts', {
      headers: authHeader(account),
      data: { firstName: 'Admin', lastName: `Surface${suffix()}` },
    });
    expect(contact.status(), `contact create failed: ${await contact.text()}`).toBe(201);

    await page.goto('/admin/client-portal');
    await expect(page.getByRole('heading', { name: 'Client Portal', level: 1 })).toBeVisible();
    await expect(page.getByLabel('CRM contact')).toBeVisible();
    await expect(page.getByLabel('Access preset')).toBeVisible();
    await expect(page.getByRole('button', { name: /create portal invitation/i })).toBeVisible();
  });
});
