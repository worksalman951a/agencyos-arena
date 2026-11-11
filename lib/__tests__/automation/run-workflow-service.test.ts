import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    workflowRule: { findMany: vi.fn(), findFirst: vi.fn() },
    workflowExecution: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    lead: { findFirst: vi.fn(), updateMany: vi.fn() },
    opportunity: { findFirst: vi.fn(), updateMany: vi.fn() },
    project: { findFirst: vi.fn(), updateMany: vi.fn() },
    task: { findFirst: vi.fn(), updateMany: vi.fn() },
    estimate: { findFirst: vi.fn(), updateMany: vi.fn() },
    invoice: { findFirst: vi.fn(), updateMany: vi.fn() },
    proposal: { findFirst: vi.fn(), updateMany: vi.fn() },
    quotation: { findFirst: vi.fn(), updateMany: vi.fn() },
    user: { findFirst: vi.fn() },
    role: { findFirst: vi.fn() },
    userRole: { findMany: vi.fn() },
    notification: { findFirst: vi.fn(), create: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissions: vi.fn(),
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/services/automation/notification-service', () => ({
  isNotificationAllowed: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { getUserPermissions, requireOrganization, requirePermission } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { isNotificationAllowed } from '@/lib/services/automation/notification-service';
import {
  emitWorkflowEvent,
  emitWorkflowEvents,
  retryWorkflowExecution,
} from '@/lib/services/automation/run-workflow-service';

const mockGetPermissions = getUserPermissions as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRuleFindMany = prisma.workflowRule.findMany as unknown as ReturnType<typeof vi.fn>;
const mockRuleFindFirst = prisma.workflowRule.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockExecutionCreate = prisma.workflowExecution.create as unknown as ReturnType<typeof vi.fn>;
const mockExecutionUpdate = prisma.workflowExecution.update as unknown as ReturnType<typeof vi.fn>;
const mockExecutionUpdateMany = prisma.workflowExecution.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockExecutionFindFirst = prisma.workflowExecution.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockLeadFindFirst = prisma.lead.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockLeadUpdateMany = prisma.lead.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockTaskFindFirst = prisma.task.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockTaskUpdateMany = prisma.task.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceFindFirst = prisma.invoice.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockNotificationFindFirst = prisma.notification.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockNotificationCreate = prisma.notification.create as unknown as ReturnType<typeof vi.fn>;
const mockUserFindFirst = prisma.user.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAuditCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockNotificationAllowed = isNotificationAllowed as unknown as ReturnType<typeof vi.fn>;

const allPermissions = new Set([
  'lead.create',
  'lead.update',
  'lead.convert',
  'opportunity.create',
  'opportunity.update',
  'project.create',
  'project.update',
  'estimate.create',
  'estimate.update',
  'invoice.create',
  'invoice.update',
  'proposal.create',
  'proposal.update',
  'quotation.create',
  'quotation.update',
  'workflow.execute',
  'notification.update',
  'user.read',
]);

const currentLead = {
  id: 'lead-1',
  organizationId: 'org-1',
  source: 'website',
  status: 'new',
  priority: 'medium',
  ownerId: 'user-1',
  updatedAt: new Date('2026-11-11T10:00:00.000Z'),
};

const rule = {
  id: 'rule-1',
  trigger: 'record.created',
  conditions: {},
  actions: { list: [{ type: 'log', message: 'created' }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    session: { id: 'session-1' },
    user: { id: 'user-1', email: 'user@example.test', role: 'employee' },
  });
  mockCookies.mockResolvedValue({ toString: () => 'session=session-1' });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockGetPermissions.mockResolvedValue(allPermissions);
  mockRequirePermission.mockResolvedValue(undefined);
  mockRuleFindMany.mockResolvedValue([]);
  mockRuleFindFirst.mockResolvedValue({ ...rule, enabled: true });
  mockExecutionCreate.mockResolvedValue({ id: 'execution-1' });
  mockExecutionUpdate.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      attempts: 1,
      lastAttemptAt: new Date('2026-11-11T10:01:00.000Z'),
      createdAt: new Date('2026-11-11T10:00:00.000Z'),
      ...data,
    })
  );
  mockExecutionUpdateMany.mockResolvedValue({ count: 1 });
  mockExecutionFindFirst.mockResolvedValue({
    id: 'execution-1',
    organizationId: 'org-1',
    ruleId: 'rule-1',
    recordType: 'Lead',
    recordId: 'lead-1',
    status: 'failed',
    attempts: 1,
    lastAttemptAt: null,
    createdAt: new Date('2026-11-11T10:00:00.000Z'),
    resultLog: {
      eventType: 'record.created',
      source: 'business-service',
      eventVersion: 'original-event-version',
      actorId: 'user-1',
      actions: [{ index: 0, type: 'notify_user', status: 'failed', detail: 'temporary failure' }],
    },
  });
  mockLeadFindFirst.mockResolvedValue(currentLead);
  mockLeadUpdateMany.mockResolvedValue({ count: 1 });
  mockTaskFindFirst.mockResolvedValue({
    id: 'task-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    assigneeId: null,
    status: 'todo',
    updatedAt: new Date('2026-11-11T10:00:00.000Z'),
    project: { id: 'project-1', name: 'P', organizationId: 'org-1', deletedAt: null },
  });
  mockTaskUpdateMany.mockResolvedValue({ count: 1 });
  mockInvoiceFindFirst.mockResolvedValue({
    id: 'invoice-1',
    organizationId: 'org-1',
    status: 'sent',
    updatedAt: new Date('2026-11-11T10:00:00.000Z'),
  });
  mockUserFindFirst.mockResolvedValue({ id: 'user-1' });
  mockNotificationFindFirst.mockResolvedValue(null);
  mockNotificationCreate.mockResolvedValue({ id: 'notification-1' });
  mockAuditCreate.mockResolvedValue({ id: 'audit-1' });
  mockNotificationAllowed.mockResolvedValue(true);
  mockTransaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma)
  );
});

