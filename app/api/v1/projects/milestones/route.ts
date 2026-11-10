/**
 * AgencyOS Projects API - Milestones
 *
 * GET  /api/v1/projects/milestones?projectId= - List milestones for a project
 * POST /api/v1/projects/milestones            - Create a milestone
 */

import { NextResponse } from 'next/server';

import { listMilestones, createMilestone } from '@/lib/services/projects/milestone-service';
import { milestoneCreateSchema } from '@/lib/schemas/projects/milestone.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return errorResponse('projectId is required', 400);
    }

    const data = await listMilestones(projectId);
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

    const parsed = milestoneCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const milestone = await createMilestone(parsed.data);
    return NextResponse.json(milestone, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
