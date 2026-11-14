/**
 * Administration, authorization and automation end-to-end coverage.
 *
 * These drive the real UI against a real server and database:
 * - the notification centre (create → unread → mark read → persists on reload);
 * - notification preferences (a muted type is never delivered);
 * - workflow rules (create through the form → visible in the list → disable);
 * - member administration (list, role/status edit page);
 * - permission-gated navigation (an administrator sees Administration);
 * - audit log filtering.
 *
 * Every test uses the worker's own account, which owns its own organization, so
 * nothing shared is mutated.
 */

import { chromium, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { APP_URL, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
});

/** Scope Bento assertions to the rendered shell, never React's hidden staging copy. */
function bentoPanel(page: Page, name: string | RegExp): Locator {
  return page
    .locator('#main-content')
    .locator('section')
    .filter({ has: page.getByRole('heading', { name }) });
}

/** The value in a labelled Bento metric, not a number mentioned in its note. */
function bentoMetric(page: Page, label: string): Locator {
  return page
    .locator('#main-content')
    .locator('section')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('.pmx-stat__num');
}

function ruleRow(page: Page, name: string): Locator {
  return bentoPanel(page, /^Workflow Rules Directory/)
    .getByRole('button')
    .filter({ hasText: name });
}

async function createNotification(
  api: APIRequestContext,
  account: TestAccount,
  body: { type: string; payload?: Record<string, unknown>; dedupeKey?: string }
) {
  const userId = await currentUserId(api, account);
  const res = await api.post('/api/v1/automation/notifications', {
    headers: authHeader(account),
    data: { userId, channel: 'in_app', ...body },
  });
  expect(res.status(), `notification create failed: ${await res.text()}`).toBe(201);
}

async function currentUserId(api: APIRequestContext, account: TestAccount): Promise<string> {
  const res = await api.get('/api/auth/get-session', { headers: authHeader(account) });
  const body = (await res.json()) as { user?: { id?: string } };
  const userId = body.user?.id;
  expect(userId, 'session should expose the user id').toBeTruthy();
  return userId!;
}

/** Open the Bento rule form, submit it and return its unique directory row. */
async function createRuleThroughUi(page: Page, name: string): Promise<Locator> {
  const main = page.locator('#main-content');
  await page.goto('/automation/rules');
  await expect(main.getByRole('heading', { name: 'Automation Rules', level: 1 })).toBeVisible();

  const form = main.getByTestId('new-rule-form');
  await form.locator('#name').fill(name);
  await form.locator('#trigger').selectOption('record.created');
  await form.locator('#conditionField').fill('status');
  await form.locator('#conditionOperator').selectOption('eq');
  await form.locator('#conditionValue').fill('open');
  await form.locator('#actionType').selectOption('log');
  await form.locator('#actionMessage').fill('created via e2e');

  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/automation/workflows') &&
        response.request().method() === 'POST'
    ),
    form.getByRole('button', { name: 'Create rule' }).click(),
  ]);
  expect(created.status(), `rule create failed: ${await created.text()}`).toBe(201);

  // Bento renders each rule as a button row, not a table row with cells.
  const row = ruleRow(page, name);
  await expect(row, 'the new rule should appear exactly once in the directory').toHaveCount(1);
  await expect(row).toBeVisible();
  return row;
}

