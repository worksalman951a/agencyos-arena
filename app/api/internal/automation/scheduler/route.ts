import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { runWorkflowScheduler } from '@/lib/services/automation/workflow-scheduler-service';

export const dynamic = 'force-dynamic';

function authorized(request: Request, expected: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return false;
  const suppliedDigest = createHash('sha256').update(match[1]).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
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
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'Workflow scheduler run failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
