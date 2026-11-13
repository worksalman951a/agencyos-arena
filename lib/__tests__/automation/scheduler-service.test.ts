import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  processOverdueInvoices,
  processOverdueTasks,
  processPendingApprovals,
  runScheduledAutomation,
} from '@/lib/services/automation/scheduler-service';
import { emailTransport } from '@/lib/services/automation/email-service';
import { prisma } from '@/lib/db';
import { isNotificationAllowed } from '@/lib/services/automation/notification-service';

vi.mock('@/lib/db', () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    projectApproval: {
      findMany: vi.fn(),
    },
    notification: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/automation/notification-service', () => ({
  isNotificationAllowed: vi.fn(),
}));

vi.mock('@/lib/services/automation/email-service', () => ({
  emailTransport: {
    isAvailable: vi.fn(),
    send: vi.fn(),
  },
  isValidEmail: (email: string) => email.includes('@'),
  escapeHtml: (s: string) => s,
}));

describe('Phase 11F: Scheduled Automation & Operational Reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNotificationAllowed).mockResolvedValue(true);
    vi.mocked(emailTransport.isAvailable).mockReturnValue(false);
  });

  describe('Overdue Invoices Workflow', () => {
    it('evaluates and sends notifications for past-due invoices', async () => {
      const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000);
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: 'inv-1',
          number: 'INV-001',
          title: 'Design Sprint',
          organizationId: 'org-1',
          total: { toString: () => '1200.00' },
          currency: 'USD',
          dueDate: pastDue,
          createdBy: 'user-creator',
          creator: { id: 'user-creator', email: 'creator@example.com' },
          organization: { id: 'org-1', name: 'Acme', settings: {} },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.invoice.findMany>>);

      vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.notification.create).mockResolvedValue({
        id: 'notif-1',
      } as unknown as Awaited<ReturnType<typeof prisma.notification.create>>);

      const result = await processOverdueInvoices({ actor: 'session', organizationId: 'org-1' });

      expect(result.evaluated).toBe(1);
      expect(result.remindersCreated).toBe(1);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-creator',
            type: 'invoice_overdue',
            dedupeKey: expect.stringContaining('invoice_overdue:inv-1:'),
          }),
        })
      );
    });

    it('enforces idempotency and skips duplicate execution within same day', async () => {
      const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000);
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: 'inv-1',
          number: 'INV-001',
          title: 'Design Sprint',
          organizationId: 'org-1',
          total: { toString: () => '1200.00' },
          currency: 'USD',
          dueDate: pastDue,
          createdBy: 'user-creator',
          creator: { id: 'user-creator', email: 'creator@example.com' },
          organization: { id: 'org-1', name: 'Acme', settings: {} },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.invoice.findMany>>);

      // Existing reminder already found
      vi.mocked(prisma.notification.findFirst).mockResolvedValue({
        id: 'notif-existing',
      } as unknown as Awaited<ReturnType<typeof prisma.notification.findFirst>>);

      const result = await processOverdueInvoices({ actor: 'session', organizationId: 'org-1' });

      expect(result.evaluated).toBe(1);
      expect(result.remindersCreated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('respects user notification opt-out preference', async () => {
      const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000);
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: 'inv-1',
          number: 'INV-001',
          title: 'Design Sprint',
          organizationId: 'org-1',
          total: { toString: () => '1200.00' },
          currency: 'USD',
          dueDate: pastDue,
          createdBy: 'user-creator',
          creator: { id: 'user-creator', email: 'creator@example.com' },
          organization: { id: 'org-1', name: 'Acme', settings: {} },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.invoice.findMany>>);

      vi.mocked(isNotificationAllowed).mockResolvedValue(false);

      const result = await processOverdueInvoices({ actor: 'session', organizationId: 'org-1' });

      expect(result.evaluated).toBe(1);
      expect(result.remindersCreated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('Overdue Tasks Workflow', () => {
    it('creates notifications for assignees of overdue tasks', async () => {
      const pastDue = new Date(Date.now() - 12 * 60 * 60 * 1000);
      vi.mocked(prisma.task.findMany).mockResolvedValue([
        {
          id: 'task-1',
          title: 'Complete audit review',
          organizationId: 'org-1',
          projectId: 'proj-1',
          assigneeId: 'user-worker',
          dueDate: pastDue,
          assignee: { id: 'user-worker', email: 'worker@example.com' },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.task.findMany>>);

      vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.notification.create).mockResolvedValue({
        id: 'notif-2',
      } as unknown as Awaited<ReturnType<typeof prisma.notification.create>>);

      const result = await processOverdueTasks({ actor: 'session', organizationId: 'org-1' });

      expect(result.evaluated).toBe(1);
      expect(result.remindersCreated).toBe(1);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-worker',
            type: 'task_overdue',
          }),
        })
      );
    });
  });

  describe('Pending Approvals Workflow', () => {
    it('identifies project approvals pending for >= 48 hours', async () => {
      const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
      vi.mocked(prisma.projectApproval.findMany).mockResolvedValue([
        {
          id: 'app-1',
          projectId: 'proj-1',
          organizationId: 'org-1',
          status: 'pending',
          createdBy: 'user-lead',
          createdAt: threeDaysAgo,
          creator: { id: 'user-lead', email: 'lead@example.com' },
          project: { id: 'proj-1', name: 'Brand Redesign' },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.projectApproval.findMany>>);

      vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.notification.create).mockResolvedValue({
        id: 'notif-3',
      } as unknown as Awaited<ReturnType<typeof prisma.notification.create>>);

      const result = await processPendingApprovals({ actor: 'session', organizationId: 'org-1' });

      expect(result.evaluated).toBe(1);
      expect(result.remindersCreated).toBe(1);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-lead',
            type: 'approval_pending',
          }),
        })
      );
    });
  });

  describe('Batch Runner & Mutex Locking', () => {
    it('executes workflows in coordinated batch and produces run summary', async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);
      vi.mocked(prisma.projectApproval.findMany).mockResolvedValue([]);

      const summary = await runScheduledAutomation({ actor: 'session', organizationId: 'org-1' });

      expect(summary.workflows.length).toBe(3);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'automation.scheduled_run',
            organizationId: 'org-1',
          }),
        })
      );
    });

    it('rejects concurrent overlapping scheduler execution via mutex guard', async () => {
      // Simulate slow promise
      let resolver: (val: unknown) => void;
      const slowPromise = new Promise((resolve) => {
        resolver = resolve;
      });

      vi.mocked(prisma.invoice.findMany).mockReturnValueOnce(
        slowPromise as unknown as ReturnType<typeof prisma.invoice.findMany>
      );

      const firstRunPromise = runScheduledAutomation({ actor: 'session', organizationId: 'org-1' });

      // Attempt second run while first is in progress
      await expect(
        runScheduledAutomation({ actor: 'session', organizationId: 'org-1' })
      ).rejects.toThrow(
        'Scheduler run already in progress. Concurrent worker invocation prevented.'
      );

      // Complete first run
      resolver!([]);
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);
      vi.mocked(prisma.projectApproval.findMany).mockResolvedValue([]);

      await firstRunPromise;
    });
  });

  /**
   * The scheduler is a trusted batch worker with no session of its own, so the
   * authorization decision has to arrive with the call. These tests pin that
   * contract: an unauthenticated or unscoped invocation is refused before any
   * query runs, and a cron sweep with no organization is allowed to run
   * system-wide.
   */
  describe('Authorization contract', () => {
    it('refuses to run without an authorization decision', async () => {
      await expect(
        runScheduledAutomation(undefined as unknown as Parameters<typeof runScheduledAutomation>[0])
      ).rejects.toThrow('Scheduler run requires an authorized caller');

      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
      expect(prisma.task.findMany).not.toHaveBeenCalled();
      expect(prisma.projectApproval.findMany).not.toHaveBeenCalled();
    });

    it('refuses a session-triggered run that names no organization', async () => {
      await expect(runScheduledAutomation({ actor: 'session' })).rejects.toThrow(
        'A session-triggered scheduler run requires an organization'
      );

      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });

    it('allows a system-wide cron sweep across every organization', async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);
      vi.mocked(prisma.projectApproval.findMany).mockResolvedValue([]);

      const summary = await runScheduledAutomation({ actor: 'cron' });

      expect(summary.workflows).toHaveLength(3);
      // System-wide: no organization predicate is applied to the sweeps.
      expect(vi.mocked(prisma.invoice.findMany).mock.calls[0][0]).not.toHaveProperty(
        'where.organizationId'
      );
      // …and no tenant-scoped audit row is written, because there is no tenant.
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('scopes every sweep and the audit row to the authorized organization', async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);
      vi.mocked(prisma.projectApproval.findMany).mockResolvedValue([]);

      await runScheduledAutomation({ actor: 'session', organizationId: 'org-42' });

      expect(vi.mocked(prisma.invoice.findMany).mock.calls[0][0]).toEqual(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-42' }) })
      );
      expect(vi.mocked(prisma.task.findMany).mock.calls[0][0]).toEqual(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-42' }) })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: 'org-42' }),
        })
      );
    });
  });
});
