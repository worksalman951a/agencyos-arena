/**
 * AgencyOS Automation Workflow Rules API
 *
 * GET  /api/v1/automation/workflows - List workflow rules
 * POST /api/v1/automation/workflows - Create a workflow rule (validated trigger/conditions/actions)
 */

import { NextResponse } from 'next/server';

import { createWorkflowRule, listWorkflowRules } from '@/lib/services/automation/workflow-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    return NextResponse.json(await listWorkflowRules());
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createWorkflowRule(await request.json()), { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}
