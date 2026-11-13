import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/automation/workflow-scheduler-service', () => ({
  runWorkflowScheduler: vi.fn(),
}));

import { POST } from '@/app/api/internal/automation/scheduler/route';
import { runWorkflowScheduler } from '@/lib/services/automation/workflow-scheduler-service';
import type { WorkflowSchedulerResult } from '@/lib/services/automation/workflow-scheduler-service';

const mockRunWorkflowScheduler = vi.mocked(runWorkflowScheduler);
const secret = 'workflow-scheduler-unit-test-secret-at-least-32-chars';
const completedResult: WorkflowSchedulerResult = {
  status: 'completed',
  runAt: '2026-11-12T12:00:00.000Z',
  day: '2026-11-12',
  eligibleRules: 2,
  skippedRules: 0,
  scannedRecords: 5,
  matched: 5,
  executed: 5,
  skipped: 0,
  failed: 0,
  recovery: { scanned: 0, retried: 0, quarantined: 0, terminal: 0, failed: 0 },
  monitoring: { pending: 0, running: 0, failed: 0, terminal: 0 },
};

function schedulerRequest() {
  return new Request('http://localhost/api/internal/automation/scheduler', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
}

describe('POST /api/internal/automation/scheduler', () => {
  beforeEach(() => {
    vi.stubEnv('WORKFLOW_SCHEDULER_SECRET', secret);
    mockRunWorkflowScheduler.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 200 and structured safe counts when the scan completes without failures', async () => {
    mockRunWorkflowScheduler.mockResolvedValue(completedResult);

    const response = await POST(schedulerRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ...completedResult, status: 'completed' });
  });

  it('returns non-2xx with sanitized counts when some workflow executions fail', async () => {
    const resultWithUnexpectedSensitiveFields = {
      ...completedResult,
      failed: 2,
      executed: 3,
      organizationId: 'tenant-private-id',
      ruleId: 'rule-private-id',
      error: 'sensitive internal error',
      stack: 'internal stack trace',
    } as WorkflowSchedulerResult;
    mockRunWorkflowScheduler.mockResolvedValue(resultWithUnexpectedSensitiveFields);

    const response = await POST(schedulerRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      status: 'completed_with_failures',
      runAt: completedResult.runAt,
      day: completedResult.day,
      eligibleRules: 2,
      skippedRules: 0,
      scannedRecords: 5,
      matched: 5,
      executed: 3,
      skipped: 0,
      failed: 2,
      recovery: { scanned: 0, retried: 0, quarantined: 0, terminal: 0, failed: 0 },
      monitoring: { pending: 0, running: 0, failed: 0, terminal: 0 },
    });
    expect(JSON.stringify(body)).not.toContain('tenant-private-id');
    expect(JSON.stringify(body)).not.toContain('sensitive internal error');
    expect(JSON.stringify(body)).not.toContain('internal stack trace');
  });

  it('returns a generic fatal error without exposing thrown details', async () => {
    mockRunWorkflowScheduler.mockRejectedValue(
      new Error(`database password ${secret}; internal stack trace`)
    );

    const response = await POST(schedulerRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      status: 'failed',
      error: 'Workflow scheduler run failed',
    });
  });
});