describe('trusted workflow event production', () => {
  it('rejects caller-provided snapshots and tenant/actor fields', async () => {
    await expect(
      emitWorkflowEvent({
        type: 'record.created',
        recordType: 'Lead',
        recordId: 'lead-1',
        record: { status: 'won', organizationId: 'other-org' },
        organizationId: 'other-org',
        actorId: 'attacker',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockLeadFindFirst).not.toHaveBeenCalled();
    expect(mockRuleFindMany).not.toHaveBeenCalled();
  });

  it('loads the event snapshot using the authenticated organization and resource permission', async () => {
    mockRuleFindMany.mockResolvedValueOnce([]);

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(mockLeadFindFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'lead-1', organizationId: 'org-1', deletedAt: null },
    });
    expect(mockGetPermissions).toHaveBeenCalledExactlyOnceWith('user-1', 'org-1');
    expect(mockRuleFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { organizationId: 'org-1', enabled: true, trigger: 'record.created' },
      orderBy: { createdAt: 'asc' },
    });
    expect(mockRequirePermission).not.toHaveBeenCalledWith('user-1', 'org-1', 'workflow.update');
    expect(result.executed).toBe(0);
  });

  it('requires the resource write permission before loading the event snapshot', async () => {
    const logFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetPermissions.mockResolvedValueOnce(new Set(['workflow.read']));

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result).toMatchObject({ matched: 0, executed: 0, failed: 1 });
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
    expect(mockRuleFindMany).not.toHaveBeenCalled();
    logFailure.mockRestore();
  });

  it('requires permission for every event in a mixed create/update batch', async () => {
    const logFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetPermissions.mockResolvedValue(new Set(['lead.create']));

    const results = await emitWorkflowEvents([
      { type: 'record.created', recordType: 'Lead', recordId: 'lead-1' },
      { type: 'record.updated', recordType: 'Lead', recordId: 'lead-1' },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.failed === 1)).toBe(true);
    expect(mockGetPermissions).toHaveBeenCalledTimes(2);
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
    expect(mockRuleFindMany).not.toHaveBeenCalled();
    logFailure.mockRestore();
  });

  it('does not dispatch a missing or cross-organization record', async () => {
    const logFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockLeadFindFirst.mockResolvedValueOnce(null);

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'foreign-lead',
    });

    expect(result).toMatchObject({ matched: 0, executed: 0, failed: 1 });
    expect(mockRuleFindMany).not.toHaveBeenCalled();
    logFailure.mockRestore();
  });

  it('does not dispatch a forged status transition that does not match the current record', async () => {
    const logFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await emitWorkflowEvent({
      type: 'record.status_changed',
      recordType: 'Lead',
      recordId: 'lead-1',
      previousStatus: 'new',
    });

    expect(result).toMatchObject({ matched: 0, executed: 0, failed: 1 });
    expect(mockRuleFindMany).not.toHaveBeenCalled();
    logFailure.mockRestore();
  });

  it('returns an observable failure instead of throwing when event snapshot loading fails', async () => {
    const logFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockLeadFindFirst.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result).toMatchObject({ matched: 0, executed: 0, failed: 1, executions: [] });
    expect(mockRuleFindMany).not.toHaveBeenCalled();
    expect(logFailure).toHaveBeenCalledOnce();
    logFailure.mockRestore();
  });

  it('logs a non-duplicate execution-claim failure instead of silently losing the event', async () => {
    const logFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRuleFindMany.mockResolvedValueOnce([rule]);
    mockExecutionCreate.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result).toMatchObject({ matched: 1, executed: 0, failed: 1 });
    expect(logFailure).toHaveBeenCalledWith(
      '[automation] could not claim workflow execution',
      expect.objectContaining({ organizationId: 'org-1', ruleId: 'rule-1', recordId: 'lead-1' })
    );
    logFailure.mockRestore();
  });

  it('builds task dedupe versions from the task row, not its mutable project relation', async () => {
    const taskSnapshot = {
      id: 'task-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      status: 'todo',
      updatedAt: new Date('2026-11-11T10:00:00.000Z'),
    };
    mockTaskFindFirst
      .mockResolvedValueOnce({
        ...taskSnapshot,
        project: {
          id: 'project-1',
          name: 'Project before',
          organizationId: 'org-1',
          deletedAt: null,
        },
      })
      .mockResolvedValueOnce({
        ...taskSnapshot,
        project: {
          id: 'project-1',
          name: 'Project after',
          organizationId: 'org-1',
          deletedAt: null,
        },
      });
    mockRuleFindMany.mockResolvedValue([rule]);

    await emitWorkflowEvent({ type: 'record.created', recordType: 'Task', recordId: 'task-1' });
    await emitWorkflowEvent({ type: 'record.created', recordType: 'Task', recordId: 'task-1' });

    const firstDedupeKey = mockExecutionCreate.mock.calls[0]?.[0]?.data.dedupeKey;
    const secondDedupeKey = mockExecutionCreate.mock.calls[1]?.[0]?.data.dedupeKey;
    expect(firstDedupeKey).toBe(secondDedupeKey);
  });

  it('keeps a record.created replay deduped after later scalar updates', async () => {
    const createdAt = new Date('2026-11-11T09:00:00.000Z');
    mockLeadFindFirst
      .mockResolvedValueOnce({ ...currentLead, createdAt, source: 'website' })
      .mockResolvedValueOnce({
        ...currentLead,
        createdAt,
        source: 'referral',
        updatedAt: new Date('2026-11-11T10:01:00.000Z'),
      });
    mockRuleFindMany.mockResolvedValue([rule]);

    await emitWorkflowEvent({ type: 'record.created', recordType: 'Lead', recordId: 'lead-1' });
    await emitWorkflowEvent({ type: 'record.created', recordType: 'Lead', recordId: 'lead-1' });

    const firstDedupeKey = mockExecutionCreate.mock.calls[0]?.[0]?.data.dedupeKey;
    const secondDedupeKey = mockExecutionCreate.mock.calls[1]?.[0]?.data.dedupeKey;
    expect(firstDedupeKey).toBe(secondDedupeKey);
  });

  it('creates distinct dedupe versions for successive scalar record updates', async () => {
    mockLeadFindFirst
      .mockResolvedValueOnce({ ...currentLead, source: 'website' })
      .mockResolvedValueOnce({
        ...currentLead,
        source: 'referral',
        updatedAt: new Date('2026-11-11T10:01:00.000Z'),
      });
    mockRuleFindMany.mockResolvedValue([{ ...rule, trigger: 'record.updated' }]);

    await emitWorkflowEvent({ type: 'record.updated', recordType: 'Lead', recordId: 'lead-1' });
    await emitWorkflowEvent({ type: 'record.updated', recordType: 'Lead', recordId: 'lead-1' });

    const firstDedupeKey = mockExecutionCreate.mock.calls[0]?.[0]?.data.dedupeKey;
    const secondDedupeKey = mockExecutionCreate.mock.calls[1]?.[0]?.data.dedupeKey;
    expect(firstDedupeKey).not.toBe(secondDedupeKey);
  });

  it('keeps updated and status_changed events on the same persisted snapshot', async () => {
    const statusRule = {
      ...rule,
      id: 'status-rule',
      trigger: 'record.status_changed',
      actions: { list: [{ type: 'log', message: 'changed' }] },
    };
    mockLeadFindFirst.mockResolvedValueOnce({ ...currentLead, status: 'qualified' });
    mockRuleFindMany.mockImplementation(async ({ where }: { where: { trigger: string } }) =>
      where.trigger === 'record.status_changed' ? [statusRule] : []
    );

    const results = await emitWorkflowEvents([
      { type: 'record.updated', recordType: 'Lead', recordId: 'lead-1' },
      {
        type: 'record.status_changed',
        recordType: 'Lead',
        recordId: 'lead-1',
        previousStatus: 'new',
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[1]?.executed).toBe(1);
    expect(mockLeadFindFirst).toHaveBeenCalledOnce();
  });
});

