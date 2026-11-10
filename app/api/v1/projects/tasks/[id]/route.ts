/**
 * AgencyOS Projects API - Single Task
 *
 * GET    /api/v1/projects/tasks/[id] - Get task details
 * PUT    /api/v1/projects/tasks/[id] - Update task
 * DELETE /api/v1/projects/tasks/[id] - Delete task
 */

import { NextResponse } from 'next/server';

import {
  getProjectTask,
  updateProjectTask,
  deleteProjectTask,
} from '@/lib/services/crm/project-service';
import { projectTaskUpdateSchema } from '@/lib/schemas/crm/project.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const task = await getProjectTask(id);
    return NextResponse.json(task);
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

    const parsed = projectTaskUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const task = await updateProjectTask(id, parsed.data);
    return NextResponse.json(task);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteProjectTask(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
