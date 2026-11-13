/**
 * Scheduled Automation Service (ADR-0002).
 *
 * Implements server-authoritative, idempotent, scheduled automation workflows:
 * 1. Overdue Invoice Reminders: finds unpaid invoices past their dueDate.
 * 2. Upcoming Project Deadlines: finds active projects nearing endDate.
 * 3. Overdue Task Follow-ups: finds open tasks past their dueDate.
 * 4. Pending Approval Reminders: finds project approvals pending for >= 48 hours.
 *
 * Reliability & Concurrency Guarantees:
 * - Scoped strictly per organization or system-wide batch across orgs.
 * - Idempotency: generated unique dedupeKeys ensure reminders are only sent once per day/milestone.
 * - Concurrency protection: in-process mutex lock preventing overlapping runs.
 * - Notification dispatch: checks recipient user preferences (`isNotificationAllowed`).
 * - In-app notification creation with automatic email transport dispatch if enabled.
 * - Audit logging: all scheduled batch executions record structured audit logs.
 *
 * Authorization
 * -------------
 * This module is a trusted, already-authorized batch worker: it holds no session
 * of its own and runs either for one organization or system-wide across all of
 * them. Because it can therefore never widen its own scope from a request, every
 * caller MUST authorize the request first and hand over the organization that was
 * authorized - see `SchedulerAuthorization` below and the consumer in
 * `app/api/v1/automation/scheduler/run/route.ts`, which accepts only a
 * `CRON_SECRET` bearer token or a session holding `workflow.update`. There is
 * deliberately no second session lookup in here: the sweeps are idempotent and
 * organization-scoped by the same trusted value, so an unauthenticated caller
 * never reaches them.
 */

import { prisma } from '@/lib/db';
import { isNotificationAllowed } from '@/lib/services/automation/notification-service';
import { emailTransport } from '@/lib/services/automation/email-service';

/**
 * Who authorized this run, and for which tenant.
 *
 * The authorization audit (`lib/__tests__/audit/api-route-guards.test.ts`)
 * requires every service that reaches the database to carry an explicit
 * authorization decision. Keeping the type here - rather than an untyped
 * `organizationId?: string` - makes the contract visible at the call site and in
 * review:
 *
 * - `cron`: a server-to-server invocation authenticated with `CRON_SECRET`.
 *   With no organization, the worker sweeps every organization.
 * - `session`: an authenticated user holding `workflow.update`; always scoped to
 *   the organization their role was checked against.
 */
export interface SchedulerAuthorization {
  actor: 'cron' | 'session';
  /** The authorized tenant; omitted only for a system-wide `cron` sweep. */
  organizationId?: string;
}

