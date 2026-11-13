import 'server-only';

/**
 * Trusted, synchronous workflow execution.
 *
 * Business-domain services call `emitWorkflowEvent` after an authorized write.
 * The producer accepts only a record reference and trigger kind; it derives the
 * actor and organization from the active session, checks the originating
 * resource permission, loads the record under that organization, and builds the
 * event snapshot itself. There is deliberately no public HTTP dispatch route.
 *
 * A unique WorkflowExecution key claims each rule/record/event version before
 * actions run. Actions that mutate business records require the affected
 * resource's permission, use tenant-scoped/optimistic writes, and write their
 * audit entry in the same transaction. Notifications use their own unique key
 * and are audited atomically, so retries can safely continue after a partial
 * failure.
 *
 * This phase still executes synchronously in-process (ADR-0002); there is no
 * durable queue/outbox. Per-rule/action failures are persisted when possible;
 * pre-dispatch infrastructure or authorization failures are logged and returned
 * as event-level failures so they cannot turn an already-committed business
 * write into an API error. A process crash or unavailable database can still
 * lose an event; durable redelivery remains an operational limitation.
 */

import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import {
  getUserPermissions,
  isInternalUserActive,
  requirePermission,
  requireOrganization,
  type AuthorizedUser,
} from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';

import {
  isEligibleOverdueRecord,
  isScheduledOverdueTrigger,
  scheduledEventVersion,
  scheduledRecordType,
  utcSchedulerDayStart,
} from '@/lib/automation/workflow-scheduler';
import {
  matchesWorkflowRule,
  resolveActionValue,
  workflowActionsSchema,
  workflowConditionsSchema,
  workflowDedupeKey,
  workflowProducerEventSchema,
  WORKFLOW_RECORD_TYPES,
  type WorkflowAction,
  type WorkflowEvent,
  type WorkflowRecordType,
  type WorkflowTrigger,
} from '@/lib/automation/rules';
import { PROJECT_STATUS_VALUES, TASK_STATUS_VALUES } from '@/lib/schemas/crm/project.schema';
import { ESTIMATE_MUTABLE_STATUSES } from '@/lib/schemas/crm/estimate.schema';
import { PROPOSAL_STATUSES } from '@/lib/schemas/crm/proposal.schema';
import { QUOTATION_STATUSES } from '@/lib/schemas/crm/quotation.schema';
import { isNotificationAllowed } from '@/lib/services/automation/notification-service';
import {
  categorizeWorkflowError,
  isWorkflowActionSnapshotRetrySafe,
  MAX_WORKFLOW_ATTEMPTS,
  nextWorkflowAttemptAt,
  shouldQuarantineWorkflowFailure,
  STALE_WORKFLOW_LEASE_MS,
  WORKFLOW_RECOVERY_BATCH_SIZE,
  type WorkflowErrorCategory,
} from '@/lib/automation/workflow-recovery';

interface WorkflowRecordDescriptor {
  delegate: string;
  readPermission: string;
  createPermissions: readonly string[];
  updatePermissions: readonly string[];
  canSetStatus?: boolean;
  softDelete?: boolean;
  updatedByField?: 'updatedBy';
  include?: Record<string, unknown>;
}

/**
 * These are the only model delegates an event producer may read. Explicit
 * allowlisting prevents model/delegate names from ever coming from a request.
 */
const EVENT_RECORDS: Record<WorkflowRecordType, WorkflowRecordDescriptor> = {
  Lead: {
    delegate: 'lead',
    readPermission: 'lead.read',
    createPermissions: ['lead.create'],
    updatePermissions: ['lead.update', 'lead.convert'],
    canSetStatus: true,
    softDelete: true,
  },
  Opportunity: {
    delegate: 'opportunity',
    readPermission: 'opportunity.read',
    createPermissions: ['opportunity.create', 'lead.convert'],
    updatePermissions: ['opportunity.update'],
    canSetStatus: true,
    softDelete: true,
    include: { stage: { select: { id: true, isWon: true, isLost: true } } },
  },
  Project: {
    delegate: 'project',
    readPermission: 'project.read',
    createPermissions: ['project.create'],
    updatePermissions: ['project.update'],
    canSetStatus: true,
    softDelete: true,
    updatedByField: 'updatedBy',
  },
  Task: {
    delegate: 'task',
    readPermission: 'project.read',
    // Tasks are managed under the existing project.update permission model.
    createPermissions: ['project.update'],
    updatePermissions: ['project.update'],
    canSetStatus: true,
    include: {
      project: {
        select: { id: true, name: true, organizationId: true, status: true, deletedAt: true },
      },
    },
  },
  Estimate: {
    delegate: 'estimate',
    readPermission: 'estimate.read',
    createPermissions: ['estimate.create'],
    updatePermissions: ['estimate.update'],
    canSetStatus: true,
  },
  Invoice: {
    delegate: 'invoice',
    readPermission: 'invoice.read',
    createPermissions: ['invoice.create'],
    updatePermissions: ['invoice.update'],
    // Invoice transitions stay in invoice-service/payment/aging procedures.
    softDelete: true,
  },
  Proposal: {
    delegate: 'proposal',
    readPermission: 'proposal.read',
    createPermissions: ['proposal.create'],
    updatePermissions: ['proposal.update'],
    canSetStatus: true,
    softDelete: true,
    updatedByField: 'updatedBy',
  },
  Quotation: {
    delegate: 'quotation',
    readPermission: 'quotation.read',
    createPermissions: ['quotation.create'],
    updatePermissions: ['quotation.update'],
    canSetStatus: true,
    softDelete: true,
    updatedByField: 'updatedBy',
  },
};

const UPDATE_PERMISSION_BY_RECORD: Partial<Record<WorkflowRecordType, string>> = {
  Lead: 'lead.update',
  Opportunity: 'opportunity.update',
  Project: 'project.update',
  Task: 'project.update',
  Estimate: 'estimate.update',
  Proposal: 'proposal.update',
  Quotation: 'quotation.update',
};

const SIMPLE_STATUS_VALUES: Partial<Record<WorkflowRecordType, readonly string[]>> = {
  Lead: [
    'new',
    'contacted',
    'qualified',
    'proposal',
    'negotiation',
    'closed-won',
    'closed-lost',
    'converted',
  ],
  Opportunity: ['open', 'won', 'lost', 'archived'],
  Project: PROJECT_STATUS_VALUES,
  Task: TASK_STATUS_VALUES,
  Estimate: ESTIMATE_MUTABLE_STATUSES,
  Proposal: PROPOSAL_STATUSES,
  Quotation: QUOTATION_STATUSES,
};

const STATUS_TRANSITIONS: Partial<Record<WorkflowRecordType, Record<string, readonly string[]>>> = {
  Estimate: {
    draft: ['sent', 'accepted', 'rejected', 'expired'],
    sent: ['accepted', 'rejected', 'expired'],
  },
  Proposal: {
    draft: ['sent', 'expired'],
    sent: ['accepted', 'rejected', 'expired'],
  },
  Quotation: {
    draft: ['sent', 'expired'],
    sent: ['accepted', 'rejected', 'expired'],
  },
};

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

