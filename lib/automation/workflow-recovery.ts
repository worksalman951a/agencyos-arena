import { workflowActionsSchema, type WorkflowActionType } from '@/lib/automation/rules';

/** Initial execution plus four bounded retries. */
export const MAX_WORKFLOW_ATTEMPTS = 5;
export const WORKFLOW_RETRY_BASE_DELAY_MS = 60_000;
export const WORKFLOW_RETRY_MAX_DELAY_MS = 60 * 60_000;
export const STALE_WORKFLOW_LEASE_MS = 15 * 60_000;
export const WORKFLOW_RECOVERY_BATCH_SIZE = 100;

export const RETRY_SAFE_ACTION_TYPES: ReadonlySet<WorkflowActionType> = new Set([
  // Log only affects the durable execution history.
  'log',
  // Notification creation uses a unique rule/event/action/recipient key.
  'notify_user',
  'notify_role',
  // Record mutations are tenant-scoped compare-and-set operations and treat
  // already-applied values as no-ops on retry.
  'assign_record_owner',
  'set_status',
]);

export type WorkflowErrorCategory =
  | 'authorization'
  | 'rule_disabled'
  | 'rule_changed'
  | 'record_unavailable'
  | 'invalid_action'
  | 'unsafe_action'
  | 'attempt_limit'
  | 'conflict'
  | 'database'
  | 'unknown';

export function workflowRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(30, Math.floor(attempts) - 1));
  return Math.min(WORKFLOW_RETRY_BASE_DELAY_MS * 2 ** exponent, WORKFLOW_RETRY_MAX_DELAY_MS);
}

export function nextWorkflowAttemptAt(attempts: number, failedAt: Date): Date | null {
  if (attempts >= MAX_WORKFLOW_ATTEMPTS) return null;
  return new Date(failedAt.getTime() + workflowRetryDelayMs(attempts));
}

/** Unknown, invalid, and future action types are quarantined by default. */
export function isWorkflowActionSnapshotRetrySafe(snapshot: unknown): boolean {
  const parsed = workflowActionsSchema.safeParse(snapshot);
  return (
    parsed.success && parsed.data.list.every((action) => RETRY_SAFE_ACTION_TYPES.has(action.type))
  );
}

/** Return a stable, non-sensitive category; never persist exception text as a category. */
export function shouldQuarantineWorkflowFailure(
  category: WorkflowErrorCategory,
  snapshot: unknown
): boolean {
  return (
    !isWorkflowActionSnapshotRetrySafe(snapshot) ||
    [
      'authorization',
      'rule_disabled',
      'rule_changed',
      'record_unavailable',
      'invalid_action',
      'unsafe_action',
    ].includes(category)
  );
}

export function categorizeWorkflowError(error: unknown): WorkflowErrorCategory {
  const details = error as { code?: unknown; statusCode?: unknown; message?: unknown } | null;
  if (details?.statusCode === 401 || details?.statusCode === 403) return 'authorization';
  if (details?.statusCode === 400) return 'invalid_action';
  if (details?.statusCode === 404) return 'record_unavailable';
  if (details?.statusCode === 409) return 'conflict';
  if (typeof details?.code === 'string' && /^P\d{4}$/.test(details.code)) return 'database';
  if (
    typeof details?.message === 'string' &&
    /permission|forbidden|unauthori[sz]ed/i.test(details.message)
  ) {
    return 'authorization';
  }
  return 'unknown';
}
