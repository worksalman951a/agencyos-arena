/**
 * AgencyOS CRM Project Tasks API
 *
 * POST /api/v1/crm/projects/[id]/tasks - Add a task to a project
 *
 * Organization scope is resolved from the authenticated session, never from the
 * request. A project belonging to another organization returns a non-disclosing
 * 404 (IDOR protection), and task creation requires the project.update
 * permission.
 */

import { NextResponse } from 'next/server';

import { addProjectTask } from '@/lib/services/crm/project-service';
import { projectTaskSchema } from '@/lib/schemas/crm/project.schema';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

function errorStatus(err: unknown): number {
  return (err as Error & { statusCode?: number }).statusCode ?? 500;
}

function errorMessage(status: number): string {
  if (status === 401) return 'Unauthenticated';
  if (status === 403) return 'Forbidden';
  if (status === 400) return 'Invalid request body';
  if (status === 404) return 'Not found';
  return 'Internal server error';
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const body = await request.json();
    const parsed = projectTaskSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const task = await addProjectTask(id, parsed.data);
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    const statusCode = errorStatus(err);
    return errorResponse(errorMessage(statusCode), statusCode);
  }
}
