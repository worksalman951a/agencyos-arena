/**
 * AgencyOS Projects API - Task Comments
 *
 * GET    /api/v1/projects/tasks/[id]/comments - List comments for a task
 * POST   /api/v1/projects/tasks/[id]/comments - Create a task comment
 */

import { NextResponse } from 'next/server';

import { listTaskComments, createTaskComment } from '@/lib/services/projects/task-comment-service';
import { taskCommentCreateSchema } from '@/lib/schemas/projects/task-comment.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await listTaskComments(id);
    return NextResponse.json(data);
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

    const payload =
      body && typeof body === 'object'
        ? { ...(body as Record<string, unknown>), taskId: id }
        : { taskId: id };

    const parsed = taskCommentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const comment = await createTaskComment(parsed.data);
    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
