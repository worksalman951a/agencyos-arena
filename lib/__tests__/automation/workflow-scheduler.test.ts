import { describe, expect, it } from 'vitest';
import {
  isEligibleOverdueRecord,
  scheduledEventVersion,
  scheduledRecordType,
  utcSchedulerDayStart,
} from '@/lib/automation/workflow-scheduler';

const now = new Date('2026-11-12T19:40:00.000Z');
const dayStart = utcSchedulerDayStart(now);

describe('workflow scheduler eligibility', () => {
  it('maps each overdue trigger to its server-owned record type', () => {
    expect(scheduledRecordType('task.overdue')).toBe('Task');
    expect(scheduledRecordType('project.overdue')).toBe('Project');
    expect(scheduledRecordType('invoice.overdue')).toBe('Invoice');
  });

  it('uses the UTC day boundary and a daily idempotency version', () => {
    expect(dayStart.toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(scheduledEventVersion(new Date('2026-11-10T18:30:00.000Z'), now)).toBe(
      '2026-11-12:2026-11-10T18:30:00.000Z'
    );
    expect(
      scheduledEventVersion(
        new Date('2026-11-10T18:30:00.000Z'),
        new Date('2026-11-13T00:00:00.000Z')
      )
    ).not.toBe(scheduledEventVersion(new Date('2026-11-10T18:30:00.000Z'), now));
  });

  it('selects overdue open tasks only inside active projects', () => {
    const overdueTask = {
      dueDate: new Date('2026-11-11T23:59:59.000Z'),
      status: 'in-progress',
      deletedAt: null,
      project: { status: 'active', deletedAt: null, organizationId: 'org-1' },
    };
    expect(isEligibleOverdueRecord('task.overdue', overdueTask, dayStart)).toBe(true);
    expect(
      isEligibleOverdueRecord('task.overdue', { ...overdueTask, status: 'done' }, dayStart)
    ).toBe(false);
    expect(
      isEligibleOverdueRecord(
        'task.overdue',
        { ...overdueTask, project: { status: 'archived', deletedAt: null } },
        dayStart
      )
    ).toBe(false);
    expect(
      isEligibleOverdueRecord(
        'task.overdue',
        { ...overdueTask, dueDate: new Date('2026-11-12T00:00:00.000Z') },
        dayStart
      )
    ).toBe(false);
  });

  it('selects active overdue projects and unpaid invoices without mutating their records', () => {
    expect(
      isEligibleOverdueRecord(
        'project.overdue',
        { endDate: new Date('2026-11-11T00:00:00.000Z'), status: 'active', deletedAt: null },
        dayStart
      )
    ).toBe(true);
    expect(
      isEligibleOverdueRecord(
        'project.overdue',
        { endDate: new Date('2026-11-11T00:00:00.000Z'), status: 'completed', deletedAt: null },
        dayStart
      )
    ).toBe(false);
    const overdueInvoice = {
      dueDate: new Date('2026-11-01T00:00:00.000Z'),
      status: 'sent',
      deletedAt: null,
      total: '100.00',
      subtotal: '100.00',
    };
    expect(isEligibleOverdueRecord('invoice.overdue', overdueInvoice, dayStart)).toBe(true);
    expect(
      isEligibleOverdueRecord('invoice.overdue', { ...overdueInvoice, status: 'paid' }, dayStart)
    ).toBe(false);
    expect(
      isEligibleOverdueRecord('invoice.overdue', { ...overdueInvoice, deletedAt: now }, dayStart)
    ).toBe(false);
    expect(overdueInvoice).toMatchObject({ status: 'sent', total: '100.00', subtotal: '100.00' });
  });
});
