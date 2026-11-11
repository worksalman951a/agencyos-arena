/**
 * Integration: automation rules, execution, duplicate prevention and isolation.
 *
 * Drives the real HTTP endpoints against PostgreSQL. Accounts are provisioned
 * through `batch4-provisioning` (Better Auth rate-limits sign-up); every request
 * under test still goes over HTTP with a real database session.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  type TestAccount,
} from './batch4-provisioning';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const createdOrganizations: string[] = [];

async function jsonFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${process.env.TEST_SERVER_URL ?? 'http://localhost:3001'}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describeIfDb('automation workflows (integration)', () => {
  let account: TestAccount;

  beforeAll(async () => {
    account = await createBootstrappedAccount('automation-rules');
    createdOrganizations.push(account.organizationId);
  });

  afterAll(async () => {
    // Only the organizations this file created are removed.
    await cleanupOrganizations(createdOrganizations);
  });

  it('creates a validated rule, lists it and audits the change', async () => {
    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Log new opportunities',
        trigger: 'record.created',
        conditions: { mode: 'all', all: [{ field: 'status', operator: 'eq', value: 'open' }] },
        actions: { list: [{ type: 'log', message: 'opportunity created' }] },
        enabled: true,
      }),
    });

    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const rule = create.body as { id: string; trigger: string; enabled: boolean };
    expect(rule.trigger).toBe('record.created');
    expect(rule.enabled).toBe(true);

    const list = await jsonFetch('/api/v1/automation/workflows', {
      headers: authHeaders(account.token),
    });
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: string }>).some((r) => r.id === rule.id)).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: account.organizationId,
        action: 'workflow.create',
        entityId: rule.id,
      },
    });
    expect(audit).toBeTruthy();
    expect(audit!.actorId).toBe(account.userId);
  });

  it('honors workflow activation and deactivation around real CRM writes', async () => {
    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: `Activation lifecycle ${Date.now()}`,
        trigger: 'record.created',
        conditions: {},
        actions: { list: [{ type: 'log', message: 'lead created' }] },
        enabled: false,
      }),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const ruleId = (create.body as { id: string }).id;

    const makeLead = (label: string) =>
      jsonFetch('/api/v1/crm/leads', {
        method: 'POST',
        headers: authHeaders(account.token),
        body: JSON.stringify({ source: label, status: 'new', priority: 'medium' }),
      });

    const whileDisabled = await makeLead('phase4-disabled');
    expect(whileDisabled.status, JSON.stringify(whileDisabled.body)).toBe(201);

    const disabledHistory = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(disabledHistory.body).toEqual([]);

    const activate = await jsonFetch(`/api/v1/automation/workflows/${ruleId}`, {
      method: 'PATCH',
      headers: authHeaders(account.token),
      body: JSON.stringify({ enabled: true }),
    });
    expect(activate.status).toBe(200);

    const whileEnabled = await makeLead('phase4-enabled');
    expect(whileEnabled.status, JSON.stringify(whileEnabled.body)).toBe(201);
    const enabledHistory = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(enabledHistory.status).toBe(200);
    expect(enabledHistory.body).toHaveLength(1);

    const deactivate = await jsonFetch(`/api/v1/automation/workflows/${ruleId}`, {
      method: 'PATCH',
      headers: authHeaders(account.token),
      body: JSON.stringify({ enabled: false }),
    });
    expect(deactivate.status).toBe(200);

    const afterDeactivation = await makeLead('phase4-deactivated');
    expect(afterDeactivation.status, JSON.stringify(afterDeactivation.body)).toBe(201);
    const finalHistory = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(finalHistory.body).toHaveLength(1);
  });

  it('emits a record.updated event for a real Lead write without a status transition', async () => {
    const createRule = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: `Lead update event ${Date.now()}`,
        trigger: 'record.updated',
        conditions: {
          mode: 'all',
          all: [{ field: 'source', operator: 'eq', value: 'updated-source' }],
        },
        actions: { list: [{ type: 'log', message: 'lead updated' }] },
      }),
    });
    expect(createRule.status, JSON.stringify(createRule.body)).toBe(201);
    const ruleId = (createRule.body as { id: string }).id;

    const leadResponse = await jsonFetch('/api/v1/crm/leads', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({ source: 'initial-source', status: 'new', priority: 'medium' }),
    });
    expect(leadResponse.status, JSON.stringify(leadResponse.body)).toBe(201);
    const leadId = (leadResponse.body as { id: string }).id;

    expect(await prisma.workflowExecution.count({ where: { ruleId } })).toBe(0);
    const update = await jsonFetch(`/api/v1/crm/leads/${leadId}`, {
      method: 'PUT',
      headers: authHeaders(account.token),
      body: JSON.stringify({ source: 'updated-source' }),
    });
    expect(update.status, JSON.stringify(update.body)).toBe(200);

    const history = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject([
      {
        recordType: 'Lead',
        recordId: leadId,
        status: 'succeeded',
        resultLog: { eventType: 'record.updated' },
      },
    ]);
  });

  it('runs conditions and a task status action from a trusted Projects producer', async () => {
    const createRule = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: `Task status automation ${Date.now()}`,
        trigger: 'record.status_changed',
        conditions: {
          mode: 'all',
          all: [{ field: 'status', operator: 'eq', value: 'in-progress' }],
        },
        actions: { list: [{ type: 'set_status', status: 'done' }] },
      }),
    });
    expect(createRule.status, JSON.stringify(createRule.body)).toBe(201);
    const ruleId = (createRule.body as { id: string }).id;

    const projectResponse = await jsonFetch('/api/v1/crm/projects', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({ name: `Automation project ${Date.now()}` }),
    });
    expect(projectResponse.status, JSON.stringify(projectResponse.body)).toBe(201);
    const projectId = (projectResponse.body as { id: string }).id;

    const taskResponse = await jsonFetch(`/api/v1/crm/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({ title: 'Automation task' }),
    });
    expect(taskResponse.status, JSON.stringify(taskResponse.body)).toBe(201);
    const taskId = (taskResponse.body as { id: string }).id;

    const update = await jsonFetch(`/api/v1/projects/tasks/${taskId}`, {
      method: 'PUT',
      headers: authHeaders(account.token),
      body: JSON.stringify({ status: 'in-progress' }),
    });
    expect(update.status, JSON.stringify(update.body)).toBe(200);

    const reloadedTask = await prisma.task.findFirst({
      where: { id: taskId, organizationId: account.organizationId },
    });
    expect(reloadedTask?.status).toBe('done');

    const history = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject([
      {
        recordType: 'Task',
        recordId: taskId,
        status: 'succeeded',
        resultLog: { actions: [{ type: 'set_status', status: 'ok' }] },
      },
    ]);

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: account.organizationId,
        action: 'workflow.set_status',
        entityId: taskId,
      },
    });
    expect(audit?.actorId).toBe(account.userId);
  });

  it('runs an in-app notification action for a Finance invoice event', async () => {
    const createRule = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: `Invoice notification ${Date.now()}`,
        trigger: 'record.created',
        conditions: { mode: 'all', all: [{ field: 'status', operator: 'eq', value: 'draft' }] },
        actions: {
          list: [
            {
              type: 'notify_user',
              userId: account.userId,
              title: 'Invoice created',
              message: 'Review the draft.',
            },
          ],
        },
      }),
    });
    expect(createRule.status, JSON.stringify(createRule.body)).toBe(201);
    const ruleId = (createRule.body as { id: string }).id;

    const invoiceResponse = await jsonFetch('/api/v1/crm/invoices', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        title: `Workflow invoice ${Date.now()}`,
        lineItems: [{ description: 'Work', quantity: '1', unitPrice: '125.00', taxRate: '0' }],
      }),
    });
    expect(invoiceResponse.status, JSON.stringify(invoiceResponse.body)).toBe(201);
    const invoiceId = (invoiceResponse.body as { id: string }).id;

    const history = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject([
      {
        recordType: 'Invoice',
        recordId: invoiceId,
        status: 'succeeded',
        resultLog: { actions: [{ type: 'notify_user', status: 'ok' }] },
      },
    ]);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: account.organizationId, userId: account.userId, type: 'workflow' },
    });
    expect(
      notifications.some(
        (notification: { payload: { recordId?: string } }) =>
          notification.payload?.recordId === invoiceId
      )
    ).toBe(true);
  });

  it('runs a Sales proposal trigger and keeps its execution history rule-scoped', async () => {
    const createRule = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: `Proposal creation ${Date.now()}`,
        trigger: 'record.created',
        conditions: {
          mode: 'all',
          all: [{ field: 'title', operator: 'contains', value: 'Phase 4' }],
        },
        actions: { list: [{ type: 'log', message: 'proposal entered workflow' }] },
      }),
    });
    expect(createRule.status, JSON.stringify(createRule.body)).toBe(201);
    const ruleId = (createRule.body as { id: string }).id;

    const proposalResponse = await jsonFetch('/api/v1/crm/proposals', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        title: `Phase 4 proposal ${Date.now()}`,
        lineItems: [{ description: 'Design', quantity: '1', unitPrice: '200.00', taxRate: '0' }],
      }),
    });
    expect(proposalResponse.status, JSON.stringify(proposalResponse.body)).toBe(201);
    const proposalId = (proposalResponse.body as { id: string }).id;

    const history = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject([
      { recordType: 'Proposal', recordId: proposalId, status: 'succeeded' },
    ]);
  });

  it('records authorization failures and retries atomically with current record permission', async () => {
    const createRule = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: `Retry with record permissions ${Date.now()}`,
        trigger: 'record.created',
        conditions: {},
        actions: { list: [{ type: 'set_status', status: 'qualified' }] },
      }),
    });
    expect(createRule.status, JSON.stringify(createRule.body)).toBe(201);
    const ruleId = (createRule.body as { id: string }).id;

    const member = await createMemberWithPermissions(
      account.organizationId,
      'lead-create-no-update',
      ['lead.create']
    );

    const leadResponse = await jsonFetch('/api/v1/crm/leads', {
      method: 'POST',
      headers: authHeaders(member.token),
      body: JSON.stringify({ source: 'workflow-retry-test', status: 'new', priority: 'medium' }),
    });
    expect(leadResponse.status, JSON.stringify(leadResponse.body)).toBe(201);
    const leadId = (leadResponse.body as { id: string }).id;

    const failedHistory = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(failedHistory.status).toBe(200);
    expect(failedHistory.body).toMatchObject([
      {
        recordType: 'Lead',
        recordId: leadId,
        status: 'failed',
        attempts: 1,
        resultLog: { actions: [{ type: 'set_status', status: 'failed' }] },
      },
    ]);
    const executionId = (failedHistory.body as Array<{ id: string }>)[0]!.id;

    const retryUnauthorized = await createMemberWithPermissions(
      account.organizationId,
      'workflow-retry-no-execute',
      ['lead.update']
    );
    const deniedRetry = await jsonFetch(`/api/v1/automation/executions/${executionId}/retry`, {
      method: 'POST',
      headers: authHeaders(retryUnauthorized.token),
    });
    expect(deniedRetry.status).toBe(403);

    const retryWithoutRecordRead = await createMemberWithPermissions(
      account.organizationId,
      'workflow-retry-no-source-read',
      ['workflow.execute']
    );
    const deniedRecordRead = await jsonFetch(`/api/v1/automation/executions/${executionId}/retry`, {
      method: 'POST',
      headers: authHeaders(retryWithoutRecordRead.token),
    });
    expect(deniedRecordRead.status).toBe(403);

    const retry = await jsonFetch(`/api/v1/automation/executions/${executionId}/retry`, {
      method: 'POST',
      headers: authHeaders(account.token),
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body).toMatchObject({ status: 'succeeded', attempts: 2 });

    const updatedLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: account.organizationId },
    });
    expect(updatedLead?.status).toBe('qualified');
    const retryAudit = await prisma.auditLog.findFirst({
      where: {
        organizationId: account.organizationId,
        action: 'workflow.retry',
        entityId: executionId,
      },
    });
    expect(retryAudit?.actorId).toBe(account.userId);
  });

  it('rejects unsupported actions and unknown triggers with 400', async () => {
    const unsupported = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Email action',
        trigger: 'record.created',
        actions: { list: [{ type: 'send_email', to: 'x@example.test' }] },
      }),
    });
    expect(unsupported.status).toBe(400);

    const badTrigger = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Unknown trigger',
        trigger: 'record.exploded',
        actions: { list: [{ type: 'log', message: 'x' }] },
      }),
    });
    expect(badTrigger.status).toBe(400);
  });

  it('rejects a duplicate rule name in the same organization', async () => {
    const payload = {
      name: 'Duplicate name rule',
      trigger: 'record.created',
      actions: { list: [{ type: 'log', message: 'x' }] },
    };
    const first = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);

    const second = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(400);
  });

  it('keeps the caller-supplied event HTTP route disabled after adding trusted producers', async () => {
    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Must not run from HTTP',
        trigger: 'record.created',
        conditions: {},
        actions: { list: [{ type: 'log', message: 'must not run' }] },
      }),
    });
    expect(create.status).toBe(201);
    const ruleId = (create.body as { id: string }).id;

    const dispatch = await jsonFetch('/api/v1/automation/events', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        type: 'record.created',
        recordType: 'Task',
        recordId: `forged-task-${Date.now()}`,
        record: { ownerId: account.userId, status: 'open' },
      }),
    });

    expect(dispatch.status).toBe(410);
    expect(await prisma.workflowExecution.count({ where: { ruleId } })).toBe(0);
  });

  it('scopes execution history to the requested rule', async () => {
    const other = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'History isolation rule',
        trigger: 'record.created',
        conditions: {},
        actions: { list: [{ type: 'log', message: 'x' }] },
      }),
    });
    const ruleId = (other.body as { id: string }).id;

    const history = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(history.status).toBe(200);
    // Previously this endpoint ignored the rule id and returned every execution.
    expect(history.body).toEqual([]);
  });

  it('deletes a rule together with its execution history', async () => {
    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Delete with history',
        trigger: 'record.created',
        actions: { list: [{ type: 'log', message: 'x' }] },
      }),
    });
    expect(create.status).toBe(201);
    const ruleId = (create.body as { id: string }).id;

    await prisma.workflowExecution.create({
      data: {
        organizationId: account.organizationId,
        ruleId,
        recordType: 'Task',
        recordId: `task-${Date.now()}`,
        status: 'succeeded',
        resultLog: { eventType: 'record.created' },
      },
    });
    expect(await prisma.workflowExecution.count({ where: { ruleId } })).toBe(1);

    const remove = await jsonFetch(`/api/v1/automation/workflows/${ruleId}`, {
      method: 'DELETE',
      headers: authHeaders(account.token),
    });
    expect(remove.status).toBe(200);
    expect(await prisma.workflowExecution.count({ where: { ruleId } })).toBe(0);
  });

  it('enforces permissions: a member without workflow permissions gets 403', async () => {
    const member = await createMemberWithPermissions(account.organizationId, 'no-workflow', [
      'project.read',
    ]);
    createdOrganizations.push(member.organizationId);

    const list = await jsonFetch('/api/v1/automation/workflows', {
      headers: authHeaders(member.token),
    });
    expect(list.status).toBe(403);

    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(member.token),
      body: JSON.stringify({
        name: 'Nope',
        trigger: 'record.created',
        actions: { list: [{ type: 'log', message: 'x' }] },
      }),
    });
    expect(create.status).toBe(403);
  });

  it('never exposes another organization’s rules', async () => {
    const other = await createBootstrappedAccount('automation-other-org');
    createdOrganizations.push(other.organizationId);

    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(other.token),
      body: JSON.stringify({
        name: 'Other org rule',
        trigger: 'record.created',
        actions: { list: [{ type: 'log', message: 'x' }] },
      }),
    });
    expect(create.status).toBe(201);
    const foreignRuleId = (create.body as { id: string }).id;

    const list = await jsonFetch('/api/v1/automation/workflows', {
      headers: authHeaders(account.token),
    });
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: string }>).some((r) => r.id === foreignRuleId)).toBe(false);

    // Reading it directly is a 404, not another tenant's data.
    const direct = await jsonFetch(`/api/v1/automation/workflows/${foreignRuleId}`, {
      headers: authHeaders(account.token),
    });
    expect(direct.status).toBe(404);

    const patch = await jsonFetch(`/api/v1/automation/workflows/${foreignRuleId}`, {
      method: 'PATCH',
      headers: authHeaders(account.token),
      body: JSON.stringify({ enabled: false }),
    });
    expect(patch.status).toBe(404);
  });

  it('does not expose a cross-organization record through a trusted CRM update path', async () => {
    const other = await createBootstrappedAccount('automation-cross-org-write');
    createdOrganizations.push(other.organizationId);

    // A task owned by the other organization (Task requires a project).
    const foreignProject = await prisma.project.create({
      data: { organizationId: other.organizationId, name: 'Foreign project' },
    });
    const foreignTask = await prisma.task.create({
      data: {
        organizationId: other.organizationId,
        projectId: foreignProject.id,
        title: 'Foreign task',
        status: 'todo',
      },
    });

    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Cross-org set_status',
        trigger: 'record.status_changed',
        conditions: {},
        actions: { list: [{ type: 'set_status', status: 'done' }] },
      }),
    });
    expect(create.status).toBe(201);
    const ruleId = (create.body as { id: string }).id;

    // The business service's organization-scoped lookup rejects this before
    // it can emit a trusted event for the foreign record.
    const attemptedUpdate = await jsonFetch(`/api/v1/projects/tasks/${foreignTask.id}`, {
      method: 'PUT',
      headers: authHeaders(account.token),
      body: JSON.stringify({ status: 'in-progress' }),
    });
    expect(attemptedUpdate.status).toBe(404);
    expect(await prisma.workflowExecution.count({ where: { ruleId } })).toBe(0);

    const reloaded = await prisma.task.findUnique({ where: { id: foreignTask.id } });
    expect(reloaded?.status).toBe('todo');

    await prisma.task.deleteMany({ where: { id: foreignTask.id } });
    await prisma.project.deleteMany({ where: { id: foreignProject.id } });
  });

  it('requires an authenticated session for every automation endpoint', async () => {
    const paths = [
      '/api/v1/automation/workflows',
      '/api/v1/automation/notifications',
      '/api/v1/automation/notifications/unread-count',
      '/api/v1/automation/preferences',
    ];
    for (const path of paths) {
      const res = await jsonFetch(path, { headers: { Accept: 'application/json' } });
      expect(res.status, `${path} should require auth`).toBe(401);
    }
  });
});
