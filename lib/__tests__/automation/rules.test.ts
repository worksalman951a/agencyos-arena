/**
 * Automation rule vocabulary and evaluation (pure).
 *
 * Covers the pieces the executor relies on: which triggers/actions are
 * accepted, how conditions combine, status-transition matching, and the dedupe
 * key that prevents duplicate execution.
 */

import { describe, expect, it } from 'vitest';

import {
  matchesWorkflowRule,
  readField,
  resolveActionValue,
  UNSUPPORTED_ACTION_TYPES,
  workflowActionSchema,
  workflowActionsSchema,
  workflowConditionSchema,
  workflowDedupeKey,
  workflowRuleCreateSchema,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_TRIGGERS,
  type WorkflowEvent,
} from '@/lib/automation/rules';

const createdEvent = (record: Record<string, unknown> = {}): WorkflowEvent => ({
  type: 'record.created',
  recordType: 'Opportunity',
  recordId: 'opp-1',
  record: { status: 'open', amount: 1000, ownerId: 'user-1', name: 'Big deal', ...record },
});

describe('workflow vocabulary', () => {
  it('accepts every supported trigger and rejects unknown ones', () => {
    for (const trigger of WORKFLOW_TRIGGERS) {
      expect(
        workflowRuleCreateSchema.safeParse({
          name: 'r',
          trigger,
          actions: { list: [{ type: 'log', message: 'x' }] },
        }).success
      ).toBe(true);
    }

    const unknown = workflowRuleCreateSchema.safeParse({
      name: 'r',
      trigger: 'record.deleted',
      actions: { list: [{ type: 'log', message: 'x' }] },
    });
    expect(unknown.success).toBe(false);
  });

  it('rejects actions that cannot execute yet', () => {
    for (const type of UNSUPPORTED_ACTION_TYPES) {
      const parsed = workflowActionSchema.safeParse({ type, message: 'x' });
      expect(parsed.success, `${type} must not validate`).toBe(false);
      expect(WORKFLOW_ACTION_TYPES).not.toContain(type);
    }
  });

  it('requires at least one action and rejects unknown keys', () => {
    expect(workflowActionsSchema.safeParse({ list: [] }).success).toBe(false);
    expect(
      workflowActionsSchema.safeParse({ list: [{ type: 'log', message: 'x', extra: true }] })
        .success
    ).toBe(false);
  });

  it('validates condition operators', () => {
    expect(
      workflowConditionSchema.safeParse({ field: 'status', operator: 'eq', value: 'won' }).success
    ).toBe(true);
    expect(
      workflowConditionSchema.safeParse({ field: 'status', operator: 'matches' }).success
    ).toBe(false);
  });
});

describe('field resolution', () => {
  it('reads nested paths and returns undefined for missing ones', () => {
    const record = { owner: { id: 'u1' }, status: 'won' };
    expect(readField(record, 'owner.id')).toBe('u1');
    expect(readField(record, 'status')).toBe('won');
    expect(readField(record, 'owner.missing')).toBeUndefined();
    expect(readField(record, 'a.b.c')).toBeUndefined();
  });

  it('resolves $ paths from the record and passes literals through', () => {
    expect(resolveActionValue('$.ownerId', { ownerId: 'u9' })).toBe('u9');
    expect(resolveActionValue('literal-user', {})).toBe('literal-user');
    expect(resolveActionValue('$.missing', {})).toBeUndefined();
  });
});

describe('matchesWorkflowRule', () => {
  it('matches any record when there are no conditions', () => {
    expect(matchesWorkflowRule({ trigger: 'record.created', conditions: {} }, createdEvent())).toBe(
      true
    );
  });

  it('ignores rules for a different trigger', () => {
    expect(matchesWorkflowRule({ trigger: 'record.updated', conditions: {} }, createdEvent())).toBe(
      false
    );
  });

  it('evaluates all/any modes', () => {
    const event = createdEvent();
    const all = {
      trigger: 'record.created',
      conditions: {
        mode: 'all',
        all: [
          { field: 'status', operator: 'eq', value: 'open' },
          { field: 'amount', operator: 'gte', value: 500 },
        ],
      },
    };
    expect(matchesWorkflowRule(all, event)).toBe(true);

    const oneFails = {
      trigger: 'record.created',
      conditions: {
        mode: 'all',
        all: [
          { field: 'status', operator: 'eq', value: 'won' },
          { field: 'amount', operator: 'gte', value: 500 },
        ],
      },
    };
    expect(matchesWorkflowRule(oneFails, event)).toBe(false);

    const any = { ...oneFails, conditions: { ...oneFails.conditions, mode: 'any' as const } };
    expect(matchesWorkflowRule(any, event)).toBe(true);
  });

  it('supports string, numeric and set operators', () => {
    const event = createdEvent();
    const check = (condition: { field: string; operator: string; value?: unknown }) =>
      matchesWorkflowRule(
        { trigger: 'record.created', conditions: { mode: 'all', all: [condition] } },
        event
      );

    expect(check({ field: 'name', operator: 'contains', value: 'deal' })).toBe(true);
    expect(check({ field: 'name', operator: 'contains', value: 'nothing' })).toBe(false);
    expect(check({ field: 'amount', operator: 'lt', value: 2000 })).toBe(true);
    expect(check({ field: 'amount', operator: 'gt', value: 2000 })).toBe(false);
    expect(check({ field: 'status', operator: 'in', value: ['won', 'open'] })).toBe(true);
    expect(check({ field: 'status', operator: 'in', value: ['lost'] })).toBe(false);
    expect(check({ field: 'ownerId', operator: 'is_set' })).toBe(true);
    expect(check({ field: 'missing', operator: 'is_set' })).toBe(false);
    expect(check({ field: 'status', operator: 'neq', value: 'won' })).toBe(true);
  });

  it('only fires status_changed when the status actually changed', () => {
    const rule = { trigger: 'record.status_changed', conditions: {} };

    const changed: WorkflowEvent = {
      type: 'record.status_changed',
      recordType: 'Task',
      recordId: 't1',
      record: { status: 'done' },
      previousStatus: 'open',
    };
    expect(matchesWorkflowRule(rule, changed)).toBe(true);

    const unchanged: WorkflowEvent = { ...changed, previousStatus: 'done' };
    expect(matchesWorkflowRule(rule, unchanged)).toBe(false);

    const unknownPrevious: WorkflowEvent = { ...changed, previousStatus: undefined };
    expect(matchesWorkflowRule(rule, unknownPrevious)).toBe(false);
  });

  it('does not match an unparseable condition set', () => {
    expect(
      matchesWorkflowRule(
        { trigger: 'record.created', conditions: { all: [{ field: '', operator: 'eq' }] } },
        createdEvent()
      )
    ).toBe(false);
  });
});

describe('workflowDedupeKey', () => {
  it('is stable for the same record and transition', () => {
    const event = createdEvent();
    expect(workflowDedupeKey(event)).toBe(workflowDedupeKey(createdEvent()));
  });

  it('differs across transitions of the same record', () => {
    const from = workflowDedupeKey({
      type: 'record.status_changed',
      recordType: 'Task',
      recordId: 't1',
      record: { status: 'done' },
      previousStatus: 'open',
    });
    const to = workflowDedupeKey({
      type: 'record.status_changed',
      recordType: 'Task',
      recordId: 't1',
      record: { status: 'done' },
      previousStatus: 'in_progress',
    });
    expect(from).not.toBe(to);
  });
});