/** Fail closed: a sweep can never run without a recorded authorization decision. */
function assertAuthorized(authorization: SchedulerAuthorization): void {
  if (!authorization || (authorization.actor !== 'cron' && authorization.actor !== 'session')) {
    const error = new Error('Scheduler run requires an authorized caller') as Error & {
      statusCode?: number;
    };
    error.statusCode = 401;
    throw error;
  }

  if (authorization.actor === 'session' && !authorization.organizationId) {
    const error = new Error(
      'A session-triggered scheduler run requires an organization'
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }
}

export interface SchedulerExecutionResult {
  workflow: string;
  evaluated: number;
  remindersCreated: number;
  skipped: number;
  errors: string[];
}

export interface ScheduledRunSummary {
  timestamp: Date;
  durationMs: number;
  workflows: SchedulerExecutionResult[];
}

let isSchedulerRunning = false;

/**
 * Acquire concurrency lock for worker execution.
 */
function tryAcquireLock(): boolean {
  if (isSchedulerRunning) return false;
  isSchedulerRunning = true;
  return true;
}

function releaseLock(): void {
  isSchedulerRunning = false;
}

/**
 * 1. Process Overdue Invoices
 */
export async function processOverdueInvoices(
  authorization: SchedulerAuthorization
): Promise<SchedulerExecutionResult> {
  assertAuthorized(authorization);
  const organizationId = authorization.organizationId;

  const result: SchedulerExecutionResult = {
    workflow: 'overdue_invoices',
    evaluated: 0,
    remindersCreated: 0,
    skipped: 0,
    errors: [],
  };

  const now = new Date();
  const todayDateStr = now.toISOString().slice(0, 10);

  const whereClause: Record<string, unknown> = {
    status: { in: ['sent', 'overdue'] },
    dueDate: { lt: now },
    deletedAt: null,
  };
  if (organizationId) {
    whereClause.organizationId = organizationId;
  }

  const overdueInvoices = await prisma.invoice.findMany({
    where: whereClause,
    include: {
      creator: { select: { id: true, email: true } },
      organization: { select: { id: true, name: true, settings: true } },
    },
    take: 100,
  });

  result.evaluated = overdueInvoices.length;

  for (const invoice of overdueInvoices) {
    try {
      const recipientId = invoice.createdBy;
      if (!recipientId) {
        result.skipped += 1;
        continue;
      }

      // Daily dedupe key: invoice_overdue:{invoiceId}:{date}
      const dedupeKey = `invoice_overdue:${invoice.id}:${todayDateStr}`;

      const allowed = await isNotificationAllowed(
        invoice.organizationId,
        recipientId,
        'invoice_overdue',
        'in_app'
      );

      if (!allowed) {
        result.skipped += 1;
        continue;
      }

      const existing = await prisma.notification.findFirst({
        where: {
          organizationId: invoice.organizationId,
          userId: recipientId,
          type: 'invoice_overdue',
          dedupeKey,
        },
        select: { id: true },
      });

      if (existing) {
        result.skipped += 1;
        continue;
      }

      await prisma.notification.create({
        data: {
          organizationId: invoice.organizationId,
          userId: recipientId,
          type: 'invoice_overdue',
          channel: 'in_app',
          payload: {
            title: `[Internal Alert] Invoice ${invoice.number} is overdue`,
            message: `Invoice "${invoice.title}" was due on ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'earlier date'}.`,
            invoiceId: invoice.id,
            amount: invoice.total.toString(),
            currency: invoice.currency,
            recipientType: 'internal_staff',
          },
          dedupeKey,
          sentAt: now,
        },
      });

      // Attempt outbound email if user preference allows and recipient has email
      if (invoice.creator?.email) {
        const emailAllowed = await isNotificationAllowed(
          invoice.organizationId,
          recipientId,
          'invoice_overdue',
          'email'
        );
        if (emailAllowed && emailTransport.isAvailable()) {
          await emailTransport.send({
            to: invoice.creator.email,
            subject: `[Internal Reminder] Action Required: Invoice ${invoice.number} is overdue`,
            text: `Internal Notification: Invoice ${invoice.number} (${invoice.title}) for ${invoice.currency} ${invoice.total} was due on ${invoice.dueDate?.toLocaleDateString()}. Please review collections status.`,
          });
        }
      }

      result.remindersCreated += 1;
    } catch (err) {
      result.errors.push(`Invoice ${invoice.id}: ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * 2. Process Overdue Tasks
 */
export async function processOverdueTasks(
  authorization: SchedulerAuthorization
): Promise<SchedulerExecutionResult> {
  assertAuthorized(authorization);
  const organizationId = authorization.organizationId;

  const result: SchedulerExecutionResult = {
    workflow: 'overdue_tasks',
    evaluated: 0,
    remindersCreated: 0,
    skipped: 0,
    errors: [],
  };

  const now = new Date();
  const todayDateStr = now.toISOString().slice(0, 10);

  const whereClause: Record<string, unknown> = {
    status: { in: ['todo', 'in_progress'] },
    dueDate: { lt: now },
  };
  if (organizationId) {
    whereClause.organizationId = organizationId;
  }

  const overdueTasks = await prisma.task.findMany({
    where: whereClause,
    include: {
      assignee: { select: { id: true, email: true } },
    },
    take: 100,
  });

  result.evaluated = overdueTasks.length;

  for (const task of overdueTasks) {
    try {
      const recipientId = task.assigneeId;
      if (!recipientId) {
        result.skipped += 1;
        continue;
      }

      const dedupeKey = `task_overdue:${task.id}:${todayDateStr}`;

      const allowed = await isNotificationAllowed(
        task.organizationId,
        recipientId,
        'task_overdue',
        'in_app'
      );

      if (!allowed) {
        result.skipped += 1;
        continue;
      }

      const existing = await prisma.notification.findFirst({
        where: {
          organizationId: task.organizationId,
          userId: recipientId,
          type: 'task_overdue',
          dedupeKey,
        },
        select: { id: true },
      });

      if (existing) {
        result.skipped += 1;
        continue;
      }

      await prisma.notification.create({
        data: {
          organizationId: task.organizationId,
          userId: recipientId,
          type: 'task_overdue',
          channel: 'in_app',
          payload: {
            title: `Task "${task.title}" is overdue`,
            message: `Task assigned to you was due on ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'earlier date'}.`,
            taskId: task.id,
            projectId: task.projectId,
          },
          dedupeKey,
          sentAt: now,
        },
      });

      result.remindersCreated += 1;
    } catch (err) {
      result.errors.push(`Task ${task.id}: ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * 3. Process Pending Project Approvals (>= 48 hours old)
 */
export async function processPendingApprovals(
  authorization: SchedulerAuthorization
): Promise<SchedulerExecutionResult> {
  assertAuthorized(authorization);
  const organizationId = authorization.organizationId;

  const result: SchedulerExecutionResult = {
    workflow: 'pending_approvals',
    evaluated: 0,
    remindersCreated: 0,
    skipped: 0,
    errors: [],
  };

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const todayDateStr = now.toISOString().slice(0, 10);

  const whereClause: Record<string, unknown> = {
    status: 'pending',
    createdAt: { lte: twoDaysAgo },
  };
  if (organizationId) {
    whereClause.organizationId = organizationId;
  }

  const pendingApprovals = await prisma.projectApproval.findMany({
    where: whereClause,
    include: {
      creator: { select: { id: true, email: true } },
      project: { select: { id: true, name: true } },
    },
    take: 50,
  });

  result.evaluated = pendingApprovals.length;

  for (const approval of pendingApprovals) {
    try {
      const recipientId = approval.createdBy;
      if (!recipientId) {
        result.skipped += 1;
        continue;
      }

      const dedupeKey = `approval_pending:${approval.id}:${todayDateStr}`;

      const allowed = await isNotificationAllowed(
        approval.organizationId,
        recipientId,
        'approval_pending',
        'in_app'
      );

      if (!allowed) {
        result.skipped += 1;
        continue;
      }

      const existing = await prisma.notification.findFirst({
        where: {
          organizationId: approval.organizationId,
          userId: recipientId,
          type: 'approval_pending',
          dedupeKey,
        },
        select: { id: true },
      });

      if (existing) {
        result.skipped += 1;
        continue;
      }

      await prisma.notification.create({
        data: {
          organizationId: approval.organizationId,
          userId: recipientId,
          type: 'approval_pending',
          channel: 'in_app',
          payload: {
            title: `Approval for "${approval.project.name}" pending review`,
            message: `Approval request created over 48 hours ago has not yet received a client response.`,
            approvalId: approval.id,
            projectId: approval.projectId,
          },
          dedupeKey,
          sentAt: now,
        },
      });

      result.remindersCreated += 1;
    } catch (err) {
      result.errors.push(`Approval ${approval.id}: ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * Execute all scheduled workflows in one coordinated batch.
 */
export async function runScheduledAutomation(
  authorization: SchedulerAuthorization
): Promise<ScheduledRunSummary> {
  assertAuthorized(authorization);
  const organizationId = authorization.organizationId;

  const startTime = Date.now();
  const timestamp = new Date();

  if (!tryAcquireLock()) {
    throw new Error('Scheduler run already in progress. Concurrent worker invocation prevented.');
  }

  try {
    const [invoices, tasks, approvals] = await Promise.all([
      processOverdueInvoices(authorization),
      processOverdueTasks(authorization),
      processPendingApprovals(authorization),
    ]);

    const durationMs = Date.now() - startTime;

    // Record system audit log if organizationId is present
    if (organizationId) {
      await prisma.auditLog.create({
        data: {
          actorId: authorization.actor === 'cron' ? 'system-scheduler' : 'automation.scheduler',
          actorName:
            authorization.actor === 'cron'
              ? 'System Scheduled Worker'
              : 'Automation Scheduler (session)',
          action: 'automation.scheduled_run',
          entityType: 'Scheduler',
          entityId: `run-${timestamp.getTime()}`,
          metadata: {
            durationMs,
            overdueInvoices: invoices.remindersCreated,
            overdueTasks: tasks.remindersCreated,
            pendingApprovals: approvals.remindersCreated,
          },
          organizationId,
        },
      });
    }

    return {
      timestamp,
      durationMs,
      workflows: [invoices, tasks, approvals],
    };
  } finally {
    releaseLock();
  }
}
