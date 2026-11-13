import 'server-only';

import { getUserPermissions, isInternalUserActive } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { SCHEDULED_OVERDUE_TRIGGERS } from '@/lib/automation/rules';
import {
  scheduledRecordType,
  isScheduledOverdueTrigger,
  utcSchedulerDayStart,
  type ScheduledOverdueTrigger,
} from '@/lib/automation/workflow-scheduler';
import {
  emitScheduledWorkflowEvent,
  recoverWorkflowExecutionsForScheduler,
} from '@/lib/services/automation/run-workflow-service';

const PAGE_SIZE = 200;

interface ScheduledRule {
  id: string;
  organizationId: string;
  trigger: string;
  createdBy: string | null;
}

interface DueRecord {
  id: string;
}

export interface WorkflowSchedulerResult {
  status: 'completed';
  runAt: string;
  day: string;
  eligibleRules: number;
  skippedRules: number;
  scannedRecords: number;
  matched: number;
  executed: number;
  skipped: number;
  failed: number;
  recovery: {
    scanned: number;
    retried: number;
    quarantined: number;
    terminal: number;
    failed: number;
  };
  monitoring: { pending: number; running: number; failed: number; terminal: number };
}

function overdueWhere(trigger: ScheduledOverdueTrigger, organizationId: string, dayStart: Date) {
  if (trigger === 'task.overdue') {
    return {
      organizationId,
      dueDate: { lt: dayStart },
      status: { not: 'done' },
      project: { is: { organizationId, status: 'active', deletedAt: null } },
    };
  }
  if (trigger === 'project.overdue') {
    return {
      organizationId,
      deletedAt: null,
      endDate: { lt: dayStart },
      status: 'active',
    };
  }
  return {
    organizationId,
    deletedAt: null,
    dueDate: { lt: dayStart },
    status: { in: ['sent', 'overdue'] },
  };
}

async function findDueRecords(
  trigger: ScheduledOverdueTrigger,
  organizationId: string,
  dayStart: Date
): Promise<DueRecord[]> {
  const delegateName =
    trigger === 'task.overdue' ? 'task' : trigger === 'project.overdue' ? 'project' : 'invoice';
  const delegates = prisma as unknown as Record<
    string,
    { findMany(args: unknown): Promise<DueRecord[]> }
  >;
  const delegate = delegates[delegateName];
  const records: DueRecord[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await delegate.findMany({
      where: overdueWhere(trigger, organizationId, dayStart),
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    records.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return records;
}

/**
 * One-shot scheduler invocation. An external cron calls the protected route;
 * the existing WorkflowExecution unique key claims each rule/record/UTC-day
 * event before any action runs, so concurrent calls cannot duplicate actions.
 */
export async function runWorkflowScheduler(now = new Date()): Promise<WorkflowSchedulerResult> {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid scheduler timestamp');
  const dayStart = utcSchedulerDayStart(now);
  const rules = (await prisma.workflowRule.findMany({
    where: { trigger: { in: [...SCHEDULED_OVERDUE_TRIGGERS] }, enabled: true, deletedAt: null },
    select: { id: true, organizationId: true, trigger: true, createdBy: true },
    orderBy: [{ organizationId: 'asc' }, { createdAt: 'asc' }],
  })) as ScheduledRule[];

  const totals = {
    status: 'completed' as const,
    runAt: now.toISOString(),
    day: dayStart.toISOString().slice(0, 10),
    eligibleRules: 0,
    skippedRules: 0,
    scannedRecords: 0,
    matched: 0,
    executed: 0,
    skipped: 0,
    failed: 0,
    recovery: { scanned: 0, retried: 0, quarantined: 0, terminal: 0, failed: 0 },
    monitoring: { pending: 0, running: 0, failed: 0, terminal: 0 },
  };

  // Recovery runs behind the same protected scheduler invocation and enforces
  // the original rule creator's current active status and permissions per row.
  const recovery = await recoverWorkflowExecutionsForScheduler(now);
  totals.recovery = recovery;
  totals.failed += recovery.failed + recovery.terminal + recovery.quarantined;

  for (const rule of rules) {
    if (!rule.createdBy || !isScheduledOverdueTrigger(rule.trigger)) {
      totals.skippedRules += 1;
      continue;
    }
    const trigger = rule.trigger as ScheduledOverdueTrigger;
    const recordType = scheduledRecordType(trigger);
    try {
      const owner = await prisma.user.findFirst({
        where: {
          id: rule.createdBy,
          organizationId: rule.organizationId,
          status: 'active',
          userType: 'internal',
        },
        select: { id: true, userType: true, status: true },
      });
      if (!isInternalUserActive(owner)) {
        totals.skippedRules += 1;
        continue;
      }
      const permissions = await getUserPermissions(owner.id, rule.organizationId);
      const requiredPermissions =
        recordType === 'Invoice'
          ? ['workflow.execute', 'invoice.read', 'invoice.update']
          : ['workflow.execute', 'project.read'];
      if (requiredPermissions.some((permission) => !permissions.has(permission))) {
        totals.skippedRules += 1;
        continue;
      }

      totals.eligibleRules += 1;
      const records = await findDueRecords(trigger, rule.organizationId, dayStart);
      for (const record of records) {
        totals.scannedRecords += 1;
        try {
          const result = await emitScheduledWorkflowEvent(
            rule.id,
            rule.organizationId,
            record.id,
            trigger,
            now
          );
          totals.matched += result.matched;
          totals.executed += result.executed;
          totals.skipped += result.skipped;
          totals.failed += result.failed;
        } catch (error) {
          totals.failed += 1;
          console.error('[automation] scheduled workflow event failed', {
            organizationId: rule.organizationId,
            ruleId: rule.id,
            trigger,
            recordType,
            recordId: record.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }
    } catch (error) {
      totals.failed += 1;
      console.error('[automation] scheduled workflow rule failed', {
        organizationId: rule.organizationId,
        ruleId: rule.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  const statuses = ['pending', 'running', 'failed', 'terminal_failed', 'quarantined'];
  const counts = await Promise.all(
    statuses.map((status) => prisma.workflowExecution.count({ where: { status } }))
  );
  totals.monitoring = {
    pending: counts[0],
    running: counts[1],
    failed: counts[2],
    terminal: counts[3] + counts[4],
  };
  return totals;
}
