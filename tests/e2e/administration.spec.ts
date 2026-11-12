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

/** Open the rule form, fill it, submit it and wait for the row to appear. */
async function createRuleThroughUi(page: Page, name: string) {
  await page.goto('/automation/rules');
  await expect(page.getByRole('heading', { name: 'Workflow Rules', level: 1 })).toBeVisible();

  const form = page.getByTestId('new-rule-form');
  await form.locator('#name').fill(name);
  await form.locator('#trigger').selectOption('record.created');
  await form.locator('#conditionField').fill('status');
  await form.locator('#conditionOperator').selectOption('eq');
  await form.locator('#conditionValue').fill('open');
  await form.locator('#actionType').selectOption('log');
  await form.locator('#actionMessage').fill('created via e2e');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/automation/workflows') &&
        response.request().method() === 'POST'
    ),
    form.getByRole('button', { name: 'Create rule' }).click(),
  ]);

  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
}

test.describe('notifications', () => {
  test('renders an explicit empty state with no notifications', async ({ authedPage: page }) => {
    await page.goto('/automation/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expect(page.getByText('No notifications found.')).toBeVisible();
    await expect(page.getByTestId('unread-count')).toContainText('0 unread of 0');
    // The bulk action is disabled when there is nothing to mark.
    await expect(page.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  test('honours notification preferences: a muted type is never delivered', async ({
    authedPage: page,
    api,
    account,
  }) => {
    await page.goto('/automation/preferences');
    await expect(
      page.getByRole('heading', { name: 'Notification Preferences', level: 1 })
    ).toBeVisible();

    await page.getByLabel('Mute workflow automation notifications').check();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/automation/preferences') &&
          response.request().method() === 'PUT'
      ),
      page.getByRole('button', { name: 'Save preferences' }).click(),
    ]);

    // The preference is persisted for the next request.
    await page.reload();
    await expect(page.getByLabel('Mute workflow automation notifications')).toBeChecked();

    const userId = await currentUserId(api, account);
    const res = await api.post('/api/v1/automation/notifications', {
      headers: authHeader(account),
      data: { userId, type: 'workflow', channel: 'in_app' },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()) as { skipped?: boolean }).toMatchObject({ skipped: true });

    await page.goto('/automation/notifications');
    await expect(page.getByText('No notifications found.')).toBeVisible();
  });

  test('shows a created notification as unread, marks it read and persists', async ({
    authedPage: page,
    api,
    account,
  }) => {
    await createNotification(api, account, {
      type: 'e2e_notice',
      payload: { title: 'Review the proposal' },
    });

    await page.goto('/automation/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expect(page.getByTestId('unread-count')).toContainText('1 unread of 1');
    await expect(page.getByRole('cell', { name: 'Unread' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Mark Read' }).click();
    await expect(page.getByRole('cell', { name: 'Read' })).toHaveCount(1);
    await expect(page.getByTestId('unread-count')).toContainText('0 unread of 1');

    // Persistence: the read state is in the database, not component state.
    await page.reload();
    await expect(page.getByRole('cell', { name: 'Read' })).toHaveCount(1);
    await expect(page.getByTestId('unread-count')).toContainText('0 unread of 1');
  });
});

test.describe('workflow rules', () => {
  test('creates a rule through the form, shows it in the list and disables it', async ({
    authedPage: page,
  }) => {
    const name = `E2E rule ${Date.now()}`;
    await createRuleThroughUi(page, name);

    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row.getByText('record.created')).toBeVisible();
    await expect(row.getByText('Enabled')).toBeVisible();

    await row.getByRole('button', { name: 'Disable' }).click();
    await expect(row.getByText('Disabled')).toBeVisible();

    // Persistence across a reload.
    await page.reload();
    await expect(
      page.getByRole('row', { name: new RegExp(name) }).getByText('Disabled')
    ).toBeVisible();
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

    await page.goto(`/automation/rules/${rule!.id}`);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Execution history')).toBeVisible();
    await expect(page.getByText('No executions yet.', { exact: false })).toBeVisible();
  });

  test('keeps caller-supplied event dispatch disabled after internal producers are wired', async ({
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
    expect(first.status()).toBe(410);

    // Replays are also rejected; nothing is recorded from the caller payload.
    const second = await api.post('/api/v1/automation/events', {
      headers: authHeader(account),
      data: event,
    });
    expect(second.status()).toBe(410);

    await page.goto(`/automation/rules/${rule.id}`);
    await expect(page.getByText('No executions yet.', { exact: false })).toBeVisible();
  });
});

test.describe('administration', () => {
  test('lists members, opens a member and shows the audit trail', async ({
    authedPage: page,
    account,
  }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await expect(page.getByRole('cell', { name: account.email })).toBeVisible();

    await page
      .getByRole('row', { name: new RegExp(account.email) })
      .getByRole('link', { name: 'Edit' })
      .click();
    await expect(page.getByRole('heading', { name: 'Edit Member', level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByText(account.email)).toBeVisible();
    // The role selector is populated from the organization's real roles.
    await expect(page.locator('#roleId')).toContainText('Administrator');

    await page.goto('/admin/audit-logs');
    await expect(page.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible();
    await expect(page.getByTestId('audit-total')).toContainText('entr');
  });

  test('filters the audit log by action', async ({ authedPage: page, api, account }) => {
    // Produce a known audit entry.
    await createNotification(api, account, { type: 'audit_probe' });

    await page.goto('/admin/audit-logs?action=notification.');
    await expect(page.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'notification.create' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Audit Log' })).toHaveCount(0);

    // A filter that matches nothing reports an explicit empty state.
    await page.goto('/admin/audit-logs?action=does.not.exist');
    await expect(page.getByText('No audit entries match these filters.')).toBeVisible();
  });

  test('creates an invitation and shows the one-time acceptance link', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/invitations');
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();

    const email = `invited-${Date.now()}@e2e.agencyos.invalid`;
    await page.locator('#email').fill(email);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/admin/invitations') &&
          response.request().method() === 'POST'
      ),
      page.getByRole('button', { name: 'Create invitation' }).click(),
    ]);

    await expect(page.getByTestId('invitation-link')).toContainText('/invite/');
    await expect(page.getByRole('cell', { name: email })).toBeVisible();

    // The acceptance page renders the invitation for the invited address.
    const link = (await page.getByTestId('invitation-link').innerText()).trim();
    const path = new URL(link).pathname;
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Organization invitation' })).toBeVisible();
    // The invitee address is shown as the invitation's target at least once.
    await expect(page.getByText(email).first()).toBeVisible();
  });

  test('gates administration navigation on permissions', async ({ authedPage: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Users', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roles', exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Invitations', exact: true }).first()
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit Log', exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Workflow Rules', exact: true }).first()
    ).toBeVisible();
  });

  test('keeps the rules page reachable from the notification centre', async ({
    authedPage: page,
  }) => {
    await page.goto('/automation/notifications');
    await page.getByRole('main').getByRole('link', { name: 'Workflow Rules' }).click();
    await expect(page).toHaveURL(/\/automation\/rules$/);
    await expect(page.getByRole('heading', { name: 'Workflow Rules', level: 1 })).toBeVisible();
  });
});
