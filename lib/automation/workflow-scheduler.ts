import {
  SCHEDULED_OVERDUE_TRIGGERS,
  type WorkflowRecordType,
  type WorkflowTrigger,
} from '@/lib/automation/rules';

export type ScheduledOverdueTrigger = (typeof SCHEDULED_OVERDUE_TRIGGERS)[number];

export function scheduledRecordType(trigger: ScheduledOverdueTrigger): WorkflowRecordType {
  switch (trigger) {
    case 'task.overdue':
      return 'Task';
    case 'project.overdue':
      return 'Project';
    case 'invoice.overdue':
      return 'Invoice';
  }
}

export function isScheduledOverdueTrigger(value: string): value is ScheduledOverdueTrigger {
  return (SCHEDULED_OVERDUE_TRIGGERS as readonly string[]).includes(value);
}

/** Daily scheduler window is based on UTC to avoid server-local DST drift. */
export function utcSchedulerDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isEligibleOverdueRecord(
  trigger: ScheduledOverdueTrigger,
  record: Record<string, unknown>,
  dayStart: Date
): boolean {
  const dueValue = trigger === 'project.overdue' ? record.endDate : record.dueDate;
  const dueDate = dueValue instanceof Date ? dueValue : new Date(String(dueValue ?? ''));
  if (!Number.isFinite(dueDate.getTime()) || dueDate >= dayStart) return false;

  if (trigger === 'task.overdue') {
    const project = record.project as
      { status?: unknown; deletedAt?: unknown; organizationId?: unknown } | null | undefined;
    return (
      record.deletedAt == null &&
      record.status !== 'done' &&
      project?.status === 'active' &&
      project.deletedAt == null
    );
  }

  if (trigger === 'project.overdue') {
    return record.deletedAt == null && record.status === 'active';
  }

  return record.deletedAt == null && (record.status === 'sent' || record.status === 'overdue');
}

/** Stable for every run on a UTC day, but changes when the due date changes. */
export function scheduledEventVersion(dueDate: Date, now: Date): string {
  return `${utcSchedulerDayStart(now).toISOString().slice(0, 10)}:${dueDate.toISOString()}`;
}

export function scheduledTriggerForRecordType(
  recordType: WorkflowRecordType
): WorkflowTrigger | null {
  switch (recordType) {
    case 'Task':
      return 'task.overdue';
    case 'Project':
      return 'project.overdue';
    case 'Invoice':
      return 'invoice.overdue';
    default:
      return null;
  }
}
