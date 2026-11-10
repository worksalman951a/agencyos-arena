/**
 * AgencyOS Projects API - Single Project Approval
 *
 * GET    /api/v1/projects/approvals/[id] - Get single approval
 * PUT    /api/v1/projects/approvals/[id] - Update approval
 */

import { NextResponse } from 'next/server';

import {
  getProjectApproval,
  updateProjectApproval,
} from '@/lib/services/projects/project-approval-service';
import { projectApprovalUpdateSchema } from '@/lib/schemas/projects/project-approval.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const approval = await getProjectApproval(id);
    return NextResponse.json(approval);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = projectApprovalUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const approval = await updateProjectApproval(id, parsed.data);
    return NextResponse.json(approval);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