test.describe('notifications', () => {
  test('renders an explicit empty state with no notifications', async ({ authedPage: page }) => {
    const main = page.locator('#main-content');
    await page.goto('/automation/notifications');
    await expect(
      main.getByRole('heading', { name: 'Notification Center', level: 1 })
    ).toBeVisible();
    await expect(
      main.getByRole('status').getByText('No notifications in your inbox')
    ).toBeVisible();
    await expect(bentoMetric(page, 'Total Notifications')).toHaveText('0');
    await expect(bentoMetric(page, 'Unread Messages')).toHaveText('0');
    // The bulk action is disabled when there is nothing to mark.
    await expect(main.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  test('honours notification preferences: a muted type is never delivered', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const main = page.locator('#main-content');
    await page.goto('/automation/preferences');
    await expect(
      main.getByRole('heading', { name: 'Notification Preferences', level: 1 })
    ).toBeVisible();

    await main.getByLabel('Mute workflow automation notifications').check();
    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/automation/preferences') &&
          response.request().method() === 'PUT'
      ),
      main.getByRole('button', { name: 'Save preferences' }).click(),
    ]);
    expect(saved.status(), `preference save failed: ${await saved.text()}`).toBe(200);

    // The preference is persisted for the next request.
    await page.reload();
    await expect(main.getByLabel('Mute workflow automation notifications')).toBeChecked();

    const userId = await currentUserId(api, account);
    const res = await api.post('/api/v1/automation/notifications', {
      headers: authHeader(account),
      data: { userId, type: 'workflow', channel: 'in_app' },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()) as { skipped?: boolean }).toMatchObject({ skipped: true });

    await page.goto('/automation/notifications');
    await expect(
      main.getByRole('status').getByText('No notifications in your inbox')
    ).toBeVisible();
    await expect(bentoMetric(page, 'Total Notifications')).toHaveText('0');
  });

  test('shows a created notification as unread, marks it read and persists', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const title = 'Review the proposal';
    await createNotification(api, account, {
      type: 'e2e_notice',
      payload: { title },
    });

    const main = page.locator('#main-content');
    await page.goto('/automation/notifications');
    await expect(
      main.getByRole('heading', { name: 'Notification Center', level: 1 })
    ).toBeVisible();
    await expect(bentoMetric(page, 'Total Notifications')).toHaveText('1');
    await expect(bentoMetric(page, 'Unread Messages')).toHaveText('1');

    // The stream labels an unread item "New"; the inspector calls it "Unread".
    // Use the stream row so the assertion and action cannot address different copies.
    const row = bentoPanel(page, /^Notification Stream/)
      .getByRole('button')
      .filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('New', { exact: true })).toBeVisible();

    // Both the stream row and inspector offer Mark Read; act on the row itself.
    const [marked] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/automation/notifications/') &&
          response.url().endsWith('/read') &&
          response.request().method() === 'POST'
      ),
      row.getByRole('button', { name: 'Mark Read', exact: true }).click(),
    ]);
    expect(marked.status(), `mark read failed: ${await marked.text()}`).toBe(200);
    await expect(row.getByText('Read', { exact: true })).toBeVisible();
    await expect(bentoMetric(page, 'Unread Messages')).toHaveText('0');

    // Persistence: the read state is in the database, not component state.
    await page.reload();
    await expect(row.getByText('Read', { exact: true })).toBeVisible();
    await expect(bentoMetric(page, 'Total Notifications')).toHaveText('1');
    await expect(bentoMetric(page, 'Unread Messages')).toHaveText('0');
    await expect(bentoMetric(page, 'Read Notifications')).toHaveText('1');
  });
});

