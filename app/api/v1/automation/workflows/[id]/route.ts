/**
 * AgencyOS Automation Workflow Rule API - Single Rule
 *
 * GET    /api/v1/automation/workflows/[id] - Get rule by ID
 * PATCH  /api/v1/automation/workflows/[id] - Update rule (including enable/disable)
 * PUT    /api/v1/automation/workflows/[id] - Alias of PATCH
 * DELETE /api/v1/automation/workflows/[id] - Delete rule and its execution history
 */

import { NextResponse } from 'next/server';

import {
  deleteWorkflowRule,
  getWorkflowRule,
  updateWorkflowRule,
} from '@/lib/services/automation/workflow-service';
import { apiErrorFrom } from '@/lib/api/route-error';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await getWorkflowRule(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await updateWorkflowRule(id, await request.json()));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await updateWorkflowRule(id, await request.json()));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteWorkflowRule(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
