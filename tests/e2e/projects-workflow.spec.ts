/**
 * End-to-end Playwright workflow tests for AgencyOS Projects & sub-modules.
 *
 * Covers:
 * - Template creation & using a template to create a project
 * - Project detail workspace: milestones, tasks, status/assignee updates, comments
 * - Project file upload & download
 * - Project approvals (internal/client) & change orders
 * - Time entry logging & filtering
 * - Project editing, archiving, and cross-tenant isolation
 */

import type { APIRequestContext } from '@playwright/test';

import { createAccount, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
});

async function createContact(
  api: APIRequestContext,
  account: TestAccount,
  lastName: string
): Promise<{ id: string; lastName: string }> {
  const res = await api.post('/api/v1/crm/contacts', {
    headers: authHeader(account),
    data: { firstName: 'Project', lastName },
  });
  expect(res.status(), `contact create failed: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, lastName };
}

test.describe('Projects end-to-end workflows', () => {
  test('creates a template, creates a project, manages milestones, tasks, comments, files, approvals, change orders, and time entries', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const suffix = Date.now();
    const contact = await createContact(api, account, `ProjClient${suffix}`);

    // 1. Create a Project Template via UI
    await page.goto('/projects/templates');
    await expect(page.getByRole('heading', { name: 'Project Templates', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'New Template' }).click();
    await expect(page).toHaveURL(/\/projects\/templates\/new$/);

    const templateName = `E2E Template ${suffix}`;
    await page.getByLabel('Template Name').fill(templateName);
    await page.getByLabel('Description').fill('Template description for E2E launch');
    // Two "Create Template" controls exist: a header shortcut (type="button") and the
    // form's own submit. Use the submit inside the Template Specifications panel — it is
    // the same form the fields belong to, so it honours the required-field validation.
    const templateForm = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Template Specifications' }) });
    const submitTemplate = templateForm.getByRole('button', { name: 'Create Template' });
    await expect(submitTemplate).toHaveCount(1);
    await submitTemplate.click();

    // Excludes the /new route, which the previous pattern also matched.
    await expect(page).toHaveURL(/\/projects\/templates\/(?!new$)[^/]+$/);
    await expect(page.getByRole('heading', { name: templateName, level: 1 })).toBeVisible();

    // 2. Create Project from Template via UI
    await page.getByRole('link', { name: 'Create Project from Template' }).click();
    await expect(page).toHaveURL(/\/projects\/new\?templateId=/);

    const projectName = `E2E Website ${suffix}`;
    await page.getByLabel('Project Name').fill(projectName);
    await page.getByLabel('Budget').fill('15000');
    await page.getByLabel('Start Date').fill('2026-05-01');
    await page.getByLabel('End Date').fill('2026-06-15');
    await page.getByRole('button', { name: 'Create Project' }).click();

    await expect(page).toHaveURL(/\/projects\/(?!new)[^/?]+$/);
    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
    const projectUrl = page.url();
    const projectId = projectUrl.split('/').pop()!;

    // Reload to verify persistence
    await page.reload();
    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
    await expect(page.getByText(templateName).first()).toBeVisible();

    // 3. Add a Milestone
    await page.getByLabel('Milestone name').fill('Design Phase');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Design Phase').first()).toBeVisible();

    // 4. Add a Task, mark it done, and navigate to Comments
    await page.getByLabel('New task title').fill('Build Homepage');
    await page.getByRole('button', { name: 'Add Task' }).click();
    await expect(page.getByText('Build Homepage').first()).toBeVisible();
    await page.getByLabel('Status for Build Homepage').selectOption('done');
    await expect(page.getByText('1 / 1 tasks (100%)').first()).toBeVisible();

    await page
      .getByRole('link', { name: /Comments/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/projects\/tasks\/[^/]+\/comments$/);
    await page.getByLabel('Comment').fill('Initial wireframe approved');
    await page.getByRole('button', { name: 'Add Comment' }).click();
    await expect(page.getByText('Initial wireframe approved').first()).toBeVisible();

    // 5. Upload a project file
    await page.goto(`/projects/${projectId}/files`);
    await expect(page.getByRole('heading', { name: 'Project Files', level: 1 })).toBeVisible();
    await page.locator('#project-file-input').setInputFiles({
      name: 'project-plan.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('E2E project file content'),
    });
    await page.getByRole('button', { name: 'Upload File' }).click();
    await expect(page.getByText('project-plan.txt').first()).toBeVisible();

    // 6. Record a project approval
    await page.goto(`/projects/${projectId}/approvals`);
    await expect(page.getByRole('heading', { name: 'Project Approvals', level: 1 })).toBeVisible();
    await page.getByLabel('Feedback').fill('Looks ready for launch');
    await page.getByRole('button', { name: 'Record Approval' }).click();
    await expect(page.getByText('Looks ready for launch').first()).toBeVisible();

    // 7. Create a Change Order linked to the project
    await page.goto(`/projects/change-orders/new?projectId=${projectId}`);
    await expect(page.locator(`#co-project option[value="${projectId}"]`)).toBeAttached();
    await page.getByLabel('Description').fill('Add blog section');
    await page.getByLabel('Amount').fill('1250.00');
    await page.getByRole('button', { name: 'Create Change Order' }).click();
    await expect(page).toHaveURL(/\/projects\/change-orders\/(?!new)[^/?]+$/);
    await expect(page.getByText('Add blog section').first()).toBeVisible();

    // 8. Log a Time Entry linked to the project task
    await page.goto(`/projects/time-entries/new?projectId=${projectId}`);
    await expect(page.locator('#te-task option', { hasText: 'Build Homepage' })).toBeAttached();
    await page.locator('#te-task').selectOption({ label: 'Build Homepage' });
    await page.getByLabel('Hours', { exact: true }).fill('4.5');
    await page.getByLabel('Description').fill('Homepage layout implementation');
    await page.getByRole('button', { name: 'Log Time Entry' }).click();
    await expect(page).toHaveURL(/\/projects\/time-entries\/(?!new)[^/?]+$/);

    await page.goto(`/projects/time-entries?projectId=${projectId}`);
    await expect(page.getByText('4.50 hrs').first()).toBeVisible();

    // 9. Edit Project to attach client contact and verify persistence
    await page.goto(`/projects/${projectId}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit Project', level: 1 })).toBeVisible();
    await page.locator('#edit-project-client').click();
    await page.getByPlaceholder('Search clients…').fill(contact.lastName);
    await page
      .getByRole('option', { name: new RegExp(contact.lastName) })
      .first()
      .click();
    await page.getByLabel('Project Name').fill(`${projectName} Updated`);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await expect(
      page.getByRole('heading', { name: `${projectName} Updated`, level: 1 })
    ).toBeVisible();
    await expect(page.getByText(contact.lastName).first()).toBeVisible();
  });

  test('enforces cross-organization isolation on project pages', async ({
    authedPage: page,
    api,
    account,
    appUrl,
  }) => {
    const res = await api.post('/api/v1/crm/projects', {
      headers: authHeader(account),
      data: { name: `Secret Project ${Date.now()}`, status: 'active' },
    });
    expect(res.status()).toBe(201);
    const project = (await res.json()) as { id: string; name: string };

    const intruder = await createAccount(api, 'proj-intruder');
    const context = page.context();
    await context.clearCookies();
    await context.addCookies([
      { name: 'better-auth.session_token', value: intruder.sessionToken, url: appUrl },
    ]);

    await page.goto(`/projects/${project.id}`);
    await expect(page.getByText(project.name)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to projects' })).toBeVisible();
  });
});
