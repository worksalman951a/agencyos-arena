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

    // The template must be bound and its description inherited before submitting —
    // the description is copied from the template asynchronously once templates load.
    const templateSelect = page.getByLabel('Project Template');
    await expect(templateSelect).toHaveValue(/\S+/);
    await expect(templateSelect.locator('option:checked')).toHaveText(templateName);
    await expect(page.getByLabel('Project Description & Key Deliverables')).toHaveValue(
      'Template description for E2E launch'
    );

    // Same shape as the template form: a header shortcut (type="button") plus the
    // form's own submit. Use the native submit inside Project Parameters & Scope.
    const projectForm = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Project Parameters & Scope' }) });
    const submitProject = projectForm.getByRole('button', { name: 'Create Project' });
    await expect(submitProject).toHaveCount(1);
    await submitProject.click();

    await expect(page).toHaveURL(/\/projects\/(?!new$)[^/?]+$/);
    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();

    // Prove the URL is a real project detail route, not the creation form.
    const projectUrl = page.url();
    const projectPath = new URL(projectUrl).pathname;
    expect(projectPath, 'must not still be on the creation form').toMatch(/^\/projects\/[^/]+$/);
    expect(projectPath).not.toBe('/projects/new');
    const projectId = projectPath.split('/').pop()!;
    expect(projectId, 'the detail route must carry a project id').not.toBe('new');
    expect(projectId.length).toBeGreaterThan(10);

    // Reload to verify persistence
    await page.reload();
    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
    await expect(page.getByText('Budget Allocated')).toBeVisible();
    await expect(page.getByText('$15,000.00', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Template description for E2E launch', { exact: true })
    ).toBeVisible();

    // The template name is not rendered on the detail page, so verify the binding through
    // Edit Project — its Project Template select is the one place the selection is shown.
    await page.getByRole('link', { name: 'Edit Project' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/edit$`));

    // The select only mounts once the template list has loaded, and the option list can
    // populate before the selection is applied — so wait for the select, then assert the
    // selected option's text, not merely that the name appears among the options.
    const templateField = page.getByLabel('Project Template');
    await expect(templateField).toBeVisible({ timeout: 15000 });
    await expect(templateField).toHaveValue(/\S+/);
    await expect(templateField.locator('option:checked')).toHaveText(templateName);

    // Return to the same project detail page without saving.
    await page.goto(projectUrl);
    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(projectPath);

    // 3. Add a Milestone
    await page.getByLabel('Milestone name').fill('Design Phase');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Design Phase').first()).toBeVisible();

    // 4. Add a Task, mark it done, and navigate to Comments
    await page.getByLabel('New task title').fill('Build Homepage');
    await page.getByRole('button', { name: 'Add Task' }).click();

    // Scope to the task's own row rather than matching the title anywhere on the page.
    const taskRow = page.getByRole('row').filter({ hasText: 'Build Homepage' });
    await expect(taskRow).toHaveCount(1);
    await expect(taskRow).toBeVisible();
    await taskRow.getByLabel('Status for Build Homepage').selectOption('done');

    // The summary lives in the Bento Task Progress tile, which renders the value and the
    // note as separate spans — the legacy "N / N tasks (100%)" string no longer exists.
    const taskProgress = page.locator('section.pmx-stat').filter({ hasText: 'Task Progress' });
    await expect(taskProgress).toHaveCount(1);
    await expect(taskProgress.locator('.pmx-stat__num')).toHaveText('100%');
    await expect(taskProgress.locator('.pmx-stat__note')).toHaveText('1 of 1 tasks completed');

    // And the task itself is really marked done.
    await expect(taskRow.getByLabel('Status for Build Homepage')).toHaveValue('done');

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