async function markScheduledInvoiceOverdue(
  organizationId: string,
  invoiceId: string,
  actorId: string,
  actorEmail: string,
  dayStart: Date
): Promise<void> {
  await prisma.$transaction(async (tx: unknown) => {
    const database = tx as {
      invoice: { updateMany(args: unknown): Promise<{ count: number }> };
      auditLog: { create(args: unknown): Promise<unknown> };
    };
    const changed = await database.invoice.updateMany({
      where: {
        id: invoiceId,
        organizationId,
        deletedAt: null,
        status: 'sent',
        dueDate: { lt: dayStart },
      },
      data: { status: 'overdue' },
    });
    if (changed.count !== 1) return;

    await database.auditLog.create({
      data: {
        actorId,
        actorName: actorEmail || null,
        action: 'invoice.mark_overdue',
        entityType: 'Invoice',
        entityId: invoiceId,
        before: { status: 'sent' },
        after: { status: 'overdue' },
        metadata: { source: 'workflow_scheduler' },
        organizationId,
      },
    });
  });
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
  }

  const user = result.user as { role?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

async function requireOneOfPermissions(
  userId: string,
  organizationId: string,
  permissionCodes: readonly string[]
): Promise<void> {
  const permissions = await getUserPermissions(userId, organizationId);
  if (!permissionCodes.some((permissionCode) => permissions.has(permissionCode))) {
    throw codedError('Forbidden: insufficient permissions', 403);
  }
}

function recordLookupWhere(
  recordType: WorkflowRecordType,
  recordId: string,
  organizationId: string
) {
  const descriptor = EVENT_RECORDS[recordType];
  return {
    id: recordId,
    organizationId,
    ...(descriptor.softDelete ? { deletedAt: null } : {}),
    ...(recordType === 'Task' ? { project: { is: { organizationId, deletedAt: null } } } : {}),
  };
}

async function loadWorkflowRecord(
  recordType: WorkflowRecordType,
  recordId: string,
  organizationId: string,
  client: unknown = prisma
): Promise<Record<string, unknown> | null> {
  const descriptor = EVENT_RECORDS[recordType];
  const delegates = client as Record<
    string,
    { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> }
  >;
  const delegate = delegates[descriptor.delegate];
  return delegate.findFirst({
    where: recordLookupWhere(recordType, recordId, organizationId),
    ...(descriptor.include ? { include: descriptor.include } : {}),
  });
}

function recordVersion(
  recordType: WorkflowRecordType,
  record: Record<string, unknown>,
  eventType?: WorkflowTrigger
): string {
  const createdAt = record.createdAt;
  if (eventType === 'record.created' && createdAt !== null && createdAt !== undefined) {
    // A create event belongs to the immutable creation, not the row's latest
    // mutable state. Replays stay deduped even if the record changed later.
    const createdAtVersion =
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
    return `created:${createdAtVersion}`;
  }

  const timestamp = record.updatedAt ?? createdAt ?? '';
  const relationFields = new Set(Object.keys(EVENT_RECORDS[recordType].include ?? {}));
  const scalarSnapshot = Object.fromEntries(
    Object.entries(record).filter(([key]) => !relationFields.has(key))
  );
  const serialized = JSON.stringify(scalarSnapshot, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value
  );
  const digest = createHash('sha256')
    .update(serialized ?? '')
    .digest('hex');
  return `${timestamp instanceof Date ? timestamp.toISOString() : String(timestamp)}:${digest}`;
}

export interface WorkflowEventResult {
  eventType: WorkflowTrigger;
  recordType: WorkflowRecordType;
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

interface ActionContext {
  actor: AuthorizedUser;
  event: WorkflowEvent;
  ruleId: string;
  executionId: string;
  claimToken: string;
  actionIndex: number;
}

interface DbDelegate {
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  findMany?: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
  create?: (args: unknown) => Promise<Record<string, unknown>>;
}

function getDelegate(client: unknown, delegateName: string): DbDelegate {
  return (client as Record<string, DbDelegate>)[delegateName];
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

function notificationDedupeKey(context: ActionContext): string {
  return JSON.stringify([
    'workflow',
    context.ruleId,
    context.actionIndex,
    workflowDedupeKey(context.event),
  ]);
}

async function createWorkflowNotificationOnce({
  userId,
  payload,
  context,
}: {
  userId: string;
  payload: Record<string, unknown>;
  context: ActionContext;
}): Promise<boolean> {
  const dedupeKey = notificationDedupeKey(context);
  try {
    return await prisma.$transaction(async (tx: unknown) => {
      const txDelegate = tx as Record<string, DbDelegate>;
      const existing = await txDelegate.notification.findFirst({
        where: {
          organizationId: context.actor.organizationId,
          userId,
          type: 'workflow',
          dedupeKey,
        },
        select: { id: true },
      });
      if (existing) return false;

      const notification = await txDelegate.notification.create!({
        data: {
          organizationId: context.actor.organizationId,
          userId,
          type: 'workflow',
          channel: 'in_app',
          payload,
          dedupeKey,
          sentAt: new Date(),
        },
      });

      await txDelegate.auditLog.create!({
        data: {
          actorId: context.actor.userId,
          actorName: context.actor.email,
          action: 'workflow.notification',
          entityType: 'Notification',
          entityId: String(notification.id),
          after: { userId, type: 'workflow', channel: 'in_app' },
          metadata: {
            workflowRuleId: context.ruleId,
            workflowExecutionId: context.executionId,
            actionIndex: context.actionIndex,
          },
          organizationId: context.actor.organizationId,
        },
      });
      return true;
    });
  } catch (error) {
    // The unique index arbitrates simultaneous retries/deliveries.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

async function runStatusAction(
  action: Extract<WorkflowAction, { type: 'set_status' }>,
  context: ActionContext
) {
  const { actor, event } = context;
  const descriptor = EVENT_RECORDS[event.recordType];
  const permission = UPDATE_PERMISSION_BY_RECORD[event.recordType];
  if (!descriptor.canSetStatus || !permission) {
    return {
      status: 'skipped' as const,
      detail: `set_status is not supported for ${event.recordType}; invoice status is managed by finance services`,
    };
  }

  await requirePermission(actor.userId, actor.organizationId, permission);

  const validValues = SIMPLE_STATUS_VALUES[event.recordType];
  if (validValues && !validValues.includes(action.status)) {
    return {
      status: 'skipped' as const,
      detail: `status '${action.status}' is not supported for ${event.recordType}`,
    };
  }
  if (
    (event.recordType === 'Lead' || event.recordType === 'Opportunity') &&
    action.status.length > 50
  ) {
    return { status: 'skipped' as const, detail: `status is too long for ${event.recordType}` };
  }

  const changed = await prisma.$transaction(async (tx: unknown) => {
    const delegate = getDelegate(tx, descriptor.delegate);
    const current = await delegate.findFirst({
      where: recordLookupWhere(event.recordType, event.recordId, actor.organizationId),
      ...(descriptor.include ? { include: descriptor.include } : {}),
    });
    if (!current) return { kind: 'missing' as const };

    const currentStatus = String(current.status ?? '');
    if (!currentStatus) return { kind: 'invalid' as const, detail: 'record has no status field' };
    if (currentStatus === action.status) return { kind: 'unchanged' as const };
    if (
      event.recordType === 'Lead' &&
      (currentStatus === 'converted' || action.status === 'converted')
    ) {
      return {
        kind: 'invalid' as const,
        detail: 'lead conversion must use the lead conversion service',
      };
    }

    const allowedTransitions = STATUS_TRANSITIONS[event.recordType]?.[currentStatus];
    if (STATUS_TRANSITIONS[event.recordType] && !allowedTransitions?.includes(action.status)) {
      return {
        kind: 'invalid' as const,
        detail: `status transition from '${currentStatus}' to '${action.status}' is not allowed for ${event.recordType}`,
      };
    }

    if (event.recordType === 'Opportunity') {
      const stage = current.stage as { isWon?: boolean; isLost?: boolean } | null | undefined;
      if (
        (stage?.isWon && action.status !== 'won') ||
        (stage?.isLost && action.status !== 'lost')
      ) {
        return {
          kind: 'invalid' as const,
          detail: 'status change conflicts with the opportunity’s current won/lost stage',
        };
      }
    }

    const result = await delegate.updateMany!({
      where: {
        ...recordLookupWhere(event.recordType, event.recordId, actor.organizationId),
        status: currentStatus,
      },
      data: {
        status: action.status,
        ...(descriptor.updatedByField ? { [descriptor.updatedByField]: actor.userId } : {}),
      },
    });
    if (result.count !== 1) {
      throw codedError('Record changed concurrently; retry the workflow execution', 409);
    }

    await getDelegate(tx, 'auditLog').create!({
      data: {
        actorId: actor.userId,
        actorName: actor.email,
        action: 'workflow.set_status',
        entityType: event.recordType,
        entityId: event.recordId,
        before: { status: currentStatus },
        after: { status: action.status },
        metadata: {
          workflowRuleId: context.ruleId,
          workflowExecutionId: context.executionId,
          actionIndex: context.actionIndex,
          eventType: event.type,
        },
        organizationId: actor.organizationId,
      },
    });

    return { kind: 'updated' as const };
  });

  if (changed.kind === 'missing') {
    return {
      status: 'skipped' as const,
      detail: `${event.recordType} ${event.recordId} is not available in this organization`,
    };
  }
  if (changed.kind === 'unchanged') {
    return { status: 'skipped' as const, detail: `record already has status '${action.status}'` };
  }
  if (changed.kind === 'invalid') {
    return { status: 'skipped' as const, detail: changed.detail };
  }
  return { status: 'ok' as const, detail: `status set to ${action.status}` };
}

async function runAssignOwnerAction(
  action: Extract<WorkflowAction, { type: 'assign_record_owner' }>,
  context: ActionContext
) {
  const { actor, event } = context;
  if (event.recordType !== 'Task') {
    return {
      status: 'skipped' as const,
      detail: `assign_record_owner is not supported for ${event.recordType}; only Task assignment is available`,
    };
  }

  await requirePermission(actor.userId, actor.organizationId, 'project.update');
  const userId = resolveActionValue(action.userId, event.record);
  if (!userId) return { status: 'skipped' as const, detail: 'owner did not resolve' };

  const target = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!target) {
    return { status: 'skipped' as const, detail: 'assignee is not a member of this organization' };
  }

  const changed = await prisma.$transaction(async (tx: unknown) => {
    const task = getDelegate(tx, 'task');
    const existing = await task.findFirst({
      where: recordLookupWhere('Task', event.recordId, actor.organizationId),
      select: { id: true, assigneeId: true },
    });
    if (!existing) return { kind: 'missing' as const };
    const currentAssignee = (existing.assigneeId as string | null) ?? null;
    if (currentAssignee === userId) return { kind: 'unchanged' as const };

    const result = await task.updateMany!({
      where: {
        ...recordLookupWhere('Task', event.recordId, actor.organizationId),
        assigneeId: currentAssignee,
      },
      data: { assigneeId: userId },
    });
    if (result.count !== 1) {
      throw codedError('Task changed concurrently; retry the workflow execution', 409);
    }

    await getDelegate(tx, 'auditLog').create!({
      data: {
        actorId: actor.userId,
        actorName: actor.email,
        action: 'workflow.assign_record_owner',
        entityType: 'Task',
        entityId: event.recordId,
        before: { assigneeId: currentAssignee },
        after: { assigneeId: userId },
        metadata: {
          workflowRuleId: context.ruleId,
          workflowExecutionId: context.executionId,
          actionIndex: context.actionIndex,
          eventType: event.type,
        },
        organizationId: actor.organizationId,
      },
    });
    return { kind: 'updated' as const };
  });

  if (changed.kind === 'missing') {
    return {
      status: 'skipped' as const,
      detail: `task ${event.recordId} is not available in this organization`,
    };
  }
  if (changed.kind === 'unchanged') {
    return { status: 'skipped' as const, detail: `task is already assigned to ${userId}` };
  }
  return { status: 'ok' as const, detail: `assigned task to ${userId}` };
}

/** Run one validated action and return a safe execution-history detail. */
async function runAction(action: WorkflowAction, context: ActionContext) {
  const { actor, event } = context;
  switch (action.type) {
    case 'log':
      return { status: 'ok' as const, detail: action.message };

    case 'notify_user': {
      const userId = resolveActionValue(action.userId, event.record);
      if (!userId)
        return { status: 'skipped' as const, detail: 'notification target did not resolve' };
      if (userId !== actor.userId) {
        await requirePermission(actor.userId, actor.organizationId, 'user.read');
      }
      await requirePermission(actor.userId, actor.organizationId, 'notification.update');

      const target = await prisma.user.findFirst({
        where: { id: userId, organizationId: actor.organizationId },
        select: { id: true },
      });
      if (!target)
        return {
          status: 'skipped' as const,
          detail: 'notification target is not a member of this organization',
        };

      const allowed = await isNotificationAllowed(
        actor.organizationId,
        userId,
        'workflow',
        'in_app'
      );
      if (!allowed)
        return { status: 'skipped' as const, detail: 'recipient muted workflow notifications' };

      const created = await createWorkflowNotificationOnce({
        userId,
        context,
        payload: {
          title: action.title,
          message: action.message ?? null,
          recordType: event.recordType,
          recordId: event.recordId,
          ruleAction: action.label ?? null,
        },
      });
      return created
        ? { status: 'ok' as const, detail: `notified user ${userId}` }
        : {
            status: 'skipped' as const,
            detail: 'notification already delivered for this event action',
          };
    }

    case 'notify_role': {
      await requirePermission(actor.userId, actor.organizationId, 'notification.update');
      await requirePermission(actor.userId, actor.organizationId, 'user.read');
      const role = await prisma.role.findFirst({
        where: { organizationId: actor.organizationId, name: action.roleName },
        select: { id: true },
      });
      if (!role)
        return { status: 'skipped' as const, detail: `role ${action.roleName} no longer exists` };

      const members = await prisma.userRole.findMany({
        where: { organizationId: actor.organizationId, roleId: role.id },
        select: { userId: true },
      });
      if (members.length === 0)
        return { status: 'skipped' as const, detail: `role ${action.roleName} has no members` };

      let delivered = 0;
      for (const member of members as Array<{ userId: string }>) {
        const allowed = await isNotificationAllowed(
          actor.organizationId,
          member.userId,
          'workflow',
          'in_app'
        );
        if (!allowed) continue;
        const created = await createWorkflowNotificationOnce({
          userId: member.userId,
          context,
          payload: {
            title: action.title,
            message: action.message ?? null,
            recordType: event.recordType,
            recordId: event.recordId,
            ruleAction: action.label ?? null,
            role: action.roleName,
          },
        });
        if (created) delivered += 1;
      }
      return {
        status: 'ok' as const,
        detail: `notified ${delivered} member(s) of ${action.roleName}`,
      };
    }

    case 'assign_record_owner':
      return runAssignOwnerAction(action, context);

    case 'set_status':
      return runStatusAction(action, context);

    default:
      return { status: 'skipped' as const, detail: 'unsupported action type' };
  }
}

function workflowActionDefinitionsMatch(current: unknown, snapshot: unknown): boolean {
  const currentActions = workflowActionsSchema.safeParse(current);
  const snapshotActions = workflowActionsSchema.safeParse(snapshot);
  return (
    currentActions.success &&
    snapshotActions.success &&
    JSON.stringify(currentActions.data) === JSON.stringify(snapshotActions.data)
  );
}

function eventMetadata(event: WorkflowEvent, actor: AuthorizedUser) {
  return {
    eventType: event.type,
    eventVersion: event.eventVersion ?? null,
    previousStatus: event.previousStatus ?? null,
    source: event.source ?? 'business-service',
    actorId: actor.userId,
  };
}

async function persistExecutionCheckpoint({
  executionId,
  organizationId,
  claimToken,
  resultLog,
}: {
  executionId: string;
  organizationId: string;
  claimToken: string;
  resultLog: Record<string, unknown>;
}): Promise<boolean> {
  const updated = await prisma.workflowExecution.updateMany({
    where: { id: executionId, organizationId, status: 'running', claimToken },
    data: { resultLog, lastAttemptAt: new Date() },
  });
  return updated.count === 1;
}

async function finalizeExecutionAttempt({
  executionId,
  organizationId,
  claimToken,
  attempts,
  resultLog,
  failureCategory,
  quarantine,
  auditAction,
}: {
  executionId: string;
  organizationId: string;
  claimToken: string;
  attempts: number;
  resultLog: Record<string, unknown>;
  failureCategory: WorkflowErrorCategory | null;
  quarantine: boolean;
  auditAction?: 'workflow.scheduled_execution' | 'workflow.recovery_retry' | 'workflow.retry';
}): Promise<Record<string, unknown> | null> {
  const now = new Date();
  const status = !failureCategory
    ? 'succeeded'
    : quarantine
      ? 'quarantined'
      : attempts >= MAX_WORKFLOW_ATTEMPTS
        ? 'terminal_failed'
        : 'failed';
  const terminal = status === 'terminal_failed' || status === 'quarantined';
  const nextAttemptAt = status === 'failed' ? nextWorkflowAttemptAt(attempts, now) : null;
  const persistedLog: Record<string, unknown> = {
    ...resultLog,
    ...(failureCategory ? { errorCategory: failureCategory } : {}),
    ...(failureCategory ? { error: `Workflow attempt stopped (${failureCategory})` } : {}),
    ...(status === 'terminal_failed' ? { terminalReason: 'attempt_limit' } : {}),
    ...(status === 'quarantined' ? { terminalReason: failureCategory } : {}),
  };

  try {
    return await prisma.$transaction(async (tx: unknown) => {
      const executionDelegate = getDelegate(tx, 'workflowExecution');
      const changed = await executionDelegate.updateMany!({
        where: { id: executionId, organizationId, status: 'running', claimToken },
        data: {
          status,
          resultLog: persistedLog,
          errorCategory: failureCategory,
          nextAttemptAt,
          terminalAt: terminal ? now : null,
          claimToken: null,
        },
      });
      if (changed.count !== 1) return null;

      const updated = await executionDelegate.findFirst({
        where: { id: executionId, organizationId },
      });
      if (!updated) return null;

      if (auditAction) {
        await getDelegate(tx, 'auditLog').create!({
          data: {
            actorId: null,
            actorName: null,
            action: auditAction,
            entityType: 'WorkflowExecution',
            entityId: executionId,
            after: { status, attempts, errorCategory: failureCategory },
            metadata: {
              source: persistedLog.source ?? 'workflow_recovery',
              eventType: persistedLog.eventType ?? null,
            },
            organizationId,
          },
        });
      }
      return updated;
    });
  } catch (error) {
    const details = error as { code?: unknown } | null;
    console.error('[automation] execution finalizer failed', {
      errorCode: typeof details?.code === 'string' ? details.code.slice(0, 32) : undefined,
    });
    throw error;
  }
}

async function finalizeUnclaimedRecoveryState({
  candidate,
  priorStatus,
  staleBefore,
  now,
  status,
  category,
  resultLog,
}: {
  candidate: { id: string; organizationId: string };
  priorStatus: string;
  staleBefore: Date;
  now: Date;
  status: 'terminal_failed' | 'quarantined';
  category: WorkflowErrorCategory;
  resultLog: Record<string, unknown>;
}): Promise<boolean> {
  return prisma.$transaction(async (tx: unknown) => {
    const changed = await getDelegate(tx, 'workflowExecution').updateMany!({
      where: {
        id: candidate.id,
        organizationId: candidate.organizationId,
        status: priorStatus,
        ...(priorStatus === 'running'
          ? { lastAttemptAt: { lte: staleBefore } }
          : { nextAttemptAt: { lte: now } }),
      },
      data: {
        status,
        terminalAt: now,
        nextAttemptAt: null,
        claimToken: null,
        errorCategory: category,
        resultLog: { ...resultLog, errorCategory: category, terminalReason: status },
      },
    });
    if (changed.count !== 1) return false;
    await getDelegate(tx, 'auditLog').create!({
      data: {
        actorId: null,
        actorName: null,
        action: 'workflow.recovery_retry',
        entityType: 'WorkflowExecution',
        entityId: candidate.id,
        after: { status, errorCategory: category },
        metadata: { source: 'workflow_recovery' },
        organizationId: candidate.organizationId,
      },
    });
    return true;
  });
}

async function dispatchWorkflowEvent(
  event: WorkflowEvent,
  actor: AuthorizedUser,
  onlyRuleId?: string
): Promise<WorkflowEventResult> {
  const rules = await prisma.workflowRule.findMany({
    where: {
      organizationId: actor.organizationId,
      enabled: true,
      deletedAt: null,
      trigger: event.type,
      ...(onlyRuleId ? { id: onlyRuleId } : {}),
    },
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
    actions: unknown;
  }>) {
    const parsedConditions = workflowConditionsSchema.safeParse(rule.conditions ?? {});
    const parsedActions = workflowActionsSchema.safeParse(rule.actions ?? {});
    const conditionsInvalid = !parsedConditions.success;
    const actionsInvalid = !parsedActions.success;

    if (!conditionsInvalid && !matchesWorkflowRule(rule, event)) continue;
    result.matched += 1;

    let execution: Record<string, unknown>;
    const claimToken = randomUUID();
    try {
      execution = await prisma.workflowExecution.create({
        data: {
          organizationId: actor.organizationId,
          ruleId: rule.id,
          recordType: event.recordType,
          recordId: event.recordId,
          status: 'running',
          dedupeKey,
          attempts: 1,
          lastAttemptAt: new Date(),
          claimToken,
          resultLog: {
            ...eventMetadata(event, actor),
            actionDefinitions: parsedActions.success ? parsedActions.data : rule.actions,
            actions: [],
          },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (event.source === 'scheduler') {
          const claimedExecution = await prisma.workflowExecution.findFirst({
            where: {
              ruleId: rule.id,
              recordType: event.recordType,
              recordId: event.recordId,
              dedupeKey,
            },
            select: { status: true },
          });
          if (claimedExecution?.status === 'failed') result.failed += 1;
          else result.skipped += 1;
        } else {
          result.skipped += 1;
        }
        continue;
      }
      const details = error as { code?: unknown } | null;
      console.error('[automation] could not claim workflow execution', {
        organizationId: actor.organizationId,
        ruleId: rule.id,
        recordType: event.recordType,
        recordId: event.recordId,
        errorCode: typeof details?.code === 'string' ? details.code.slice(0, 32) : undefined,
      });
      result.failed += 1;
      continue;
    }

    const executionId = String(execution.id);
    let outcomes: ActionOutcome[] = [];
    let failure: unknown = null;
    if (conditionsInvalid || actionsInvalid) {
      failure = codedError('Stored workflow definition failed schema validation', 400);
      outcomes = [
        { index: -1, type: 'validation', status: 'failed', detail: 'invalid workflow definition' },
      ];
    } else {
      for (const [index, action] of parsedActions.data.list.entries()) {
        try {
          const outcome = await runAction(action, {
            actor,
            event,
            ruleId: rule.id,
            executionId,
            claimToken,
            actionIndex: index,
          });
          outcomes.push({
            index,
            type: action.type,
            status: outcome.status,
            detail: outcome.detail,
          });
          if (
            !(await persistExecutionCheckpoint({
              executionId,
              organizationId: actor.organizationId,
              claimToken,
              resultLog: {
                ...eventMetadata(event, actor),
                actionDefinitions: parsedActions.data,
                actions: outcomes,
              },
            }))
          )
            break;
        } catch (error) {
          failure = error;
          outcomes.push({ index, type: action.type, status: 'failed', detail: 'action failed' });
          break;
        }
      }
    }

    const failureCategory = failure ? categorizeWorkflowError(failure) : null;
    const quarantine = Boolean(
      failureCategory &&
      shouldQuarantineWorkflowFailure(
        failureCategory,
        parsedActions.success ? parsedActions.data : rule.actions
      )
    );
    const finalResultLog = {
      ...eventMetadata(event, actor),
      actionDefinitions: parsedActions.success ? parsedActions.data : rule.actions,
      actions: outcomes,
    };
    const updated = await finalizeExecutionAttempt({
      executionId,
      organizationId: actor.organizationId,
      claimToken,
      attempts: 1,
      resultLog: finalResultLog,
      failureCategory,
      quarantine,
    });
    if (!updated) {
      result.skipped += 1;
      continue;
    }

    if (event.source === 'scheduler') {
      try {
        await prisma.auditLog.create({
          data: {
            actorId: actor.userId,
            actorName: actor.email,
            action: 'workflow.scheduled_execution',
            entityType: 'WorkflowExecution',
            entityId: executionId,
            before: { status: 'running' },
            after: { status: updated.status },
            metadata: {
              ruleId: rule.id,
              eventType: event.type,
              recordType: event.recordType,
              recordId: event.recordId,
              eventVersion: event.eventVersion ?? null,
              actions: outcomes,
            },
            organizationId: actor.organizationId,
          },
        });
      } catch (error) {
        console.error('[automation] could not persist scheduled execution audit', {
          organizationId: actor.organizationId,
          ruleId: rule.id,
          executionId,
          errorCode: (error as { code?: string } | null)?.code,
        });
      }
    }

    if (updated.status !== 'succeeded') result.failed += 1;
    else result.executed += 1;
    result.executions.push({
      id: String(updated.id),
      organizationId: String(updated.organizationId),
      ruleId: String(updated.ruleId),
      recordType: String(updated.recordType),
      recordId: String(updated.recordId),
      status: String(updated.status),
      resultLog: (updated.resultLog ?? null) as Record<string, unknown> | null,
      attempts: Number(updated.attempts),
      lastAttemptAt: (updated.lastAttemptAt as Date | null) ?? null,
      createdAt: updated.createdAt as Date,
    });
  }

  return result;
}

/**
 * The only event entry point used by application code. Callers can name a
 * trigger and an existing record id, but cannot supply a record snapshot, actor,
 * organization, or dedupe key. The public /automation/events route stays 410.
 */
function failedEventResult(event: {
  type: WorkflowTrigger;
  recordType: WorkflowRecordType;
  recordId: string;
}): WorkflowEventResult {
  return {
    eventType: event.type,
    recordType: event.recordType,
    recordId: event.recordId,
    matched: 0,
    executed: 0,
    skipped: 0,
    failed: 1,
    executions: [],
  };
}

function logEventEmissionFailure(
  stage: 'authorization-or-snapshot' | 'dispatch',
  event: { type: WorkflowTrigger; recordType: WorkflowRecordType; recordId: string },
  error: unknown
): void {
  const details = error as { name?: unknown; statusCode?: unknown; code?: unknown } | null;
  console.error('[automation] trusted workflow event emission failed', {
    stage,
    eventType: event.type,
    recordType: event.recordType,
    recordId: event.recordId,
    errorName: typeof details?.name === 'string' ? details.name : 'UnknownError',
    errorCode:
      typeof details?.code === 'string'
        ? details.code.slice(0, 32)
        : typeof details?.statusCode === 'number'
          ? details.statusCode
          : undefined,
  });
}

function skippedScheduledResult(
  type: WorkflowTrigger,
  recordType: WorkflowRecordType,
  recordId: string
): WorkflowEventResult {
  return {
    eventType: type,
    recordType,
    recordId,
    matched: 0,
    executed: 0,
    skipped: 1,
    failed: 0,
    executions: [],
  };
}

/** Internal scheduler path: owner-authorized, tenant-scoped, overdue-only dispatch. */
export async function emitScheduledWorkflowEvent(
  ruleId: string,
  organizationId: string,
  recordId: string,
  trigger: WorkflowTrigger,
  scheduledAt: Date
): Promise<WorkflowEventResult> {
  if (!isScheduledOverdueTrigger(trigger)) {
    throw codedError('Unsupported scheduled workflow trigger', 400);
  }
  const type = trigger;
  const recordType = scheduledRecordType(type);
  const rule = await prisma.workflowRule.findFirst({
    where: { id: ruleId, organizationId, trigger: type, enabled: true },
    select: { id: true, createdBy: true },
  });
  if (!rule || !rule.createdBy) {
    return skippedScheduledResult(type, recordType, recordId);
  }
  const membership = await prisma.user.findFirst({
    where: {
      id: rule.createdBy,
      organizationId,
      status: 'active',
      userType: 'internal',
    },
    select: { id: true, email: true, role: true },
  });
  if (!membership) return skippedScheduledResult(type, recordType, recordId);

  const { organizationId: activeOrganizationId } = await requireOrganization(membership.id);
  if (activeOrganizationId !== organizationId) {
    return skippedScheduledResult(type, recordType, recordId);
  }
  await requirePermission(membership.id, organizationId, 'workflow.execute');
  await requirePermission(membership.id, organizationId, EVENT_RECORDS[recordType].readPermission);
  if (recordType === 'Invoice') {
    await requirePermission(membership.id, organizationId, 'invoice.update');
  }

  let record = await loadWorkflowRecord(recordType, recordId, organizationId);
  if (!record) return skippedScheduledResult(type, recordType, recordId);
  const dayStart = utcSchedulerDayStart(scheduledAt);
  if (!isEligibleOverdueRecord(type, record, dayStart)) {
    return skippedScheduledResult(type, recordType, recordId);
  }
  if (type === 'invoice.overdue') {
    await markScheduledInvoiceOverdue(
      organizationId,
      recordId,
      membership.id,
      membership.email ?? '',
      dayStart
    );
    record = await loadWorkflowRecord(recordType, recordId, organizationId);
    if (!record || !isEligibleOverdueRecord(type, record, dayStart)) {
      return skippedScheduledResult(type, recordType, recordId);
    }
  }

  const dueDate = new Date(String(type === 'project.overdue' ? record.endDate : record.dueDate));
  const event: WorkflowEvent = {
    type,
    recordType,
    recordId,
    record,
    eventVersion: scheduledEventVersion(dueDate, scheduledAt),
    source: 'scheduler',
  };
  return dispatchWorkflowEvent(
    event,
    {
      userId: membership.id,
      organizationId,
      email: membership.email ?? '',
      role: membership.role ?? 'employee',
    },
    rule.id
  );
}

export async function emitWorkflowEvents(inputs: unknown): Promise<WorkflowEventResult[]> {
  const parsed = workflowProducerEventSchema.array().min(1).max(2).safeParse(inputs);
  if (!parsed.success) {
    const error = codedError('Invalid server workflow event reference', 400) as Error & {
      issues?: unknown;
    };
    error.issues = parsed.error.issues;
    throw error;
  }
  if (parsed.data.some((event) => isScheduledOverdueTrigger(event.type))) {
    throw codedError('Overdue triggers are emitted only by the trusted scheduler', 400);
  }

  const [{ recordType, recordId }] = parsed.data;
  if (!WORKFLOW_RECORD_TYPES.includes(recordType))
    throw codedError('Unsupported workflow record type', 400);
  if (parsed.data.some((event) => event.recordType !== recordType || event.recordId !== recordId)) {
    throw codedError('A workflow event batch must refer to one record', 400);
  }
  if (new Set(parsed.data.map((event) => event.type)).size !== parsed.data.length) {
    throw codedError('A workflow event batch cannot contain duplicate trigger types', 400);
  }

  try {
    const actor = await getAuthorizedUser();
    const descriptor = EVENT_RECORDS[recordType];
    for (const event of parsed.data) {
      const permissionCodes =
        event.type === 'record.created'
          ? descriptor.createPermissions
          : descriptor.updatePermissions;
      await requireOneOfPermissions(actor.userId, actor.organizationId, permissionCodes);
    }

    const record = await loadWorkflowRecord(recordType, recordId, actor.organizationId);
    if (!record) throw codedError('Record not found', 404);
    const events: WorkflowEvent[] = parsed.data.map((eventInput) => {
      if (eventInput.type === 'record.status_changed') {
        const currentStatus = String(record.status ?? '');
        if (!currentStatus || currentStatus === eventInput.previousStatus) {
          throw codedError('Status-change event does not match a persisted status change', 400);
        }
      }
      return {
        type: eventInput.type,
        recordType: eventInput.recordType,
        recordId: eventInput.recordId,
        record,
        ...(eventInput.type === 'record.status_changed'
          ? { previousStatus: eventInput.previousStatus }
          : {}),
        eventVersion: recordVersion(recordType, record, eventInput.type),
      };
    });

    // Keep the exact same persisted snapshot for sibling events from one
    // business write; an earlier workflow action must not rewrite the later
    // event payload. Isolate operational failures per event in the batch.
    const results: WorkflowEventResult[] = [];
    for (const event of events) {
      try {
        results.push(await dispatchWorkflowEvent(event, actor));
      } catch (error) {
        logEventEmissionFailure('dispatch', event, error);
        results.push(failedEventResult(event));
      }
    }
    return results;
  } catch (error) {
    // Domain writes have already committed by the time producers are called.
    // Preserve the business API result if auth, snapshot loading, or dispatch
    // infrastructure fails. The failure is observable in server logs, but a
    // durable outbox/recovery worker is still needed to guarantee redelivery.
    for (const event of parsed.data) {
      logEventEmissionFailure('authorization-or-snapshot', event, error);
    }
    return parsed.data.map(failedEventResult);
  }
}

/** Emit one event when a domain write has a single applicable trigger. */
export async function emitWorkflowEvent(input: unknown): Promise<WorkflowEventResult> {
  const [result] = await emitWorkflowEvents([input]);
  return result;
}

/**
 * Recover a bounded batch of due failures and expired leases. Every claim is
 * fenced by a fresh token; all lookups and writes are tenant-scoped.
 */
export async function recoverWorkflowExecutionsForScheduler(now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_WORKFLOW_LEASE_MS);
  const candidates = await prisma.workflowExecution.findMany({
    where: {
      resultLog: { path: ['source'], equals: 'scheduler' },
      OR: [
        { status: 'failed', nextAttemptAt: { lte: now } },
        { status: 'running', lastAttemptAt: { lte: staleBefore } },
      ],
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: WORKFLOW_RECOVERY_BATCH_SIZE,
  });
  const totals = { scanned: candidates.length, retried: 0, quarantined: 0, terminal: 0, failed: 0 };

  for (const candidate of candidates) {
    const previousLog = (
      candidate.resultLog &&
      typeof candidate.resultLog === 'object' &&
      !Array.isArray(candidate.resultLog)
        ? candidate.resultLog
        : {}
    ) as Record<string, unknown>;
    const snapshot = previousLog.actionDefinitions;
    const parsedActions = workflowActionsSchema.safeParse(snapshot);
    const previousActions = Array.isArray(previousLog.actions)
      ? (previousLog.actions as ActionOutcome[])
      : [];
    const safe = parsedActions.success && isWorkflowActionSnapshotRetrySafe(snapshot);
    const token = randomUUID();
    const priorStatus = candidate.status;
    if (Number(candidate.attempts) >= MAX_WORKFLOW_ATTEMPTS || !safe) {
      const terminalStatus = !safe ? 'quarantined' : 'terminal_failed';
      const category: WorkflowErrorCategory = safe ? 'attempt_limit' : 'unsafe_action';
      const changed = await finalizeUnclaimedRecoveryState({
        candidate: { id: candidate.id, organizationId: candidate.organizationId },
        priorStatus,
        staleBefore,
        now,
        status: terminalStatus,
        category,
        resultLog: previousLog,
      });
      if (changed) {
        if (terminalStatus === 'quarantined') totals.quarantined += 1;
        else totals.terminal += 1;
      }
      continue;
    }

    const claim = await prisma.workflowExecution.updateMany({
      where: {
        id: candidate.id,
        organizationId: candidate.organizationId,
        status: priorStatus,
        ...(priorStatus === 'running'
          ? { lastAttemptAt: { lte: staleBefore } }
          : { nextAttemptAt: { lte: now } }),
      },
      data: {
        status: 'running',
        attempts: { increment: 1 },
        lastAttemptAt: now,
        nextAttemptAt: null,
        claimToken: token,
      },
    });
    if (!claim.count) continue;
    const attempts = Number(candidate.attempts) + 1;
    try {
      const rule = await prisma.workflowRule.findFirst({
        where: { id: candidate.ruleId, organizationId: candidate.organizationId },
      });
      const ruleDefinitionChanged = Boolean(
        rule &&
        ((typeof previousLog.eventType === 'string' && rule.trigger !== previousLog.eventType) ||
          !workflowActionDefinitionsMatch(rule.actions, snapshot))
      );
      const ownerId = typeof previousLog.actorId === 'string' ? previousLog.actorId : '';
      const owner = ownerId
        ? await prisma.user.findFirst({
            where: {
              id: ownerId,
              organizationId: candidate.organizationId,
              status: 'active',
              userType: 'internal',
            },
          })
        : null;
      if (
        !rule ||
        !rule.enabled ||
        rule.deletedAt ||
        ruleDefinitionChanged ||
        !owner ||
        rule.createdBy !== ownerId ||
        !isInternalUserActive(owner)
      ) {
        const category: WorkflowErrorCategory =
          !rule || !rule.enabled || rule.deletedAt
            ? 'rule_disabled'
            : ruleDefinitionChanged || rule.createdBy !== ownerId
              ? 'rule_changed'
              : 'authorization';
        await finalizeExecutionAttempt({
          executionId: candidate.id,
          organizationId: candidate.organizationId,
          claimToken: token,
          attempts,
          resultLog: { ...previousLog, actions: previousActions },
          failureCategory: category,
          quarantine: true,
          auditAction: 'workflow.recovery_retry',
        });
        totals.quarantined += 1;
        continue;
      }
      const actor: AuthorizedUser = {
        userId: owner.id,
        organizationId: candidate.organizationId,
        email: typeof owner.email === 'string' ? owner.email : '',
        role: '',
      };
      const recordType = WORKFLOW_RECORD_TYPES.find((type) => type === candidate.recordType);
      if (!recordType) throw codedError('Unsupported workflow record type', 400);
      await requirePermission(actor.userId, actor.organizationId, 'workflow.execute');
      await requirePermission(
        actor.userId,
        actor.organizationId,
        EVENT_RECORDS[recordType].readPermission
      );
      const eventType =
        typeof previousLog.eventType === 'string'
          ? (previousLog.eventType as WorkflowTrigger)
          : (rule.trigger as WorkflowTrigger);
      const parsedEvent = workflowProducerEventSchema.safeParse({
        type: eventType,
        recordType,
        recordId: candidate.recordId,
        ...(eventType === 'record.status_changed'
          ? { previousStatus: previousLog.previousStatus ?? null }
          : {}),
      });
      if (!parsedEvent.success) throw codedError('Stored workflow event is invalid', 400);
      const record = await loadWorkflowRecord(
        recordType,
        candidate.recordId,
        candidate.organizationId
      );
      if (!record) throw codedError('Workflow record is unavailable', 404);
      const event: WorkflowEvent = {
        ...parsedEvent.data,
        record,
        ...(typeof previousLog.eventVersion === 'string'
          ? { eventVersion: previousLog.eventVersion }
          : { eventVersion: recordVersion(recordType, record, eventType) }),
        source: 'scheduler',
      };
      const completed = new Set(
        previousActions
          .filter((outcome) => outcome?.status === 'ok')
          .map((outcome) => outcome.index)
      );
      const outcomes: ActionOutcome[] = [];
      let failure: unknown = null;
      for (const [index, action] of parsedActions.data.list.entries()) {
        if (completed.has(index)) {
          outcomes.push({ index, type: action.type, status: 'ok', detail: 'already completed' });
          continue;
        }
        try {
          const outcome = await runAction(action, {
            actor,
            event,
            ruleId: rule.id,
            executionId: candidate.id,
            claimToken: token,
            actionIndex: index,
          });
          outcomes.push({
            index,
            type: action.type,
            status: outcome.status,
            detail: outcome.detail,
          });
          if (
            !(await persistExecutionCheckpoint({
              executionId: candidate.id,
              organizationId: candidate.organizationId,
              claimToken: token,
              resultLog: { ...previousLog, actions: [...previousActions, ...outcomes] },
            }))
          )
            break;
        } catch (error) {
          failure = error;
          outcomes.push({ index, type: action.type, status: 'failed', detail: 'action failed' });
          break;
        }
      }
      const allOutcomes = [
        ...previousActions.filter((prior) => !outcomes.some((next) => next.index === prior.index)),
        ...outcomes,
      ];
      const category = failure ? categorizeWorkflowError(failure) : null;
      const finalized = await finalizeExecutionAttempt({
        executionId: candidate.id,
        organizationId: candidate.organizationId,
        claimToken: token,
        attempts,
        resultLog: { ...previousLog, actions: allOutcomes },
        failureCategory: category,
        quarantine: Boolean(
          failure && category && shouldQuarantineWorkflowFailure(category, snapshot)
        ),
        auditAction: 'workflow.recovery_retry',
      });
      if (!finalized) continue;
      if (finalized.status === 'succeeded') totals.retried += 1;
      else if (finalized.status === 'quarantined') totals.quarantined += 1;
      else if (finalized.status === 'terminal_failed') totals.terminal += 1;
      else totals.failed += 1;
    } catch (error) {
      const category = categorizeWorkflowError(error);
      const quarantine = shouldQuarantineWorkflowFailure(category, snapshot);
      const updated = await finalizeExecutionAttempt({
        executionId: candidate.id,
        organizationId: candidate.organizationId,
        claimToken: token,
        attempts,
        resultLog: { ...previousLog, actions: previousActions },
        failureCategory: category,
        quarantine,
        auditAction: 'workflow.recovery_retry',
      });
      if (updated?.status === 'quarantined') totals.quarantined += 1;
      else if (updated?.status === 'terminal_failed') totals.terminal += 1;
      else if (updated) totals.failed += 1;
    }
  }
  return totals;
}

/**
 * Retry a failed execution with an atomic compare-and-set claim. The current
 * record is reloaded tenant-scoped so `$` action paths work; the event trigger
 * version remains the original one for notification idempotency.
 */
export async function retryWorkflowExecution(executionId: string) {
  const actor = await getAuthorizedUser();
  await requirePermission(actor.userId, actor.organizationId, 'workflow.execute');

  const execution = await prisma.workflowExecution.findFirst({
    where: { id: executionId, organizationId: actor.organizationId },
  });
  if (!execution) throw codedError('Not found', 404);
  if (execution.status !== 'failed') throw codedError('Only failed executions can be retried', 400);

  const recordType = WORKFLOW_RECORD_TYPES.find((candidate) => candidate === execution.recordType);
  if (!recordType) throw codedError('Workflow record type is not supported', 400);
  await requirePermission(
    actor.userId,
    actor.organizationId,
    EVENT_RECORDS[recordType].readPermission
  );

  const rule = await prisma.workflowRule.findFirst({
    where: { id: execution.ruleId, organizationId: actor.organizationId, deletedAt: null },
  });
  if (!rule) throw codedError('Rule no longer exists', 400);
  if (!rule.enabled)
    throw codedError('Disabled workflows cannot be retried; activate the rule first', 409);

  const retrySnapshot =
    execution.resultLog &&
    typeof execution.resultLog === 'object' &&
    !Array.isArray(execution.resultLog)
      ? (execution.resultLog as Record<string, unknown>)
      : {};
  const savedActions = retrySnapshot.actionDefinitions;
  const parsedSavedActions = workflowActionsSchema.safeParse(savedActions);
  const definitionChanged = Boolean(
    !parsedSavedActions.success ||
    (typeof retrySnapshot.eventType === 'string' && rule.trigger !== retrySnapshot.eventType) ||
    !workflowActionDefinitionsMatch(rule.actions, savedActions)
  );
  if (definitionChanged || !isWorkflowActionSnapshotRetrySafe(savedActions)) {
    const category = !parsedSavedActions.success
      ? 'invalid_action'
      : definitionChanged
        ? 'rule_changed'
        : 'unsafe_action';
    await prisma.workflowExecution.updateMany({
      where: { id: execution.id, organizationId: actor.organizationId, status: 'failed' },
      data: {
        status: 'quarantined',
        terminalAt: new Date(),
        nextAttemptAt: null,
        errorCategory: category,
        resultLog: { ...retrySnapshot, errorCategory: category, terminalReason: 'quarantined' },
      },
    });
    throw codedError('Execution requires manual reconciliation before retry', 409);
  }

  if (Number(execution.attempts) >= MAX_WORKFLOW_ATTEMPTS)
    throw codedError('Workflow execution reached its automatic attempt limit', 409);
  const retryClaimToken = randomUUID();
  const claim = await prisma.workflowExecution.updateMany({
    where: { id: execution.id, organizationId: actor.organizationId, status: 'failed' },
    data: {
      status: 'running',
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
      claimToken: retryClaimToken,
    },
  });
  if (claim.count !== 1)
    throw codedError('Execution is already being processed or is no longer retryable', 409);

  const previousLog = (
    execution.resultLog &&
    typeof execution.resultLog === 'object' &&
    !Array.isArray(execution.resultLog)
      ? execution.resultLog
      : {}
  ) as Record<string, unknown> & {
    eventType?: WorkflowTrigger;
    eventVersion?: string | null;
    previousStatus?: string | null;
  };
  const hasActionSnapshot = Object.prototype.hasOwnProperty.call(previousLog, 'actionDefinitions');
  const actionDefinitions = hasActionSnapshot
    ? previousLog.actionDefinitions
    : (rule.actions ?? {});
  let outcomes: ActionOutcome[] = [];
  let failure: unknown = null;

  try {
    const eventType = previousLog.eventType ?? rule.trigger;
    const parsedEvent = workflowProducerEventSchema.safeParse({
      type: eventType,
      recordType: execution.recordType,
      recordId: execution.recordId,
      ...(eventType === 'record.status_changed'
        ? { previousStatus: previousLog.previousStatus ?? null }
        : {}),
    });
    const parsedActions = workflowActionsSchema.safeParse(actionDefinitions);
    if (!parsedEvent.success || !parsedActions.success) {
      throw codedError('Stored workflow event or actions failed schema validation', 400);
    }

    const completed = new Set<number>();
    if (Array.isArray(previousLog.actions)) {
      for (const outcome of previousLog.actions) {
        if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) continue;
        const candidate = outcome as Partial<ActionOutcome>;
        const action = Number.isInteger(candidate.index)
          ? parsedActions.data.list[candidate.index as number]
          : undefined;
        if (candidate.status === 'ok' && action && candidate.type === action.type) {
          completed.add(candidate.index as number);
        }
      }
    }

    const record = await loadWorkflowRecord(
      parsedEvent.data.recordType,
      parsedEvent.data.recordId,
      actor.organizationId
    );
    if (!record)
      throw codedError('Workflow record is no longer available in this organization', 404);

    const event: WorkflowEvent = {
      ...parsedEvent.data,
      record,
      ...(previousLog.eventVersion
        ? { eventVersion: previousLog.eventVersion }
        : {
            eventVersion: recordVersion(parsedEvent.data.recordType, record, parsedEvent.data.type),
          }),
    };

    for (const [index, action] of parsedActions.data.list.entries()) {
      if (completed.has(index)) {
        outcomes.push({ index, type: action.type, status: 'ok', detail: 'already completed' });
        continue;
      }
      try {
        const outcome = await runAction(action, {
          actor,
          event,
          ruleId: rule.id,
          executionId: execution.id,
          claimToken: retryClaimToken,
          actionIndex: index,
        });
        outcomes.push({ index, type: action.type, status: outcome.status, detail: outcome.detail });
      } catch (error) {
        failure = error;
        outcomes.push({ index, type: action.type, status: 'failed', detail: 'action failed' });
        break;
      }
    }
  } catch (error) {
    failure = error;
    outcomes = [{ index: -1, type: 'retry', status: 'failed', detail: 'retry processing failed' }];
  }

  const failureCategory = failure ? categorizeWorkflowError(failure) : null;
  const quarantine = Boolean(
    failureCategory && shouldQuarantineWorkflowFailure(failureCategory, actionDefinitions)
  );
  const status = !failure
    ? 'succeeded'
    : quarantine
      ? 'quarantined'
      : Number(execution.attempts) + 1 >= MAX_WORKFLOW_ATTEMPTS
        ? 'terminal_failed'
        : 'failed';
  const finalizedAt = new Date();
  const resultLog: Record<string, unknown> = {
    ...previousLog,
    eventType: previousLog.eventType ?? rule.trigger,
    actionDefinitions,
    retriedBy: actor.userId,
    retried: true,
    actions: outcomes,
  };
  if (failure) {
    resultLog.errorCategory = failureCategory;
    resultLog.error = `Workflow attempt stopped (${failureCategory})`;
    if (status === 'terminal_failed' || status === 'quarantined') resultLog.terminalReason = status;
  } else delete resultLog.error;

  // Finalize status and audit history together. A failed audit insert must not
  // leave a completed retry without its corresponding audit record.
  let updated: Record<string, unknown>;
  try {
    updated = await prisma.$transaction(async (tx: unknown) => {
      const executionDelegate = getDelegate(tx, 'workflowExecution');
      const updatedCount = await executionDelegate.updateMany!({
        where: {
          id: execution.id,
          organizationId: actor.organizationId,
          status: 'running',
          claimToken: retryClaimToken,
        },
        data: {
          status,
          resultLog,
          errorCategory: failureCategory,
          nextAttemptAt:
            status === 'failed'
              ? nextWorkflowAttemptAt(Number(execution.attempts) + 1, finalizedAt)
              : null,
          terminalAt: status === 'terminal_failed' || status === 'quarantined' ? finalizedAt : null,
          claimToken: null,
        },
      });
      if (updatedCount.count !== 1) {
        throw codedError('Execution history changed while retrying', 409);
      }

      const reloaded = await executionDelegate.findFirst({
        where: { id: execution.id, organizationId: actor.organizationId },
      });
      if (!reloaded) throw codedError('Execution history disappeared while retrying', 409);

      await getDelegate(tx, 'auditLog').create!({
        data: {
          actorId: actor.userId,
          actorName: actor.email,
          action: 'workflow.retry',
          entityType: 'WorkflowExecution',
          entityId: execution.id,
          before: { status: execution.status },
          after: { status },
          metadata: { workflowRuleId: rule.id, attempts: Number(execution.attempts) + 1 },
          organizationId: actor.organizationId,
        },
      });
      return reloaded;
    });
  } catch (error) {
    // The transaction keeps success and audit atomic. If it rolls back, make
    // the execution retryable rather than leaving the compare-and-set claim in
    // `running`; never report success without its audit record.
    try {
      await prisma.workflowExecution.updateMany({
        where: {
          id: execution.id,
          organizationId: actor.organizationId,
          status: 'running',
          claimToken: retryClaimToken,
        },
        data: {
          status: 'failed',
          claimToken: null,
          errorCategory: 'database',
          nextAttemptAt: nextWorkflowAttemptAt(Number(execution.attempts) + 1, new Date()),
          resultLog: {
            ...resultLog,
            errorCategory: 'database',
            error: 'Retry finalization failed',
          },
        },
      });
    } catch {
      // If persistence is unavailable, retain the original error and leave the
      // failed retry visible in server logs for operational recovery.
      console.error('[automation] could not release a workflow retry claim', {
        executionId: execution.id,
        organizationId: actor.organizationId,
      });
    }
    throw error;
  }

  return {
    id: execution.id,
    status,
    attempts: Number(updated.attempts ?? Number(execution.attempts) + 1),
    resultLog: (updated.resultLog ?? null) as Record<string, unknown> | null,
  };
}
