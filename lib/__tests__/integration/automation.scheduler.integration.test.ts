import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { recoverWorkflowExecutionsForScheduler } from '@/lib/services/automation/run-workflow-service';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  type TestAccount,
} from './batch4-provisioning';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const createdOrganizations: string[] = [];
const schedulerUrl = `${process.env.TEST_SERVER_URL ?? 'http://localhost:3001'}/api/internal/automation/scheduler`;

async function createRule(
  account: TestAccount,
  name: string,
  trigger: string,
  actions: unknown = { list: [{ type: 'log', message: `scheduled ${trigger}` }] },
  enabled = true
) {
  const response = await fetch(
    `${process.env.TEST_SERVER_URL ?? 'http://localhost:3001'}/api/v1/automation/workflows`,
    {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        name: `${name}-${randomUUID()}`,
        trigger,
        conditions: {},
        actions,
        enabled,
      }),
    }
  );
  const body = await response.json().catch(() => null);
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body as { id: string };
}

async function runScheduler(secret = process.env.WORKFLOW_SCHEDULER_SECRET ?? '') {
  return fetch(schedulerUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
}

function yesterdayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12));
}

async function createInvoice(
  organizationId: string,
  number: string,
  overrides: { status?: string; dueDate?: Date; deletedAt?: Date | null } = {}
) {
  return prisma.invoice.create({
    data: {
      organizationId,
      number,
      title: number,
      status: overrides.status ?? 'sent',
      subtotal: '125.00',
      tax: '12.50',
      total: '137.50',
      currency: 'USD',
      dueDate: overrides.dueDate ?? yesterdayUtc(),
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

describeIfDb('automation scheduler (PostgreSQL and HTTP)', () => {
  let admin: TestAccount;

  beforeAll(async () => {
    admin = await createBootstrappedAccount('workflow-scheduler');
    createdOrganizations.push(admin.organizationId);
  });

  afterAll(async () => {
    await cleanupOrganizations(createdOrganizations);
  });

  it('runs overdue task, project and invoice rules once under concurrent invocations and preserves financial state', async () => {
    const taskRule = await createRule(admin, 'Overdue tasks', 'task.overdue');
    const projectRule = await createRule(admin, 'Overdue projects', 'project.overdue');
    const invoiceRule = await createRule(admin, 'Overdue invoices', 'invoice.overdue');
    const yesterday = yesterdayUtc();

    const taskProject = await prisma.project.create({
      data: {
        organizationId: admin.organizationId,
        name: `Task parent ${randomUUID()}`,
        status: 'active',
      },
    });
    const task = await prisma.task.create({
      data: {
        organizationId: admin.organizationId,
        projectId: taskProject.id,
        title: 'Overdue task',
        status: 'todo',
        dueDate: yesterday,
      },
    });
    const overdueProject = await prisma.project.create({
      data: {
        organizationId: admin.organizationId,
        name: `Overdue project ${randomUUID()}`,
        status: 'active',
        endDate: yesterday,
      },
    });
    const invoice = await createInvoice(admin.organizationId, `WS-${randomUUID()}`);
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: '25.00',
        method: 'bank_transfer',
        paidAt: new Date(),
      },
    });
    const invoiceBefore = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { status: true, subtotal: true, tax: true, total: true, dueDate: true },
    });
    const paymentsBefore = (
      await prisma.payment.findMany({
        where: { invoiceId: invoice.id },
        select: { id: true, amount: true, paidAt: true },
      })
    ).map((payment: { id: string; amount: { toString(): string }; paidAt: Date }) => ({
      id: payment.id,
      amount: payment.amount.toString(),
      paidAt: payment.paidAt.toISOString(),
    }));

    const [first, overlapping] = await Promise.all([runScheduler(), runScheduler()]);
    expect(first.status).toBe(200);
    expect(overlapping.status).toBe(200);
    const third = await runScheduler();
    expect(third.status).toBe(200);
    for (const response of [first, overlapping, third]) {
      expect(await response.json()).toMatchObject({ status: 'completed', failed: 0 });
    }

    for (const [rule, recordType, recordId] of [
      [taskRule, 'Task', task.id],
      [projectRule, 'Project', overdueProject.id],
      [invoiceRule, 'Invoice', invoice.id],
    ] as const) {
      expect(
        await prisma.workflowExecution.count({
          where: { ruleId: rule.id, organizationId: admin.organizationId, recordType, recordId },
        })
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: admin.organizationId,
            action: 'workflow.scheduled_execution',
            entityType: 'WorkflowExecution',
          },
        })
      ).toBeGreaterThanOrEqual(1);
    }

    expect(
      await prisma.workflowExecution.count({
        where: { ruleId: taskRule.id, recordType: 'Task', recordId: task.id, status: 'succeeded' },
      })
    ).toBe(1);
    expect(
      await prisma.workflowExecution.count({
        where: {
          ruleId: projectRule.id,
          recordType: 'Project',
          recordId: overdueProject.id,
          status: 'succeeded',
        },
      })
    ).toBe(1);
    expect(
      await prisma.workflowExecution.count({
        where: {
          ruleId: invoiceRule.id,
          recordType: 'Invoice',
          recordId: invoice.id,
          status: 'succeeded',
        },
      })
    ).toBe(1);
    expect(
      await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { status: true, subtotal: true, tax: true, total: true, dueDate: true },
      })
    ).toEqual({ ...invoiceBefore, status: 'overdue' });
    expect(
      (
        await prisma.payment.findMany({
          where: { invoiceId: invoice.id },
          select: { id: true, amount: true, paidAt: true },
        })
      ).map((payment: { id: string; amount: { toString(): string }; paidAt: Date }) => ({
        id: payment.id,
        amount: payment.amount.toString(),
        paidAt: payment.paidAt.toISOString(),
      }))
    ).toEqual(paymentsBefore);
    expect(
      await prisma.project.findUniqueOrThrow({
        where: { id: overdueProject.id },
        select: { status: true },
      })
    ).toEqual({ status: 'active' });
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: admin.organizationId,
          action: 'invoice.mark_overdue',
          entityType: 'Invoice',
          entityId: invoice.id,
        },
      })
    ).toBe(1);
  });

  it('ignores disabled and deleted rules and denies scheduled rules to creators without execute permission', async () => {
    const disabledRule = await createRule(
      admin,
      'Disabled overdue',
      'task.overdue',
      undefined,
      false
    );
    const deletedRule = await createRule(admin, 'Deleted overdue', 'task.overdue');
    const response = await fetch(
      `${process.env.TEST_SERVER_URL ?? 'http://localhost:3001'}/api/v1/automation/workflows/${deletedRule.id}`,
      { method: 'DELETE', headers: authHeaders(admin.token) }
    );
    expect(response.status).toBe(200);

    const restricted = await createMemberWithPermissions(
      admin.organizationId,
      'scheduler-without-execute',
      ['workflow.create', 'project.read']
    );
    const forbidden = await fetch(
      `${process.env.TEST_SERVER_URL ?? 'http://localhost:3001'}/api/v1/automation/workflows`,
      {
        method: 'POST',
        headers: authHeaders(restricted.token),
        body: JSON.stringify({
          name: `Forbidden scheduled rule ${randomUUID()}`,
          trigger: 'task.overdue',
          conditions: {},
          actions: { list: [{ type: 'log', message: 'must not run' }] },
        }),
      }
    );
    expect(forbidden.status).toBe(403);

    await runScheduler();
    expect(await prisma.workflowExecution.count({ where: { ruleId: disabledRule.id } })).toBe(0);
    expect(await prisma.workflowExecution.count({ where: { ruleId: deletedRule.id } })).toBe(0);
  });

  it('isolates organizations and rejects a notification recipient from another tenant', async () => {
    const foreign = await createOrganizationWithAdmin('scheduler-foreign');
    createdOrganizations.push(foreign.organizationId);
    const foreignInvoice = await createInvoice(
      foreign.organizationId,
      `WS-FOREIGN-${randomUUID()}`
    );
    const foreignRule = await prisma.workflowRule.create({
      data: {
        organizationId: foreign.organizationId,
        createdBy: foreign.userId,
        name: `Foreign overdue ${randomUUID()}`,
        trigger: 'invoice.overdue',
        conditions: {},
        actions: { list: [{ type: 'log', message: 'tenant-specific event' }] },
        enabled: true,
      },
    });

    const localInvoice = await createInvoice(admin.organizationId, `WS-LOCAL-${randomUUID()}`);
    const localRule = await createRule(admin, 'Cross-tenant target', 'invoice.overdue', {
      list: [
        {
          type: 'notify_user',
          userId: foreign.userId,
          title: 'Must not be delivered cross-tenant',
          message: 'organization isolation regression',
        },
      ],
    });

    const result = await runScheduler();
    expect(result.status).toBe(200);
    expect(
      await prisma.workflowExecution.count({
        where: {
          organizationId: foreign.organizationId,
          ruleId: foreignRule.id,
          recordType: 'Invoice',
          recordId: foreignInvoice.id,
          status: 'succeeded',
        },
      })
    ).toBe(1);
    expect(
      await prisma.workflowExecution.count({
        where: {
          organizationId: admin.organizationId,
          ruleId: localRule.id,
          recordType: 'Invoice',
          recordId: localInvoice.id,
          status: 'succeeded',
        },
      })
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: {
          organizationId: foreign.organizationId,
          userId: foreign.userId,
          type: 'workflow',
          payload: { path: ['recordId'], equals: localInvoice.id },
        },
      })
    ).toBe(0);
  });

  it('reports partial execution failure and does not replay successful actions on the next invocation', async () => {
    const partialAdmin = await createBootstrappedAccount('workflow-scheduler-partial-failure');
    createdOrganizations.push(partialAdmin.organizationId);
    const restricted = await createMemberWithPermissions(
      partialAdmin.organizationId,
      'scheduler-partial-failure',
      ['workflow.create', 'workflow.execute', 'project.read', 'notification.update']
    );
    const project = await prisma.project.create({
      data: {
        organizationId: partialAdmin.organizationId,
        name: `Partial failure ${randomUUID()}`,
        status: 'active',
        endDate: yesterdayUtc(),
      },
    });
    const rule = await createRule(restricted, 'Partially failing overdue rule', 'project.overdue', {
      list: [
        {
          type: 'notify_user',
          userId: restricted.userId,
          title: 'Overdue project notification',
          message: 'This action should only happen once.',
        },
        { type: 'set_status', status: 'completed' },
      ],
    });

    const first = await runScheduler();
    expect(first.status).toBe(500);
    const firstResult = await first.json();
    expect(firstResult.status).toBe('completed_with_failures');
    expect(firstResult.failed).toBeGreaterThan(0);
    expect(firstResult).not.toHaveProperty('organizationId');
    expect(firstResult).not.toHaveProperty('ruleId');
    expect(firstResult).not.toHaveProperty('stack');

    const second = await runScheduler();
    expect(second.status).toBe(200);
    const secondResult = await second.json();
    expect(secondResult.status).toBe('completed');
    expect(secondResult.failed).toBe(0);

    expect(
      await prisma.workflowExecution.count({
        where: {
          organizationId: partialAdmin.organizationId,
          ruleId: rule.id,
          recordType: 'Project',
          recordId: project.id,
          status: 'quarantined',
        },
      })
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: {
          organizationId: partialAdmin.organizationId,
          userId: restricted.userId,
          type: 'workflow',
          payload: { path: ['recordId'], equals: project.id },
        },
      })
    ).toBe(1);
    expect(
      await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        select: { status: true },
      })
    ).toEqual({ status: 'active' });
  });

  it('recovers a stale execution exactly once under concurrent PostgreSQL claims', async () => {
    const rule = await createRule(admin, 'Stale recovery', 'invoice.overdue');
    const invoice = await createInvoice(admin.organizationId, `WR-${randomUUID()}`);
    const staleAt = new Date(Date.now() - 20 * 60_000);
    const execution = await prisma.workflowExecution.create({
      data: {
        organizationId: admin.organizationId,
        ruleId: rule.id,
        recordType: 'Invoice',
        recordId: invoice.id,
        status: 'running',
        dedupeKey: `recovery-${randomUUID()}`,
        attempts: 1,
        lastAttemptAt: staleAt,
        claimToken: 'expired-worker-token',
        resultLog: {
          actorId: admin.userId,
          source: 'scheduler',
          eventType: 'invoice.overdue',
          eventVersion: 'integration-stale-event',
          actionDefinitions: { list: [{ type: 'log', message: 'scheduled invoice.overdue' }] },
          actions: [],
        },
      },
    });

    await Promise.all([
      recoverWorkflowExecutionsForScheduler(new Date()),
      recoverWorkflowExecutionsForScheduler(new Date()),
    ]);
    const recovered = await prisma.workflowExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(recovered.status).toBe('succeeded');
    expect(recovered.attempts).toBe(2);
    expect(recovered.claimToken).toBeNull();
    expect(recovered.resultLog).toMatchObject({ source: 'scheduler', actions: [{ status: 'ok' }] });
  });

  it('quarantines disabled, unauthorized, and cross-tenant rule claims without executing actions', async () => {
    const disabledRule = await createRule(admin, 'Disabled recovery rule', 'invoice.overdue');
    const disabledInvoice = await createInvoice(
      admin.organizationId,
      `WR-DISABLED-${randomUUID()}`
    );
    await prisma.workflowRule.update({ where: { id: disabledRule.id }, data: { enabled: false } });

    const suspendedOwner = await createBootstrappedAccount('workflow-recovery-suspended-owner');
    createdOrganizations.push(suspendedOwner.organizationId);
    const suspendedRule = await createRule(
      suspendedOwner,
      'Suspended creator rule',
      'invoice.overdue'
    );
    const suspendedInvoice = await createInvoice(
      suspendedOwner.organizationId,
      `WR-SUSPENDED-${randomUUID()}`
    );
    await prisma.user.update({
      where: { id: suspendedOwner.userId },
      data: { status: 'suspended' },
    });
    const changedRule = await createRule(admin, 'Changed recovery rule', 'invoice.overdue');
    const changedInvoice = await createInvoice(admin.organizationId, `WR-CHANGED-${randomUUID()}`);
    await prisma.workflowRule.update({
      where: { id: changedRule.id },
      data: { actions: { list: [{ type: 'log', message: 'changed after claim' }] } },
    });

    const staleAt = new Date(Date.now() - 20 * 60_000);
    const seed = (
      organizationId: string,
      ruleId: string,
      recordId: string,
      dedupeKey: string,
      actorId: string
    ) =>
      prisma.workflowExecution.create({
        data: {
          organizationId,
          ruleId,
          recordType: 'Invoice',
          recordId,
          status: 'running',
          dedupeKey,
          attempts: 1,
          lastAttemptAt: staleAt,
          claimToken: `expired-${dedupeKey}`,
          resultLog: {
            actorId,
            source: 'scheduler',
            eventType: 'invoice.overdue',
            actionDefinitions: { list: [{ type: 'log', message: 'scheduled invoice.overdue' }] },
            actions: [],
          },
        },
      });
    const disabled = await seed(
      admin.organizationId,
      disabledRule.id,
      disabledInvoice.id,
      `disabled-${randomUUID()}`,
      admin.userId
    );
    const unauthorized = await seed(
      suspendedOwner.organizationId,
      suspendedRule.id,
      suspendedInvoice.id,
      `suspended-${randomUUID()}`,
      suspendedOwner.userId
    );
    // WorkflowExecution has separate rule/tenant foreign keys; deliberately
    // mismatch them to prove recovery never loads an execution's rule cross-tenant.
    const crossTenant = await seed(
      suspendedOwner.organizationId,
      disabledRule.id,
      suspendedInvoice.id,
      `cross-tenant-${randomUUID()}`,
      admin.userId
    );
    const changed = await seed(
      admin.organizationId,
      changedRule.id,
      changedInvoice.id,
      `changed-${randomUUID()}`,
      admin.userId
    );

    await recoverWorkflowExecutionsForScheduler(new Date());
    const recovered = await prisma.workflowExecution.findMany({
      where: { id: { in: [disabled.id, unauthorized.id, crossTenant.id, changed.id] } },
      select: { id: true, status: true, errorCategory: true },
    });
    expect(recovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: disabled.id,
          status: 'quarantined',
          errorCategory: 'rule_disabled',
        }),
        expect.objectContaining({
          id: unauthorized.id,
          status: 'quarantined',
          errorCategory: 'authorization',
        }),
        expect.objectContaining({
          id: crossTenant.id,
          status: 'quarantined',
          errorCategory: 'rule_disabled',
        }),
        expect.objectContaining({
          id: changed.id,
          status: 'quarantined',
          errorCategory: 'rule_changed',
        }),
      ])
    );
    expect(
      await prisma.invoice.findUniqueOrThrow({
        where: { id: disabledInvoice.id },
        select: { status: true },
      })
    ).toEqual({ status: 'sent' });
    expect(
      await prisma.invoice.findUniqueOrThrow({
        where: { id: suspendedInvoice.id },
        select: { status: true },
      })
    ).toEqual({ status: 'sent' });
  });

  it('terminalizes exhausted retries and quarantines invalid snapshots without changing financial data', async () => {
    const rule = await createRule(admin, 'Recovery safety states', 'invoice.overdue');
    const invoice = await createInvoice(admin.organizationId, `WR-SAFE-${randomUUID()}`);
    const financialBefore = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { status: true, subtotal: true, tax: true, total: true, dueDate: true },
    });
    const staleAt = new Date(Date.now() - 20 * 60_000);
    const terminal = await prisma.workflowExecution.create({
      data: {
        organizationId: admin.organizationId,
        ruleId: rule.id,
        recordType: 'Invoice',
        recordId: invoice.id,
        status: 'failed',
        dedupeKey: `attempt-limit-${randomUUID()}`,
        attempts: 5,
        lastAttemptAt: staleAt,
        nextAttemptAt: new Date(Date.now() - 60_000),
        resultLog: {
          actorId: admin.userId,
          source: 'scheduler',
          eventType: 'invoice.overdue',
          actionDefinitions: { list: [{ type: 'log', message: 'safe snapshot' }] },
          actions: [],
        },
      },
    });
    const deferred = await prisma.workflowExecution.create({
      data: {
        organizationId: admin.organizationId,
        ruleId: rule.id,
        recordType: 'Invoice',
        recordId: invoice.id,
        status: 'failed',
        dedupeKey: `deferred-retry-${randomUUID()}`,
        attempts: 1,
        lastAttemptAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 5 * 60_000),
        resultLog: {
          actorId: admin.userId,
          source: 'scheduler',
          eventType: 'invoice.overdue',
          actionDefinitions: { list: [{ type: 'log', message: 'scheduled invoice.overdue' }] },
          actions: [],
        },
      },
    });
    const unsafe = await prisma.workflowExecution.create({
      data: {
        organizationId: admin.organizationId,
        ruleId: rule.id,
        recordType: 'Invoice',
        recordId: invoice.id,
        status: 'running',
        dedupeKey: `unsafe-snapshot-${randomUUID()}`,
        attempts: 2,
        lastAttemptAt: staleAt,
        claimToken: 'expired-unsafe-worker',
        resultLog: {
          actorId: admin.userId,
          source: 'scheduler',
          eventType: 'invoice.overdue',
          actionDefinitions: { list: [{ type: 'future_external_action' }] },
          actions: [],
        },
      },
    });

    await recoverWorkflowExecutionsForScheduler(new Date());
    const [terminalAfter, unsafeAfter, deferredBeforeDue] = await Promise.all([
      prisma.workflowExecution.findUniqueOrThrow({ where: { id: terminal.id } }),
      prisma.workflowExecution.findUniqueOrThrow({ where: { id: unsafe.id } }),
      prisma.workflowExecution.findUniqueOrThrow({ where: { id: deferred.id } }),
    ]);
    expect(terminalAfter).toMatchObject({
      status: 'terminal_failed',
      attempts: 5,
      errorCategory: 'attempt_limit',
    });
    expect(unsafeAfter).toMatchObject({
      status: 'quarantined',
      errorCategory: 'unsafe_action',
      claimToken: null,
    });
    expect(deferredBeforeDue).toMatchObject({ status: 'failed', attempts: 1 });
    await prisma.workflowExecution.update({
      where: { id: deferred.id },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });
    await recoverWorkflowExecutionsForScheduler(new Date());
    expect(
      await prisma.workflowExecution.findUniqueOrThrow({ where: { id: deferred.id } })
    ).toMatchObject({
      status: 'succeeded',
      attempts: 2,
    });
    expect(
      await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { status: true, subtotal: true, tax: true, total: true, dueDate: true },
      })
    ).toEqual(financialBefore);
  });
});
