/**
 * AgencyOS Projects API - Single Milestone
 *
 * PUT    /api/v1/projects/milestones/[id] - Update milestone
 * DELETE /api/v1/projects/milestones/[id] - Delete milestone
 */

import { NextResponse } from 'next/server';

import { updateMilestone, deleteMilestone } from '@/lib/services/projects/milestone-service';
import { milestoneUpdateSchema } from '@/lib/schemas/projects/milestone.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
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

    const parsed = milestoneUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const milestone = await updateMilestone(id, parsed.data);
    return NextResponse.json(milestone);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteMilestone(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
