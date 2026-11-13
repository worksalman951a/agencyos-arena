import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  runWorkflowScheduler,
  type WorkflowSchedulerResult,
} from '@/lib/services/automation/workflow-scheduler-service';

export const dynamic = 'force-dynamic';

function authorized(request: Request, expected: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return false;
  const suppliedDigest = createHash('sha256').update(match[1]).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function publicResult(result: WorkflowSchedulerResult) {
  return {
    status: result.failed > 0 ? 'completed_with_failures' : 'completed',
    runAt: result.runAt,
    day: result.day,
    eligibleRules: result.eligibleRules,
    skippedRules: result.skippedRules,
    scannedRecords: result.scannedRecords,
    matched: result.matched,
    executed: result.executed,
    skipped: result.skipped,
    failed: result.failed,
  };
}

export async function POST(request: Request) {
  const secret = process.env.WORKFLOW_SCHEDULER_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: 'Workflow scheduler is not configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const result = await runWorkflowScheduler();
    const partialFailure = result.failed > 0;
    return NextResponse.json(publicResult(result), {
      status: partialFailure ? 500 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { status: 'failed', error: 'Workflow scheduler run failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