test.describe('workflow rules', () => {
  test('creates a rule through the form, shows it in the list and disables it', async ({
    authedPage: page,
  }) => {
    const name = `E2E rule ${Date.now()}`;
    const row = await createRuleThroughUi(page, name);

    await expect(row).toContainText('record.created');
    // Bento calls an enabled rule "Active" in the directory.
    await expect(row.getByText('Active', { exact: true })).toBeVisible();

    const [disabled] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/automation/workflows/') &&
          response.request().method() === 'PATCH'
      ),
      row.getByRole('button', { name: 'Disable', exact: true }).click(),
    ]);
    expect(disabled.status(), `rule disable failed: ${await disabled.text()}`).toBe(200);
    await expect(row.getByText('Disabled', { exact: true })).toBeVisible();

    // Persistence across a reload.
    await page.reload();
    await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
    await expect(bentoMetric(page, 'Enabled Rules')).toHaveText('0');
    await expect(bentoMetric(page, 'Standby / Disabled')).toHaveText('1');
  });

  test('rejects an invalid rule through the API and shows the execution history page', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const name = `E2E history ${Date.now()}`;
    await createRuleThroughUi(page, name);

    const created = await api.get('/api/v1/automation/workflows', { headers: authHeader(account) });
    const rules = (await created.json()) as Array<{ id: string; name: string }>;
    const rule = rules.find((candidate) => candidate.name === name);
    expect(rule, 'the rule created in the UI should be listed by the API').toBeTruthy();

    // An unsupported action is refused: no dead rules can be saved.
    const invalid = await api.post('/api/v1/automation/workflows', {
      headers: authHeader(account),
      data: {
        name: `${name} invalid`,
        trigger: 'record.created',
        actions: { list: [{ type: 'send_email', to: 'x@example.test' }] },
      },
    });
    expect(invalid.status()).toBe(400);

    const main = page.locator('#main-content');
    await page.goto(`/automation/rules/${rule!.id}`);
    await expect(main.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Configured Actions' })).toBeVisible();
    await expect(
      main.getByRole('status').getByText('No execution runs recorded yet')
    ).toBeVisible();
    await expect(bentoMetric(page, 'Total Dispatches')).toHaveText('0');
  });

  test('dispatches an event, records the execution and shows it in the history', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const name = `E2E execute ${Date.now()}`;
    await createRuleThroughUi(page, name);

    const created = await api.get('/api/v1/automation/workflows', { headers: authHeader(account) });
    const rules = (await created.json()) as Array<{ id: string; name: string }>;
    const rule = rules.find((candidate) => candidate.name === name)!;

    const event = {
      type: 'record.created',
      recordType: 'Task',
      recordId: `task-${Date.now()}`,
      record: { status: 'open' },
    };

    const first = await api.post('/api/v1/automation/events', {
      headers: authHeader(account),
      data: event,
    });
    expect(first.status()).toBe(200);
    // Other enabled rules in this worker's workspace may match the same event;
    // the deduplication contract is one execution per rule and record.
    const firstBody = (await first.json()) as { executions?: Array<{ ruleId: string }> };
    expect(firstBody.executions?.filter((execution) => execution.ruleId === rule.id)).toHaveLength(
      1
    );

    // The same event again must not execute this rule twice.
    const second = await api.post('/api/v1/automation/events', {
      headers: authHeader(account),
      data: event,
    });
    expect(second.status()).toBe(200);
    const secondBody = (await second.json()) as { executions?: Array<{ ruleId: string }> };
    expect(secondBody.executions?.filter((execution) => execution.ruleId === rule.id)).toHaveLength(
      0
    );

    const main = page.locator('#main-content');
    await page.goto(`/automation/rules/${rule.id}`);
    await expect(main.getByRole('heading', { name, level: 1 })).toBeVisible();
    const row = bentoPanel(page, /^Execution Run Register/)
      .getByRole('button')
      .filter({ hasText: event.recordId });
    await expect(
      row,
      'deduplication should leave exactly one execution for this record'
    ).toHaveCount(1);
    await expect(row.getByText('succeeded', { exact: true })).toBeVisible();
    await expect(row.getByText('1 attempt', { exact: true })).toBeVisible();
    await expect(bentoMetric(page, 'Total Dispatches')).toHaveText('1');
    await expect(bentoMetric(page, 'Failed Executions')).toHaveText('0');
  });
});

