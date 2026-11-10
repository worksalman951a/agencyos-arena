/**
 * AgencyOS CRM Projects API - Project Tasks
 *
 * GET  /api/v1/crm/projects/[id]/tasks - List tasks for a project
 * POST /api/v1/crm/projects/[id]/tasks - Add a task to a project
 *
 * Organization ID is resolved from the authenticated user's session,
 * never accepted from the client.
 */

import { NextResponse } from 'next/server';

import { getProject, addProjectTask } from '@/lib/services/crm/project-service';
import { projectTaskSchema } from '@/lib/schemas/crm/project.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    return NextResponse.json(project.tasks);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = projectTaskSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const task = await addProjectTask(id, parsed.data);
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