describe('workflow execution authorization, isolation and history', () => {
  it('runs a matching rule without requiring workflow.update', async () => {
    mockRuleFindMany.mockResolvedValueOnce([rule]);

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result).toMatchObject({ matched: 1, executed: 1, failed: 0 });
    expect(mockExecutionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        recordType: 'Lead',
        recordId: 'lead-1',
        status: 'running',
        attempts: 1,
      }),
    });
    expect(mockExecutionUpdate).toHaveBeenCalledWith({
      where: { id: 'execution-1' },
      data: expect.objectContaining({
        status: 'succeeded',
        resultLog: expect.objectContaining({ source: 'business-service', actorId: 'user-1' }),
      }),
    });
    expect(mockRequirePermission).not.toHaveBeenCalledWith('user-1', 'org-1', 'workflow.update');
  });

  it('does not run duplicate events after the unique execution claim loses', async () => {
    mockRuleFindMany.mockResolvedValueOnce([rule]);
    mockExecutionCreate.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: 'P2002' })
    );

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result).toMatchObject({ matched: 1, skipped: 1, executed: 0 });
    expect(mockExecutionUpdate).not.toHaveBeenCalled();
  });

  it('makes a transient execution-history persistence failure retryable', async () => {
    mockRuleFindMany.mockResolvedValueOnce([rule]);
    mockExecutionUpdate.mockRejectedValueOnce(new Error('transient database error'));

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result).toMatchObject({ failed: 1, executed: 0 });
    expect(mockExecutionUpdate).toHaveBeenCalledTimes(2);
    expect(mockExecutionUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'execution-1' },
      data: expect.objectContaining({
        status: 'failed',
        resultLog: expect.objectContaining({
          error: 'Could not persist the initial workflow outcome',
          actionDefinitions: expect.any(Object),
          actions: [{ index: 0, type: 'log', status: 'ok', detail: 'created' }],
        }),
      }),
    });
  });

  it('requires the affected record permission and persists denied mutations as failures', async () => {
    mockRuleFindMany.mockResolvedValueOnce([
      {
        ...rule,
        actions: { list: [{ type: 'set_status', status: 'qualified' }] },
      },
    ]);
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result.failed).toBe(1);
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'lead.update');
    expect(mockLeadUpdateMany).not.toHaveBeenCalled();
    expect(mockExecutionUpdate).toHaveBeenCalledWith({
      where: { id: 'execution-1' },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('writes status changes tenant-scoped with a matching audit entry', async () => {
    mockRuleFindMany.mockResolvedValueOnce([
      {
        ...rule,
        actions: { list: [{ type: 'set_status', status: 'qualified' }] },
      },
    ]);

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result.executed).toBe(1);
    expect(mockLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', organizationId: 'org-1', deletedAt: null, status: 'new' },
      data: { status: 'qualified' },
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'user-1',
        action: 'workflow.set_status',
        entityType: 'Lead',
        entityId: 'lead-1',
        before: { status: 'new' },
        after: { status: 'qualified' },
        organizationId: 'org-1',
      }),
    });
  });

  it.each([
    { currentStatus: 'new', requestedStatus: 'converted' },
    { currentStatus: 'converted', requestedStatus: 'qualified' },
  ])(
    'keeps workflow status actions out of the Lead conversion lifecycle ($currentStatus → $requestedStatus)',
    async ({ currentStatus, requestedStatus }) => {
      mockLeadFindFirst.mockResolvedValue({ ...currentLead, status: currentStatus });
      mockRuleFindMany.mockResolvedValueOnce([
        {
          ...rule,
          trigger: 'record.updated',
          actions: { list: [{ type: 'set_status', status: requestedStatus }] },
        },
      ]);

      const result = await emitWorkflowEvent({
        type: 'record.updated',
        recordType: 'Lead',
        recordId: 'lead-1',
      });

      expect(result.executed).toBe(1);
      expect(mockLeadUpdateMany).not.toHaveBeenCalled();
      expect(mockAuditCreate).not.toHaveBeenCalled();
      expect(result.executions[0]?.resultLog?.actions).toMatchObject([
        {
          type: 'set_status',
          status: 'skipped',
          detail: expect.stringContaining('lead conversion service'),
        },
      ]);
    }
  );

  it('explicitly skips generic invoice status writes', async () => {
    mockRuleFindMany.mockResolvedValueOnce([
      {
        ...rule,
        actions: { list: [{ type: 'set_status', status: 'paid' }] },
      },
    ]);

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Invoice',
      recordId: 'invoice-1',
    });

    expect(result.executed).toBe(1);
    expect(mockInvoiceFindFirst).toHaveBeenCalledOnce();
    expect(mockAuditCreate).not.toHaveBeenCalled();
    expect(result.executions[0]?.resultLog?.actions).toMatchObject([
      {
        type: 'set_status',
        status: 'skipped',
        detail: expect.stringContaining('invoice status is managed'),
      },
    ]);
  });

  it('creates notifications idempotently and audits the automated delivery', async () => {
    mockRuleFindMany.mockResolvedValueOnce([
      {
        ...rule,
        actions: {
          list: [
            { type: 'notify_user', userId: 'user-1', title: 'New lead', message: 'Review it' },
          ],
        },
      },
    ]);

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result.executed).toBe(1);
    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        type: 'workflow',
        channel: 'in_app',
      }),
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'workflow.notification', organizationId: 'org-1' }),
    });
  });

  it('treats a concurrent notification unique-key race as an idempotent skip', async () => {
    mockRuleFindMany.mockResolvedValueOnce([
      {
        ...rule,
        actions: { list: [{ type: 'notify_user', userId: 'user-1', title: 'New lead' }] },
      },
    ]);
    mockNotificationCreate.mockRejectedValueOnce(
      Object.assign(new Error('duplicate notification'), { code: 'P2002' })
    );

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Lead',
      recordId: 'lead-1',
    });

    expect(result).toMatchObject({ executed: 1, failed: 0 });
    expect(result.executions[0]?.resultLog?.actions).toMatchObject([
      {
        type: 'notify_user',
        status: 'skipped',
        detail: expect.stringContaining('already delivered'),
      },
    ]);
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('keeps unsupported actions explicit in the execution log', async () => {
    mockRuleFindMany.mockResolvedValueOnce([
      {
        ...rule,
        actions: { list: [{ type: 'set_status', status: 'paid' }] },
      },
    ]);

    const result = await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Invoice',
      recordId: 'invoice-1',
    });
    expect(result.executions[0]?.resultLog?.actions).toMatchObject([
      { status: 'skipped', detail: expect.stringContaining('not supported') },
    ]);
  });
});

