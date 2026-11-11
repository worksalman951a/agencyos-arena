/**
 * Automation rule vocabulary (pure module — no database, no session).
 *
 * The rule editor used to store `trigger`, `conditions` and `actions` as
 * free-form JSON: nothing validated them, nothing could execute them, and a
 * typo silently produced a rule that never fires. This module defines the
 * supported trigger events, comparison operators and action types, and
 * evaluates them. The server-side executor (`run-workflow-service.ts`) is the
 * only caller.
 *
 * Supported today (executed in-process when an event is dispatched):
 *   triggers: record.created | record.updated | record.status_changed
 *   conditions: eq | neq | gt | gte | lt | lte | contains | in | is_set
 *   actions: notify_user | notify_role | assign_record_owner | set_status | log
 *
 * `send_email` and `webhook` are intentionally NOT implemented: SMTP and
 * outbound webhooks need infrastructure this phase does not have (ADR-0002).
 * They are rejected at validation time so a rule can never save an action that
 * would silently do nothing.
 */

import { z } from 'zod';

export const WORKFLOW_TRIGGERS = [
  'record.created',
  'record.updated',
  'record.status_changed',
] as const;

export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

/** Business records with trusted event producers in this phase. */
export const WORKFLOW_RECORD_TYPES = [
  'Lead',
  'Opportunity',
  'Project',
  'Task',
  'Estimate',
  'Invoice',
  'Proposal',
  'Quotation',
] as const;

export type WorkflowRecordType = (typeof WORKFLOW_RECORD_TYPES)[number];

/** Internal producer input: record snapshots and tenant/actor data are never accepted. */
export const workflowProducerEventSchema = z
  .object({
    type: z.enum(WORKFLOW_TRIGGERS),
    recordType: z.enum(WORKFLOW_RECORD_TYPES),
    recordId: z.string().trim().min(1).max(120),
    previousStatus: z.string().max(60).nullable().optional(),
  })
  .strict()
  .refine(
    (event) =>
      event.type === 'record.status_changed'
        ? event.previousStatus !== undefined
        : event.previousStatus === undefined,
    {
      message: 'previousStatus is required only for record.status_changed events',
      path: ['previousStatus'],
    }
  );

export const WORKFLOW_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'in',
  'is_set',
] as const;

export type WorkflowOperator = (typeof WORKFLOW_OPERATORS)[number];

export const WORKFLOW_ACTION_TYPES = [
  'notify_user',
  'notify_role',
  'assign_record_owner',
  'set_status',
  'log',
] as const;

export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

/**
 * Action types the product advertises but cannot execute yet. Keeping the list
 * explicit lets the API answer 400 with a precise message ("needs SMTP
 * configuration") instead of accepting a dead rule.
 */
export const UNSUPPORTED_ACTION_TYPES = ['send_email', 'webhook'] as const;

/** A single condition: `field <operator> value`. `field` is a dot path. */
export const workflowConditionSchema = z
  .object({
    field: z.string().trim().min(1, 'Condition field is required').max(120),
    operator: z.enum(WORKFLOW_OPERATORS),
    value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]).optional(),
  })
  .strict();

export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;

/**
 * Conditions are an object with a `mode` and an `all` list. `mode` defaults to
 * "all" so the historically-accepted `{}` (no conditions) still means "always
 * matches".
 */
export const workflowConditionsSchema = z
  .object({
    mode: z.enum(['all', 'any']).optional(),
    all: z.array(workflowConditionSchema).max(25).optional(),
  })
  .strict();

export type WorkflowConditions = z.infer<typeof workflowConditionsSchema>;

const actionBase = {
  /** Optional label used in the execution log. */
  label: z.string().trim().max(120).optional(),
};

export const workflowActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('notify_user'),
      /** Literal user id, or a dot path prefixed with `$` (e.g. `$.ownerId`). */
      userId: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(200),
      message: z.string().trim().max(1000).optional(),
      ...actionBase,
    })
    .strict(),
  z
    .object({
      type: z.literal('notify_role'),
      roleName: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(200),
      message: z.string().trim().max(1000).optional(),
      ...actionBase,
    })
    .strict(),
  z
    .object({
      type: z.literal('assign_record_owner'),
      /** Dot path (optionally `$`-prefixed) that resolves to a user id. */
      userId: z.string().trim().min(1).max(120),
      ...actionBase,
    })
    .strict(),
  z
    .object({
      type: z.literal('set_status'),
      status: z.string().trim().min(1).max(60),
      ...actionBase,
    })
    .strict(),
  z
    .object({
      type: z.literal('log'),
      message: z.string().trim().min(1).max(1000),
      ...actionBase,
    })
    .strict(),
]);

