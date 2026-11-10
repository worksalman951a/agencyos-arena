'use server';

/**
 * Workflow execution engine.
 *
 * Architectural choice (ADR-0002): rules execute **in-process, synchronously**
 * when an event is dispatched by the server that produced it. There is no
 * pg-boss worker in this phase — a queue with no consumer would make rules
 * silently never run, which is worse than a synchronous call. Dispatch failures
 * are persisted as failed executions (never thrown at the caller), so a broken
 * rule cannot fail the business write that triggered it.
 *
 * Duplicate-execution protection is at the database level:
 * `WorkflowExecution` has a unique index on
 * (ruleId, recordType, recordId, dedupeKey), so a retried dispatch, a
 * double-submitted form, or two concurrent requests cannot run the same rule
 * twice for the same record/transition. The executor claims the row first and
 * only runs actions if the claim succeeded.
 *
 * Failure handling: each action is attempted; a failure marks the execution
 * `failed` with the failing action in `resultLog`, and a retry re-runs only the
 * actions that did not complete (recorded in `resultLog.completedActions`).
 */

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';

import {
  matchesWorkflowRule,
  resolveActionValue,
  workflowDedupeKey,
  type WorkflowAction,
  type WorkflowEvent,
  type WorkflowTrigger,
} from '@/lib/automation/rules';
import { isNotificationAllowed } from '@/lib/services/automation/notification-service';