describe('workflow retries', () => {
  it('uses an atomic retry claim and requires workflow.execute', async () => {
    mockRuleFindFirst.mockResolvedValueOnce({ ...rule, enabled: true });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      status: 'failed',
      attempts: 1,
      resultLog: {
        eventType: 'record.created',
        eventVersion: 'original-event-version',
        actions: [{ index: 0, type: 'log', status: 'failed' }],
      },
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      status: 'succeeded',
      attempts: 2,
      resultLog: { retried: true },
    });

    const result = await retryWorkflowExecution('execution-1');

    expect(result).toMatchObject({ id: 'execution-1', status: 'succeeded', attempts: 2 });
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'workflow.execute');
    expect(mockExecutionUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'execution-1', organizationId: 'org-1', status: 'failed' },
      data: expect.objectContaining({ status: 'running', attempts: { increment: 1 } }),
    });
    expect(mockExecutionUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'execution-1', organizationId: 'org-1', status: 'running' },
      data: expect.objectContaining({ status: 'succeeded' }),
    });
  });

  it('does not reveal an execution from another organization during retry', async () => {
    mockExecutionFindFirst.mockResolvedValueOnce(null);

    await expect(retryWorkflowExecution('foreign-execution')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockExecutionFindFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'foreign-execution', organizationId: 'org-1' },
    });
    expect(mockRuleFindFirst).not.toHaveBeenCalled();
    expect(mockExecutionUpdateMany).not.toHaveBeenCalled();
  });

  it('denies a retry request without workflow.execute before loading execution history', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(retryWorkflowExecution('execution-1')).rejects.toMatchObject({ statusCode: 403 });

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'workflow.execute');
    expect(mockExecutionFindFirst).not.toHaveBeenCalled();
  });

  it('requires source-record read permission before loading a retry snapshot', async () => {
    mockRequirePermission.mockImplementation(
      async (_userId: string, _organizationId: string, permission: string) => {
        if (permission === 'lead.read') {
          throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
        }
      }
    );

    await expect(retryWorkflowExecution('execution-1')).rejects.toMatchObject({ statusCode: 403 });

    expect(mockRequirePermission).toHaveBeenNthCalledWith(1, 'user-1', 'org-1', 'workflow.execute');
    expect(mockRequirePermission).toHaveBeenNthCalledWith(2, 'user-1', 'org-1', 'lead.read');
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
    expect(mockExecutionUpdateMany).not.toHaveBeenCalled();
  });

  it('retries the original action snapshot even if the rule was edited later', async () => {
    mockRuleFindFirst.mockResolvedValueOnce({
      ...rule,
      enabled: true,
      actions: {
        list: [{ type: 'notify_user', userId: 'user-1', title: 'new definition' }],
      },
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      status: 'failed',
      attempts: 1,
      resultLog: {
        eventType: 'record.created',
        eventVersion: 'original-event-version',
        actionDefinitions: { list: [{ type: 'log', message: 'original definition' }] },
        actions: [{ index: 0, type: 'log', status: 'failed' }],
      },
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      status: 'succeeded',
      attempts: 2,
      resultLog: { retried: true },
    });

    await retryWorkflowExecution('execution-1');

    expect(mockUserFindFirst).not.toHaveBeenCalled();
    const finalization = mockExecutionUpdateMany.mock.calls[1]?.[0] as {
      data: { resultLog: { actionDefinitions: unknown; actions: unknown } };
    };
    expect(finalization.data.resultLog.actionDefinitions).toEqual({
      list: [{ type: 'log', message: 'original definition' }],
    });
    expect(finalization.data.resultLog.actions).toMatchObject([
      { index: 0, type: 'log', status: 'ok' },
    ]);
  });

  it('retries legacy status_changed executions that did not snapshot previousStatus', async () => {
    mockRuleFindFirst.mockResolvedValueOnce({
      ...rule,
      trigger: 'record.status_changed',
      enabled: true,
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      status: 'failed',
      attempts: 1,
      resultLog: {
        actions: [{ index: 0, type: 'log', status: 'failed' }],
      },
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      status: 'succeeded',
      attempts: 2,
      resultLog: { retried: true },
    });

    const result = await retryWorkflowExecution('execution-1');

    expect(result.status).toBe('succeeded');
    expect(mockExecutionUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          resultLog: expect.objectContaining({ eventType: 'record.status_changed' }),
        }),
      })
    );
  });

  it('releases the retry claim when finalization or audit logging fails', async () => {
    mockRuleFindFirst.mockResolvedValueOnce({ ...rule, enabled: true });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      status: 'failed',
      attempts: 1,
      resultLog: {
        eventType: 'record.created',
        actionDefinitions: { list: [{ type: 'log', message: 'original action' }] },
        actions: [{ index: 0, type: 'log', status: 'failed' }],
      },
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      status: 'succeeded',
      attempts: 2,
      resultLog: {},
    });
    mockAuditCreate.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(retryWorkflowExecution('execution-1')).rejects.toThrow('audit unavailable');

    expect(mockExecutionUpdateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { id: 'execution-1', organizationId: 'org-1', status: 'running' },
        data: expect.objectContaining({
          status: 'failed',
          resultLog: expect.objectContaining({
            error: 'Retry finalization or audit logging failed; retry may be attempted again',
            actions: [{ index: 0, type: 'log', status: 'ok', detail: 'original action' }],
          }),
        }),
      })
    );
  });

  it('does not run actions when another retry already claimed the execution', async () => {
    mockRuleFindFirst.mockResolvedValueOnce({ ...rule, enabled: true });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      status: 'failed',
      attempts: 1,
      resultLog: { eventType: 'record.created', actions: [] },
    });
    mockExecutionUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(retryWorkflowExecution('execution-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('reloads the tenant-scoped record so retry action paths resolve', async () => {
    mockRuleFindFirst.mockResolvedValueOnce({
      id: 'rule-1',
      trigger: 'record.created',
      enabled: true,
      actions: { list: [{ type: 'notify_user', userId: '$.ownerId', title: 'Retry target' }] },
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'Lead',
      recordId: 'lead-1',
      status: 'failed',
      attempts: 1,
      resultLog: {
        eventType: 'record.created',
        eventVersion: 'original-event-version',
        actions: [{ index: 0, type: 'notify_user', status: 'failed', detail: 'temporary failure' }],
      },
    });
    mockExecutionFindFirst.mockResolvedValueOnce({
      id: 'execution-1',
      status: 'succeeded',
      attempts: 2,
      resultLog: { retried: true },
    });
    mockLeadFindFirst.mockResolvedValueOnce({ ...currentLead, ownerId: 'target-user' });
    mockUserFindFirst.mockResolvedValueOnce({ id: 'target-user' });

    const result = await retryWorkflowExecution('execution-1');

    expect(result.status).toBe('succeeded');
    expect(mockLeadFindFirst).toHaveBeenCalledWith({
      where: { id: 'lead-1', organizationId: 'org-1', deletedAt: null },
    });
    expect(mockUserFindFirst).toHaveBeenCalledWith({
      where: { id: 'target-user', organizationId: 'org-1' },
      select: { id: true },
    });
  });
});
