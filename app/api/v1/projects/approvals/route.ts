/**
 * AgencyOS Projects API - Project Approvals
 *
 * GET    /api/v1/projects/approvals?projectId= - List approvals (project or org-wide)
 * POST   /api/v1/projects/approvals            - Create a project approval
 */

import { NextResponse } from 'next/server';

import {
  listProjectApprovals,
  createProjectApproval,
} from '@/lib/services/projects/project-approval-service';
import { projectApprovalCreateSchema } from '@/lib/schemas/projects/project-approval.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || undefined;
    const data = await listProjectApprovals(projectId);
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = projectApprovalCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const approval = await createProjectApproval(parsed.data);
    return NextResponse.json(approval, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