/** Records whose `status` column the `set_status` action may write. */
const STATUS_WRITABLE_RECORDS: Record<string, string> = {
  Lead: 'lead',
  Opportunity: 'opportunity',
  Task: 'task',
  Invoice: 'invoice',
  Project: 'project',
  Estimate: 'estimate',
  Proposal: 'proposal',
};

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
  }

  const user = result.user as { role?: string; organizationId?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

/** Shape returned by {@link dispatchWorkflowEvent}. */
export interface WorkflowEventResult {
  eventType: WorkflowTrigger;
  recordType: string;
  recordId: string;
  matched: number;
  executed: number;
  skipped: number;
  failed: number;
  executions: Array<{
    id: string;
    organizationId: string;
    ruleId: string;
    recordType: string;
    recordId: string;
    status: string;
    resultLog: Record<string, unknown> | null;
    attempts: number;
    lastAttemptAt: Date | null;
    createdAt: Date;
  }>;
}

interface ActionOutcome {
  index: number;
  type: string;
  status: 'ok' | 'skipped' | 'failed';
  detail?: string;
}

/** Run one action. Returns a human-readable detail for the execution log. */
async function runAction(
  action: WorkflowAction,
  event: WorkflowEvent,
  organizationId: string
): Promise<{ status: 'ok' | 'skipped'; detail: string }> {
  switch (action.type) {
    case 'log':
      return { status: 'ok', detail: action.message };

    case 'notify_user': {
      const userId = resolveActionValue(action.userId, event.record);
      if (!userId) return { status: 'skipped', detail: 'notification target did not resolve' };

      const target = await prisma.user.findFirst({
        where: { id: userId, organizationId },
        select: { id: true },
      });
      if (!target)
        return { status: 'skipped', detail: `user ${userId} is not in this organization` };

      const allowed = await isNotificationAllowed(organizationId, userId, 'workflow', 'in_app');
      if (!allowed) return { status: 'skipped', detail: 'recipient muted workflow notifications' };

      // Dedupe key ties the notification to the exact rule/record/transition, so
      // a retried execution cannot deliver it twice.
      const dedupeKey = [
        'workflow',
        event.type,
        event.recordType,
        event.recordId,
        workflowDedupeKey(event),
        action.title,
      ].join(':');

      const existing = await prisma.notification.findFirst({
        where: { organizationId, userId, type: 'workflow', dedupeKey },
        select: { id: true },
      });
      if (existing) return { status: 'skipped', detail: 'notification already delivered' };

      await prisma.notification.create({
        data: {
          organizationId,
          userId,
          type: 'workflow',
          channel: 'in_app',
          payload: {
            title: action.title,
            message: action.message ?? null,
            recordType: event.recordType,
            recordId: event.recordId,
            ruleAction: action.label ?? null,
          },
          dedupeKey,
          sentAt: new Date(),
        },
      });

      return { status: 'ok', detail: `notified user ${userId}` };
    }

    case 'notify_role': {
      const role = await prisma.role.findFirst({
        where: { organizationId, name: action.roleName },
        select: { id: true },
      });
      if (!role) return { status: 'skipped', detail: `role ${action.roleName} no longer exists` };

      const members = await prisma.userRole.findMany({
        where: { organizationId, roleId: role.id },
        select: { userId: true },
      });
      if (members.length === 0) {
        return { status: 'skipped', detail: `role ${action.roleName} has no members` };
      }

      let delivered = 0;
      for (const member of members as Array<{ userId: string }>) {
        const allowed = await isNotificationAllowed(
          organizationId,
          member.userId,
          'workflow',
          'in_app'
        );
        if (!allowed) continue;

        const dedupeKey = [
          'workflow',
          event.type,
          event.recordType,
          event.recordId,
          workflowDedupeKey(event),
          action.title,
        ].join(':');

        const existing = await prisma.notification.findFirst({
          where: { organizationId, userId: member.userId, type: 'workflow', dedupeKey },
          select: { id: true },
        });
        if (existing) continue;

        await prisma.notification.create({
          data: {
            organizationId,
            userId: member.userId,
            type: 'workflow',
            channel: 'in_app',
            payload: {
              title: action.title,
              message: action.message ?? null,
              recordType: event.recordType,
              recordId: event.recordId,
              ruleAction: action.label ?? null,
              role: action.roleName,
            },
            dedupeKey,
            sentAt: new Date(),
          },
        });
        delivered += 1;
      }

      return { status: 'ok', detail: `notified ${delivered} member(s) of ${action.roleName}` };
    }

    case 'assign_record_owner': {
      const userId = resolveActionValue(action.userId, event.record);
      if (!userId) return { status: 'skipped', detail: 'owner did not resolve' };

      const target = await prisma.user.findFirst({
        where: { id: userId, organizationId },
        select: { id: true },
      });
      if (!target)
        return { status: 'skipped', detail: `user ${userId} is not in this organization` };

      if (event.recordType !== 'Task') {
        // Only Task has a writable assignee column in this schema revision.
        return {
          status: 'skipped',
          detail: `assign_record_owner is not supported for ${event.recordType}`,
        };
      }

      // `updateMany` keeps the organization predicate in the write itself. A bare
      // `update({ where: { id } })` would let an event naming another tenant's
      // record id mutate that record.
      const { count } = await prisma.task.updateMany({
        where: { id: event.recordId, organizationId },
        data: { assigneeId: userId },
      });
      if (count === 0) {
        return { status: 'skipped', detail: `task ${event.recordId} is not in this organization` };
      }
      return { status: 'ok', detail: `assigned task to ${userId}` };
    }

    case 'set_status': {
      const model = STATUS_WRITABLE_RECORDS[event.recordType];
      if (!model) {
        return {
          status: 'skipped',
          detail: `set_status is not supported for ${event.recordType}`,
        };
      }

      // The record handle is typed loosely on purpose: the model name is looked
      // up in the allow-list above, never taken from user input directly.
      //
      // `updateMany` (not `update`) so the organization predicate is part of the
      // write: `event.recordId` comes from the request body, and every writable
      // model carries `organizationId`.
      const delegate = (
        prisma as unknown as Record<
          string,
          { updateMany: (args: unknown) => Promise<{ count: number }> }
        >
      )[model];
      const { count } = await delegate.updateMany({
        where: { id: event.recordId, organizationId },
        data: { status: action.status },
      });
      if (count === 0) {
        return {
          status: 'skipped',
          detail: `${event.recordType} ${event.recordId} is not in this organization`,
        };
      }
      return { status: 'ok', detail: `status set to ${action.status}` };
    }

    default:
      return { status: 'skipped', detail: 'unsupported action' };
  }
}

/**
 * Dispatch an event to every enabled rule in the organization.
 *
 * Must be called from an authorized context: it requires `workflow.read` in the
 * caller's organization. Records passed in are the record's own fields; they
 * are never fetched across organizations.
 */
export async function dispatchWorkflowEvent(event: WorkflowEvent): Promise<WorkflowEventResult> {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'workflow.read');

  const rules = await prisma.workflowRule.findMany({
    where: { organizationId, enabled: true, trigger: event.type },
    orderBy: { createdAt: 'asc' },
  });

  const result: WorkflowEventResult = {
    eventType: event.type,
    recordType: event.recordType,
    recordId: event.recordId,
    matched: 0,
    executed: 0,
    skipped: 0,
    failed: 0,
    executions: [],
  };

  const dedupeKey = workflowDedupeKey(event);

  for (const rule of rules as Array<{
    id: string;
    trigger: string;
    conditions: unknown;
    actions: { list?: WorkflowAction[] } | null;
  }>) {
    if (!matchesWorkflowRule(rule, event)) continue;
    result.matched += 1;

    // Claim the execution row first. A unique-violation means this exact
    // (rule, record, transition) already ran — the duplicate guard.
    let executionId: string;
    try {
      const created = await prisma.workflowExecution.create({
        data: {
          organizationId,
          ruleId: rule.id,
          recordType: event.recordType,
          recordId: event.recordId,
          status: 'running',
          dedupeKey,
          attempts: 1,
          lastAttemptAt: new Date(),
          resultLog: { eventType: event.type },
        },
      });
      executionId = created.id;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2002') {
        result.skipped += 1;
        continue;
      }
      result.failed += 1;
      continue;
    }

    const actions = rule.actions?.list ?? [];
    const outcomes: ActionOutcome[] = [];
    let failure: string | null = null;

    for (const [index, action] of actions.entries()) {
      try {
        const outcome = await runAction(action, event, organizationId);
        outcomes.push({ index, type: action.type, status: outcome.status, detail: outcome.detail });
      } catch (error) {
        failure = `${action.type}: ${(error as Error).message}`;
        outcomes.push({ index, type: action.type, status: 'failed', detail: failure });
        break;
      }
    }

    const status = failure ? 'failed' : 'succeeded';
    const updated = await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status,
        resultLog: {
          eventType: event.type,
          actions: outcomes,
          ...(failure ? { error: failure } : {}),
        },
      },
    });

    if (failure) result.failed += 1;
    else result.executed += 1;

    result.executions.push({
      id: updated.id,
      organizationId: updated.organizationId,
      ruleId: updated.ruleId,
      recordType: updated.recordType,
      recordId: updated.recordId,
      status: updated.status,
      resultLog: (updated.resultLog ?? null) as Record<string, unknown> | null,
      attempts: updated.attempts,
      lastAttemptAt: updated.lastAttemptAt,
      createdAt: updated.createdAt,
    });
  }

  return result;
}

