/**
 * AgencyOS Scheduled Automation Execution Endpoint
 *
 * POST /api/v1/automation/scheduler/run
 *
 * Security:
 * - Requires either:
 *   1. Bearer token matching `CRON_SECRET` from server environment, OR
 *   2. Valid authenticated user session with `workflow.update` permission.
 * - Prevents public unauthenticated triggering.
 */

import { NextResponse } from 'next/server';
import { runScheduledAutomation } from '@/lib/services/automation/scheduler-service';

export async function POST(request: Request) {
  try {
    const summary = await runScheduledAutomation(request.headers.get('authorization'));
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json(
      { error: (err as Error).message || 'Scheduler execution failed' },
      { status: statusCode }
    );
  }
}
