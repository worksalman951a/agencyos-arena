/**
 * AgencyOS Automation Execution Retry API
 *
 * POST /api/v1/automation/executions/[id]/retry - Retry a failed execution.
 *   Actions that already succeeded are not repeated.
 */

import { NextResponse } from 'next/server';

import { retryWorkflowExecution } from '@/lib/services/automation/run-workflow-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await retryWorkflowExecution(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