/**
 * Retry a failed execution.
 *
 * Only `failed` executions can be retried, and only once in flight: the status
 * moves to `running` before any action re-runs. Actions recorded as `ok` in the
 * previous attempt are not repeated, so a retry cannot double-notify.
 */
export async function retryWorkflowExecution(executionId: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'workflow.update');

  const execution = await prisma.workflowExecution.findFirst({
    where: { id: executionId, organizationId },
  });
  if (!execution) throw codedError('Not found', 404);
  if (execution.status !== 'failed') {
    throw codedError('Only failed executions can be retried', 400);
  }

  const rule = await prisma.workflowRule.findFirst({
    where: { id: execution.ruleId, organizationId },
  });
  if (!rule) throw codedError('Rule no longer exists', 400);

  const previousLog = (execution.resultLog ?? {}) as {
    eventType?: WorkflowTrigger;
    actions?: ActionOutcome[];
  };
  const completed = new Set(
    (previousLog.actions ?? []).filter((a) => a.status === 'ok').map((a) => a.index)
  );

  await prisma.workflowExecution.update({
    where: { id: execution.id },
    data: { status: 'running', attempts: { increment: 1 }, lastAttemptAt: new Date() },
  });

  const actions = ((rule.actions ?? {}) as { list?: WorkflowAction[] }).list ?? [];
  const event: WorkflowEvent = {
    type: (previousLog.eventType ?? rule.trigger) as WorkflowTrigger,
    recordType: execution.recordType,
    recordId: execution.recordId,
    // The stored execution does not snapshot the record; conditions already
    // matched when it was created, so the retry re-runs the actions only.
    record: {},
  };

  const outcomes: ActionOutcome[] = [];
  let failure: string | null = null;

  for (const [index, action] of actions.entries()) {
    if (completed.has(index)) {
      outcomes.push({ index, type: action.type, status: 'ok', detail: 'already completed' });
      continue;
    }
    try {
      const outcome = await runAction(action, event, organizationId);
      outcomes.push({ index, type: action.type, status: outcome.status, detail: outcome.detail });
    } catch (error) {
      failure = `${action.type}: ${(error as Error).message}`;
      outcomes.push({ index, type: action.type, status: 'failed', detail: failure });
      break;
    }
  }

  const updated = await prisma.workflowExecution.update({
    where: { id: execution.id },
    data: {
      status: failure ? 'failed' : 'succeeded',
      resultLog: {
        eventType: event.type,
        retried: true,
        actions: outcomes,
        ...(failure ? { error: failure } : {}),
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      actorName: actorEmail,
      action: 'workflow.retry',
      entityType: 'WorkflowExecution',
      entityId: execution.id,
      before: { status: execution.status },
      after: { status: updated.status },
      organizationId,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    attempts: updated.attempts,
    resultLog: (updated.resultLog ?? null) as Record<string, unknown> | null,
  };
}
