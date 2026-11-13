import { describe, expect, it } from 'vitest';

import {
  categorizeWorkflowError,
  isWorkflowActionSnapshotRetrySafe,
  MAX_WORKFLOW_ATTEMPTS,
  nextWorkflowAttemptAt,
  shouldQuarantineWorkflowFailure,
  workflowRetryDelayMs,
} from '@/lib/automation/workflow-recovery';

describe('workflow recovery policy', () => {
  it('uses bounded exponential backoff and stops scheduling after the attempt limit', () => {
    expect(workflowRetryDelayMs(1)).toBe(60_000);
    expect(workflowRetryDelayMs(2)).toBe(120_000);
    expect(workflowRetryDelayMs(3)).toBe(240_000);
    expect(workflowRetryDelayMs(99)).toBe(60 * 60_000);
    const failedAt = new Date('2026-11-12T12:00:00.000Z');
    expect(nextWorkflowAttemptAt(1, failedAt)?.toISOString()).toBe('2026-11-12T12:01:00.000Z');
    expect(nextWorkflowAttemptAt(MAX_WORKFLOW_ATTEMPTS, failedAt)).toBeNull();
  });

  it('allows only validated action types with idempotent retry behavior', () => {
    expect(
      isWorkflowActionSnapshotRetrySafe({
        list: [
          { type: 'log', message: 'recorded' },
          { type: 'notify_user', userId: 'user-1', title: 'Reminder' },
          { type: 'notify_role', roleName: 'manager', title: 'Reminder' },
          { type: 'assign_record_owner', userId: 'user-1' },
          { type: 'set_status', status: 'active' },
        ],
      })
    ).toBe(true);
    expect(
      isWorkflowActionSnapshotRetrySafe({ list: [{ type: 'webhook', url: 'https://x' }] })
    ).toBe(false);
    expect(isWorkflowActionSnapshotRetrySafe({})).toBe(false);
  });

  it('quarantines authorization and uncertain action failures, but allows safe transient retries', () => {
    const safeSnapshot = { list: [{ type: 'log', message: 'safe' }] };
    expect(shouldQuarantineWorkflowFailure('database', safeSnapshot)).toBe(false);
    expect(shouldQuarantineWorkflowFailure('authorization', safeSnapshot)).toBe(true);
    expect(shouldQuarantineWorkflowFailure('uncertain_action', safeSnapshot)).toBe(true);
    expect(shouldQuarantineWorkflowFailure('unknown', { list: [{ type: 'future_action' }] })).toBe(
      true
    );
  });

  it('maps exceptions to safe actionable categories without returning their contents', () => {
    expect(categorizeWorkflowError({ statusCode: 403, message: 'forbidden: tenant secret' })).toBe(
      'authorization'
    );
    expect(categorizeWorkflowError({ statusCode: 404 })).toBe('record_unavailable');
    expect(categorizeWorkflowError({ statusCode: 409 })).toBe('conflict');
    expect(categorizeWorkflowError({ code: 'P1001', message: 'database password=hidden' })).toBe(
      'database'
    );
    expect(categorizeWorkflowError(new Error('unclassified secret'))).toBe('unknown');
  });
});
