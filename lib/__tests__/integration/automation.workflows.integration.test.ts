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

  it('executes a matching rule once per record even when the event is dispatched twice', async () => {
    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Notify on created',
        trigger: 'record.created',
        conditions: {},
        actions: { list: [{ type: 'notify_user', userId: '$.ownerId', title: 'New record' }] },
      }),
    });
    expect(create.status).toBe(201);
    const ruleId = (create.body as { id: string }).id;

    const event = {
      type: 'record.created',
      recordType: 'Task',
      recordId: `task-${Date.now()}`,
      record: { ownerId: account.userId, status: 'open' },
    };

    const first = await jsonFetch('/api/v1/automation/events', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify(event),
    });
    expect(first.status).toBe(200);
    const firstBody = first.body as {
      matched: number;
      executed: number;
      executions: Array<{ status: string; ruleId: string }>;
    };
    const executedForRule = firstBody.executions.filter((e) => e.ruleId === ruleId);
    expect(executedForRule).toHaveLength(1);
    expect(executedForRule[0].status).toBe('succeeded');

    // Same event again: the dedupe key makes it a no-op for this rule.
    const second = await jsonFetch('/api/v1/automation/events', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify(event),
    });
    expect(second.status).toBe(200);
    const secondBody = second.body as { executions: Array<{ ruleId: string }> };
    expect(secondBody.executions.filter((e) => e.ruleId === ruleId)).toHaveLength(0);

    const executions = await prisma.workflowExecution.count({ where: { ruleId } });
    expect(executions).toBe(1);

    // The notification was created exactly once as well.
    const notifications = await prisma.notification.count({
      where: { organizationId: account.organizationId, userId: account.userId, type: 'workflow' },
    });
    expect(notifications).toBe(1);

    const history = await jsonFetch(`/api/v1/automation/workflows/${ruleId}/executions`, {
      headers: authHeaders(account.token),
    });
    expect(history.status).toBe(200);
    expect((history.body as unknown[]).length).toBe(1);
  });

  it('does not execute disabled rules', async () => {
    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Disabled rule',
        trigger: 'record.updated',
        conditions: {},
        actions: { list: [{ type: 'log', message: 'never' }] },
        enabled: true,
      }),
    });
    const ruleId = (create.body as { id: string }).id;

    const disable = await jsonFetch(`/api/v1/automation/workflows/${ruleId}`, {
      method: 'PATCH',
      headers: authHeaders(account.token),
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);

    const dispatch = await jsonFetch('/api/v1/automation/events', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        type: 'record.updated',
        recordType: 'Task',
        recordId: `task-${Date.now()}`,
        record: {},
      }),
    });
    expect(dispatch.status).toBe(200);
    const body = dispatch.body as { executions: Array<{ ruleId: string }> };
    expect(body.executions.filter((e) => e.ruleId === ruleId)).toHaveLength(0);
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
        conditions: {},
        actions: { list: [{ type: 'log', message: 'x' }] },
      }),
    });
    const ruleId = (create.body as { id: string }).id;

    await jsonFetch('/api/v1/automation/events', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        type: 'record.created',
        recordType: 'Task',
        recordId: `task-${Date.now()}`,
        record: {},
      }),
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

  it('never writes a record that belongs to another organization', async () => {
    const other = await createBootstrappedAccount('automation-cross-org-write');
    createdOrganizations.push(other.organizationId);

    // A task owned by the *other* organization (Task requires a project).
    const foreignProject = await prisma.project.create({
      data: { organizationId: other.organizationId, name: 'Foreign project' },
    });
    const foreignTask = await prisma.task.create({
      data: {
        organizationId: other.organizationId,
        projectId: foreignProject.id,
        title: 'Foreign task',
        status: 'open',
      },
    });

    const create = await jsonFetch('/api/v1/automation/workflows', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: 'Cross-org set_status',
        trigger: 'record.created',
        conditions: {},
        actions: { list: [{ type: 'set_status', status: 'closed' }] },
      }),
    });
    expect(create.status).toBe(201);

    // Dispatch an event in *this* organization that names the foreign record id.
    const dispatch = await jsonFetch('/api/v1/automation/events', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        type: 'record.created',
        recordType: 'Task',
        recordId: foreignTask.id,
        record: {},
      }),
    });
    expect(dispatch.status).toBe(200);

    // The action must be skipped, and the foreign row untouched.
    const executions = (
      dispatch.body as {
        executions: Array<{ resultLog?: { actions?: Array<{ status: string }> } }>;
      }
    ).executions;
    const statuses = executions.flatMap((e) => e.resultLog?.actions ?? []).map((a) => a.status);
    expect(statuses).toContain('skipped');

    const reloaded = await prisma.task.findUnique({ where: { id: foreignTask.id } });
    expect(reloaded?.status).toBe('open');

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