export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export const workflowActionsSchema = z
  .object({
    /** Ordered list of actions to run. */
    list: z.array(workflowActionSchema).min(1).max(20),
  })
  .strict();

export type WorkflowActions = z.infer<typeof workflowActionsSchema>;

/** Rule create payload accepted by the API/services. */
export const workflowRuleCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    trigger: z.enum(WORKFLOW_TRIGGERS),
    conditions: workflowConditionsSchema.default({}),
    actions: workflowActionsSchema,
    enabled: z.boolean().optional(),
  })
  .strict();

export const workflowRuleUpdateSchema = workflowRuleCreateSchema.partial().strict();

export type WorkflowRuleCreateInput = z.infer<typeof workflowRuleCreateSchema>;
export type WorkflowRuleUpdateInput = z.infer<typeof workflowRuleUpdateSchema>;

/** Event payload used to evaluate a rule. */
export interface WorkflowEvent {
  /** e.g. `record.created` */
  type: WorkflowTrigger;
  /** A supported domain record, loaded by the server-side producer. */
  recordType: WorkflowRecordType;
  recordId: string;
  /** The organization-scoped record loaded from PostgreSQL, never caller input. */
  record: Record<string, unknown>;
  /** For `record.status_changed`: the status before the business mutation. */
  previousStatus?: string | null;
  /** Stable fingerprint of the persisted record version that produced this event. */
  eventVersion?: string;
}

/** Read a dot path such as `owner.id` from a record. */
export function readField(record: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = record;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Resolve an action argument.
 *
 * A leading `$` means "read this path from the event record", so a rule can
 * target the record's owner; anything else is a literal value. This keeps
 * rules declarative and avoids executing user-provided code.
 */
export function resolveActionValue(
  raw: string,
  record: Record<string, unknown>
): string | undefined {
  if (!raw.startsWith('$')) return raw;
  const value = readField(record, raw.slice(1));
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function compare(actual: unknown, operator: WorkflowOperator, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return looseEquals(actual, expected);
    case 'neq':
      return !looseEquals(actual, expected);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (actual === null || actual === undefined) return false;
      const left = toComparable(actual);
      const right = toComparable(expected);
      if (left === null || right === null) return false;
      if (operator === 'gt') return left > right;
      if (operator === 'gte') return left >= right;
      if (operator === 'lt') return left < right;
      return left <= right;
    }
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase());
    case 'in': {
      const list = Array.isArray(expected) ? expected : [expected];
      return list.some((item) => looseEquals(actual, item));
    }
    case 'is_set':
      return actual !== null && actual !== undefined && actual !== '';
    default:
      return false;
  }
}

function looseEquals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return false;
  }
  if (typeof actual === 'boolean' || typeof expected === 'boolean') {
    return String(actual) === String(expected);
  }
  if (isNumeric(actual) && isNumeric(expected)) return Number(actual) === Number(expected);
  return String(actual) === String(expected);
}

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
  return false;
}

function toComparable(value: unknown): number | string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (isNumeric(value)) return Number(value);
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return parsed.getTime();
  }
  return String(value);
}

/**
 * Does the rule match this event?
 *
 * `record.status_changed` additionally requires the status to actually have
 * changed, so saving a record without touching its status cannot re-fire it.
 */
export function matchesWorkflowRule(
  rule: { trigger: string; conditions: unknown },
  event: WorkflowEvent
): boolean {
  if (rule.trigger !== event.type) return false;

  if (event.type === 'record.status_changed') {
    const next = readField(event.record, 'status');
    if (event.previousStatus === undefined) return false;
    if (String(next ?? '') === String(event.previousStatus ?? '')) return false;
  }

  const parsed = workflowConditionsSchema.safeParse(rule.conditions ?? {});
  if (!parsed.success) return false;

  const conditions = parsed.data.all ?? [];
  if (conditions.length === 0) return true;

  const results = conditions.map((condition) =>
    compare(readField(event.record, condition.field), condition.operator, condition.value)
  );

  return parsed.data.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Stable dedupe key for an event.
 *
 * Same rule + record + trigger + persisted event version + status transition
 * is the same piece of work across duplicate deliveries and retries. A later
 * record update is a distinct event; a record.created version remains tied to
 * its immutable creation timestamp.
 */
export function workflowDedupeKey(event: WorkflowEvent): string {
  const from = event.previousStatus ?? null;
  const to = readField(event.record, 'status') ?? null;

  // The persisted record version distinguishes separate updates to the same
  // record, while a repeated producer call for the same DB version remains
  // idempotent. JSON tuple encoding avoids delimiter-collision ambiguity.
  return JSON.stringify([
    event.type,
    event.recordType,
    event.recordId,
    event.eventVersion ?? null,
    from,
    to,
  ]);
}
