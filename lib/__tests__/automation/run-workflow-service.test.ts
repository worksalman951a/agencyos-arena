import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    workflowRule: { findMany: vi.fn() },
    workflowExecution: { create: vi.fn(), update: vi.fn() },
    task: { updateMany: vi.fn() },
    invoice: { updateMany: vi.fn() },
    user: { findFirst: vi.fn() },
    role: { findFirst: vi.fn() },
    userRole: { findMany: vi.fn() },
    notification: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

vi.mock('@/lib/services/automation/notification-service', () => ({
  isNotificationAllowed: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { requireOrganization, requirePermission } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { dispatchWorkflowEvent } from '@/lib/services/automation/run-workflow-service';

const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRuleFindMany = prisma.workflowRule.findMany as unknown as ReturnType<typeof vi.fn>;
const mockExecutionCreate = prisma.workflowExecution.create as unknown as ReturnType<typeof vi.fn>;
const mockExecutionUpdate = prisma.workflowExecution.update as unknown as ReturnType<typeof vi.fn>;
const mockTaskUpdateMany = prisma.task.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceUpdateMany = prisma.invoice.updateMany as unknown as ReturnType<typeof vi.fn>;

const rule = {
  id: 'rule-1',
  trigger: 'record.created',
  conditions: {
    mode: 'all',
    all: [{ field: 'ownerId', operator: 'eq', value: 'user-1' }],
  },
  actions: { list: [{ type: 'set_status', status: 'closed' }] },
};

const taskEvent = {
  type: 'record.created' as const,
  recordType: 'Task',
  recordId: 'task-1',
  record: { ownerId: 'user-1', status: 'open' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    session: { id: 'session-1' },
    user: { id: 'user-1', email: 'user@example.test' },
  });
  mockCookies.mockResolvedValue({ toString: () => 'session=session-1' });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue(undefined);
  mockRuleFindMany.mockResolvedValue([rule]);
  mockExecutionCreate.mockResolvedValue({ id: 'execution-1' });
  mockExecutionUpdate.mockImplementation(async (args: unknown) => {
    const { data } = args as { data: { status: string; resultLog: unknown } };
    const created = mockExecutionCreate.mock.calls.at(-1)?.[0]?.data as
      { organizationId: string; ruleId: string; recordType: string; recordId: string } | undefined;
    return {
      id: 'execution-1',
      organizationId: created?.organizationId ?? 'org-1',
      ruleId: created?.ruleId ?? rule.id,
      recordType: created?.recordType ?? 'Task',
      recordId: created?.recordId ?? 'task-1',
      status: data.status,
      resultLog: data.resultLog,
      attempts: 1,
      lastAttemptAt: new Date('2026-11-11T00:00:00Z'),
      createdAt: new Date('2026-11-11T00:00:00Z'),
    };
  });
  mockTaskUpdateMany.mockResolvedValue({ count: 1 });
  mockInvoiceUpdateMany.mockResolvedValue({ count: 1 });
});

describe('workflow event dispatch authorization and record scope', () => {
  it('denies a workflow reader who lacks the write permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(dispatchWorkflowEvent(taskEvent)).rejects.toMatchObject({ statusCode: 403 });

    expect(mockRequirePermission).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'org-1',
      'workflow.update'
    );
    expect(mockRuleFindMany).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
  });

  it('loads only enabled rules from the authenticated organization for the event type', async () => {
    mockRuleFindMany.mockResolvedValueOnce([]);

    const result = await dispatchWorkflowEvent(taskEvent);

    expect(mockRuleFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { organizationId: 'org-1', enabled: true, trigger: 'record.created' },
      orderBy: { createdAt: 'asc' },
    });
    expect(result.executed).toBe(0);
    expect(mockExecutionCreate).not.toHaveBeenCalled();
  });

  it('does not run actions when the dedupe claim already exists', async () => {
    mockExecutionCreate.mockRejectedValueOnce(
      Object.assign(new Error('duplicate execution'), { code: 'P2002' })
    );

    const result = await dispatchWorkflowEvent(taskEvent);

    expect(result.matched).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.executed).toBe(0);
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    expect(mockExecutionUpdate).not.toHaveBeenCalled();
  });

  it('keeps status writes scoped to the caller organization', async () => {
    await dispatchWorkflowEvent(taskEvent);

    expect(mockRequirePermission).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'org-1',
      'workflow.update'
    );
    expect(mockTaskUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'task-1', organizationId: 'org-1' },
      data: { status: 'closed' },
    });
  });

  it('skips a record outside the caller organization', async () => {
    mockTaskUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await dispatchWorkflowEvent({ ...taskEvent, recordId: 'foreign-task' });

    expect(mockTaskUpdateMany).toHaveBeenCalledWith({
      where: { id: 'foreign-task', organizationId: 'org-1' },
      data: { status: 'closed' },
    });
    expect(result.executions[0]?.resultLog?.actions).toMatchObject([
      { type: 'set_status', status: 'skipped' },
    ]);
  });

  it('does not let generic automation bypass invoice status service rules', async () => {
    const result = await dispatchWorkflowEvent({
      ...taskEvent,
      recordType: 'Invoice',
      recordId: 'invoice-1',
    });

    expect(mockInvoiceUpdateMany).not.toHaveBeenCalled();
    expect(result.executions[0]?.resultLog?.actions).toMatchObject([
      { type: 'set_status', status: 'skipped' },
    ]);
  });
});
