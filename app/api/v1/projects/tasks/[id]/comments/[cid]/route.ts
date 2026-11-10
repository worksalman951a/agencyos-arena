/**
 * AgencyOS Projects API - Single Task Comment
 *
 * PUT    /api/v1/projects/tasks/[id]/comments/[cid] - Update comment
 * DELETE /api/v1/projects/tasks/[id]/comments/[cid] - Delete comment
 */

import { NextResponse } from 'next/server';

import { updateTaskComment, deleteTaskComment } from '@/lib/services/projects/task-comment-service';
import { taskCommentUpdateSchema } from '@/lib/schemas/projects/task-comment.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  try {
    const { id, cid } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = taskCommentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const comment = await updateTaskComment(cid, parsed.data, id);
    return NextResponse.json(comment);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  try {
    const { id, cid } = await params;
    const result = await deleteTaskComment(cid, id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
