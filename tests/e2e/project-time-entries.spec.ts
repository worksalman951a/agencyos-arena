/**
 * End-to-end journey for Phase 5B-1: direct project time logging, hourly rate
 * & currency snapshotting, and project-level billable summaries.
 */

import type { APIRequestContext } from '@playwright/test';

import { APP_URL, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
  Origin: APP_URL,
});

async function createProject(
  api: APIRequestContext,
  account: TestAccount,
  data: { name: string; status?: string }
) {
  const res = await api.post('/api/v1/crm/projects', { headers: authHeader(account), data });
  expect(res.status(), `project create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

test.describe('project time entries and billing summaries', () => {
  test('logs direct project time with rate/currency, updates summary, and preserves snapshot on edit', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const suffix = Date.now();
    const project = await createProject(api, account, {
      name: `E2E Time Project ${suffix}`,
    });

    // 1. Project workspace shows + Log Time and starts at 0.0 hrs
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Log Time' })).toBeVisible();

    await page.getByRole('link', { name: '+ Log Time' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/time-entries/new\\?projectId=${project.id}$`)
    );
    await expect(page.locator('#te-project')).toHaveValue(project.id);

    // 2. Log direct project time (no task) with explicit rate & EUR currency
    await page.locator('#te-hours').fill('2.5');
    await page.locator('#te-rate').fill('120.00');
    await page.locator('#te-currency').selectOption('EUR');
    await page.getByLabel('Description').fill('Discovery call without task');
    await page.getByRole('button', { name: 'Log Time Entry' }).click();

    await expect(page).toHaveURL(/\/projects\/time-entries\/(?!new)[^/?]+$/);
    await expect(page.locator('#edit-te-project')).toHaveValue(project.id);
    await expect(page.locator('#edit-te-rate')).toHaveValue('120.00');
    await expect(page.locator('#edit-te-currency')).toHaveValue('EUR');

    // 3. Edit hours and verify rate & currency stay preserved
    await page.locator('#edit-te-hours').fill('3.5');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page).toHaveURL(/\/projects\/time-entries$/);

    // 4. Filter by project and verify summary totals & billable value
    await page.goto(`/projects/time-entries?projectId=${project.id}`);
    await expect(page.getByText('3.50 hrs').first()).toBeVisible();
    await expect(page.getByTestId('time-entries-billable-totals')).toContainText('EUR');
    await expect(page.getByTestId('time-entries-billable-totals')).toContainText('420.00');

    // 5. Project detail workspace shows aggregated hours and billable value
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByText('Time Entries (3.5 hrs)')).toBeVisible();
    await expect(page.getByTestId('project-billable-summary')).toContainText('EUR');
    await expect(page.getByTestId('project-billable-summary')).toContainText('420.00');
  });

  test('hides + Log Time on archived projects and warns on direct handoff URL', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const archived = await createProject(api, account, {
      name: `E2E Archived Time Project ${Date.now()}`,
      status: 'archived',
    });

    await page.goto(`/projects/${archived.id}`);
    await expect(page.getByRole('link', { name: '+ Log Time' })).toHaveCount(0);

    await page.goto(`/projects/time-entries/new?projectId=${archived.id}`);
    await expect(page.getByText(/archived and cannot accept new time entries/i)).toBeVisible();
    await expect(page.locator('#te-project')).toHaveValue('');
  });
});
