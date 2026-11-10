/**
 * AgencyOS Automation Workflow Executions API
 *
 * GET /api/v1/automation/workflows/[id]/executions - Execution history for one rule.
 *
 * Execution records are written by the engine only; there is no public POST —
 * the previous POST let any client fabricate "succeeded" history.
 */

import { NextResponse } from 'next/server';

import { listWorkflowExecutions } from '@/lib/services/automation/workflow-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await listWorkflowExecutions(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