test.describe('administration', () => {
  test('lists members, opens a member and shows the audit trail', async ({
    authedPage: page,
    account,
    api,
  }) => {
    // Produce a known audit event whose actor is this member, so the audit trail
    // below is tied to the member that was opened rather than to any entry.
    await createNotification(api, account, { type: 'audit_probe' });

    // Every bootstrapped organization renders the Bento shell, whose Users &
    // Members directory lists rows as buttons (the legacy `<td>` table with
    // `role=cell` is only rendered without Bento).
    const main = page.locator('#main-content');
    await page.goto('/admin/users');
    await expect(main.getByRole('heading', { name: 'Users & Members', level: 1 })).toBeVisible();

    const directory = main
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /Members Directory/ }) });
    // Find the seeded member by its unique identity - never by row position.
    const memberRow = directory.getByRole('button').filter({ hasText: account.email });
    await expect(
      memberRow,
      'the directory should list exactly one row for this member'
    ).toHaveCount(1);
    await expect(memberRow).toContainText(account.email);

    // Open it through the visible row action.
    await memberRow.getByRole('link', { name: 'Edit' }).click();
    await page.waitForURL(/\/admin\/users\/[^/]+$/);

    // The detail page settles on the member that was opened: the email and the
    // heading both name it, so a wrong member could not pass.
    const detailHeading = page.locator('h1').first();
    await expect(detailHeading).toContainText('Edit Member');
    await expect(detailHeading).not.toContainText('Loading');
    await expect(page.getByText(account.email).first()).toBeVisible();
    await expect(detailHeading).toContainText('E2E account');

    // The role selector is populated from the organization's real roles.
    const roleSelector = page.locator('#roleId');
    await expect(roleSelector).toBeVisible();
    await expect(roleSelector).toContainText('Administrator');

    // The audit trail shows the event produced above, attributed to this member.
    await page.goto('/admin/audit-logs?action=notification.');
    await expect(main.getByRole('heading', { name: 'Audit Activity Log', level: 1 })).toBeVisible();
    await expect(main.getByText('Total Audit Entries')).toBeVisible();

    const register = main
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /Audit Register/ }) });
    await expect(register.getByText('notification.create').first()).toBeVisible();
    await expect(
      register.getByText(`by ${account.email}`).first(),
      'the audit entry should be attributed to the member that was opened'
    ).toBeVisible();
  });

  test('filters the audit log by action', async ({ authedPage: page, api, account }) => {
    // Produce known audit entries with two different actions: `notification.`
    // matches the first, and must never match the second.
    await createNotification(api, account, { type: 'audit_probe' });
    const otherRes = await api.post('/api/v1/crm/contacts', {
      headers: { ...authHeader(account), Origin: APP_URL },
      data: { firstName: 'Audit', lastName: `Filter${Date.now()}` },
    });
    expect(otherRes.status(), `contact create failed: ${await otherRes.text()}`).toBe(201);

    const main = page.locator('#main-content');
    // The register panel, not the forensic inspector beside it - both render the
    // selected entry's action, so the row count must be scoped to the register.
    const register = main
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /Audit Register/ }) });

    await page.goto('/admin/audit-logs?action=notification.');
    await expect(main.getByRole('heading', { name: 'Audit Activity Log', level: 1 })).toBeVisible();

    // Matching entries are shown…
    await expect(register.getByText('notification.create').first()).toBeVisible();
    // …and non-matching ones are excluded.
    await expect(register.getByText(/^contact\./)).toHaveCount(0);
    // Every register row under this filter carries the filtered action.
    const actions = await register.getByText(/^[a-z_]+\.[a-z_]+$/).allInnerTexts();
    expect(actions.length, 'the filtered register should list matching entries').toBeGreaterThan(0);
    expect(actions.every((action) => action.startsWith('notification.'))).toBe(true);

    // A filter that matches nothing reports the explicit Bento empty state.
    await page.goto('/admin/audit-logs?action=does.not.exist');
    await expect(main.getByRole('status').getByText('No audit entries match query')).toBeVisible();
    // The empty state is scoped to this filter, not a general empty list.
    await expect(main.getByText('Filtered Action')).toBeVisible();
    await expect(main.getByText('does.not.exist')).toBeVisible();
  });

  test('keeps the action filter when paging to page 2', async ({
    authedPage: page,
    api,
    account,
  }) => {
    // The register paginates at 25 entries, so seed past one page of matches.
    for (let i = 0; i < 26; i++) {
      await createNotification(api, account, { type: 'audit_probe' });
    }

    const main = page.locator('#main-content');
    const register = main
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /Audit Register/ }) });

    await page.goto('/admin/audit-logs?action=notification.');
    await expect(main.getByText(/Page 1 of \d+/)).toBeVisible();

    // The Next link has to carry the active filter, not just the page number.
    const next = main.getByRole('link', { name: 'Next' });
    await expect(next).toHaveAttribute('href', /action=notification\./);

    await next.click();
    await page.waitForURL((url) => url.searchParams.get('page') === '2');
    expect(new URL(page.url()).searchParams.get('action')).toBe('notification.');

    // Page 2 is still the filtered set: matching rows, no non-matching ones.
    await expect(main.getByText(/Page 2 of \d+/)).toBeVisible();
    await expect(register.getByText('notification.create').first()).toBeVisible();
    await expect(register.getByText(/^contact\./)).toHaveCount(0);
    // The filter is still reported by the page, and Previous keeps it too.
    await expect(main.getByText('Filtered Action')).toBeVisible();
    await expect(main.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      /action=notification\./
    );
  });

  test('blocks a signed-in member without audit log permission', async ({ api, account }) => {
    // A member whose role grants no `audit_log.read`: a billing role with a
    // single permission, invited and accepted through the real admin flows.
    const adminHeaders = { ...authHeader(account), Origin: APP_URL };
    const roleRes = await api.post('/api/v1/admin/roles', {
      headers: adminHeaders,
      data: {
        name: `Audit Restricted ${Date.now()}`,
        description: 'Billing only - no audit log access',
        permissionCodes: ['invoice.read'],
      },
    });
    expect(roleRes.status(), `role create failed: ${await roleRes.text()}`).toBe(201);
    const role = (await roleRes.json()) as { id: string };

    const email = `restricted-${Date.now()}@e2e.agencyos.invalid`;
    const password = `Restricted!${Date.now()}Aa1`;
    const inviteRes = await api.post('/api/v1/admin/invitations', {
      headers: adminHeaders,
      data: { email, roleId: role.id },
    });
    expect(inviteRes.status(), `invite failed: ${await inviteRes.text()}`).toBe(201);
    const invitation = (await inviteRes.json()) as { token: string };

    // The member signs up, signs in and accepts, in a context of their own.
    const memberApi = await playwrightRequest.newContext({ baseURL: APP_URL });
    const signUp = await memberApi.post('/api/auth/sign-up/email', {
      headers: { Origin: APP_URL },
      data: { email, password, name: 'Restricted User' },
    });
    expect(signUp.status(), `sign-up failed: ${await signUp.text()}`).toBe(200);
    const signIn = await memberApi.post('/api/auth/sign-in/email', {
      headers: { Origin: APP_URL },
      data: { email, password },
    });
    expect(signIn.status(), `sign-in failed: ${await signIn.text()}`).toBe(200);
    const accept = await memberApi.post('/api/v1/invitations/accept', {
      headers: { Origin: APP_URL },
      data: { token: invitation.token },
    });
    expect(accept.status(), `accept failed: ${await accept.text()}`).toBe(200);

    // API result: the audit endpoint refuses to return records at all.
    const apiRes = await memberApi.get('/api/v1/admin/audit-logs?page=1');
    const apiBody = await apiRes.text();
    expect(apiRes.status(), 'the audit API must forbid a member without audit_log.read').toBe(403);
    expect(apiBody).not.toContain('"logs"');
    expect(apiBody).not.toContain('notification.');

    // Page result (separate from the API): the shell renders, but the audit log
    // itself is replaced by the explicit access notice and no entries leak.
    const browser = await chromium.launch();
    const memberContext = await browser.newContext({ baseURL: APP_URL });
    await memberContext.request.post('/api/auth/sign-in/email', {
      headers: { Origin: APP_URL },
      data: { email, password },
    });
    const page = await memberContext.newPage();
    const pageRes = await page.goto('/admin/audit-logs');
    // Next renders its own `role="alert"` route announcer, so scope to the
    // page's notice container.
    await expect(page.locator('#main-content').getByRole('alert')).toContainText(
      /do not have access/i
    );
    expect(pageRes?.status(), 'the page renders a notice rather than a server error').toBe(200);
    await expect(page.getByText('Audit Register')).toHaveCount(0);
    await expect(page.getByText(/^notification\./)).toHaveCount(0);

    await browser.close();
    await memberApi.dispose();
  });

  test('creates an invitation and shows the one-time acceptance link', async ({
    authedPage: page,
  }) => {
    const main = page.locator('#main-content');
    await page.goto('/admin/invitations');
    await expect(main.getByRole('heading', { name: 'Team Invitations', level: 1 })).toBeVisible();

    const email = `invited-${Date.now()}@e2e.agencyos.invalid`;
    const form = bentoPanel(page, 'Invite a Teammate');
    await form.locator('#bento-invite-email').fill(email);
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/admin/invitations') &&
          response.request().method() === 'POST'
      ),
      form.getByRole('button', { name: 'Generate Invitation' }).click(),
    ]);
    expect(created.status(), `invitation create failed: ${await created.text()}`).toBe(201);

    const invitationLink = main.getByTestId('invitation-link');
    await expect(invitationLink).toContainText('/invite/');
    const row = bentoPanel(page, /^Invitations Register/)
      .getByRole('button')
      .filter({ hasText: email });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('pending', { exact: true })).toBeVisible();

    // The acceptance page renders the invitation for the invited address.
    const link = (await invitationLink.innerText()).trim();
    const path = new URL(link).pathname;
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Organization invitation' })).toBeVisible();
    // The invitee address is shown as the invitation's target at least once.
    await expect(page.getByText(email).first()).toBeVisible();
  });

  test('gates administration navigation on permissions', async ({ authedPage: page }) => {
    const main = page.locator('#main-content');
    const nav = page.getByRole('complementary', { name: 'Main navigation' });
    await page.goto('/dashboard');

    // Bento moves administration out of the legacy sidebar into Settings Center.
    await nav.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      main.getByRole('heading', { name: 'Settings & Branding', level: 1 })
    ).toBeVisible();
    const settingsCenter = bentoPanel(page, 'Settings Center');
    await expect(settingsCenter.getByText('Administration', { exact: true })).toBeVisible();
    await expect(settingsCenter.getByRole('link', { name: 'Users & Invitations' })).toHaveAttribute(
      'href',
      '/admin/users'
    );
    await expect(settingsCenter.getByRole('link', { name: 'Roles & Permissions' })).toHaveAttribute(
      'href',
      '/admin/roles'
    );
    await expect(
      settingsCenter.getByRole('link', { name: 'Audit Log', exact: true })
    ).toHaveAttribute('href', '/admin/audit-logs');

    // Invitations are reached through the Users directory in the Bento shell.
    await settingsCenter.getByRole('link', { name: 'Users & Invitations' }).click();
    await expect(main.getByRole('heading', { name: 'Users & Members', level: 1 })).toBeVisible();
    await main.getByRole('link', { name: 'Manage Invitations' }).click();
    await expect(main.getByRole('heading', { name: 'Team Invitations', level: 1 })).toBeVisible();

    // Workflow access remains permission-filtered in the Automations submenu.
    await nav.getByRole('button', { name: 'Expand Automations submenu' }).click();
    const workflows = nav.getByRole('group', { name: 'Automations sub-items' });
    await expect(
      workflows.getByRole('link', { name: 'Workflow Rules', exact: true })
    ).toBeVisible();
    await workflows.getByRole('link', { name: 'Workflow Rules', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Automation Rules', level: 1 })).toBeVisible();
  });

  test('keeps the rules page reachable from the notification centre', async ({
    authedPage: page,
  }) => {
    const main = page.locator('#main-content');
    await page.goto('/automation/notifications');
    await main.getByRole('link', { name: 'Workflow Rules', exact: true }).click();
    await expect(page).toHaveURL(/\/automation\/rules$/);
    await expect(main.getByRole('heading', { name: 'Automation Rules', level: 1 })).toBeVisible();
  });
});
