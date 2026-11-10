/**
 * AgencyOS CRM Projects API
 *
 * GET    /api/v1/crm/projects          - List projects (org-scoped, paginated)
 * POST   /api/v1/crm/projects          - Create a project
 *
 * Organization ID is resolved from the authenticated user's session,
 * never accepted from the client.
 */

import { NextResponse } from 'next/server';

import { listProjects, createProject } from '@/lib/services/crm/project-service';
import { projectQuerySchema, projectCreateSchema } from '@/lib/schemas/crm/project.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawParams: Record<string, string | undefined> = {
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      search: searchParams.get('search') || undefined,
      clientId: searchParams.get('clientId') || undefined,
      accountId: searchParams.get('accountId') || undefined,
      status: searchParams.get('status') || undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
      includeDeleted: searchParams.get('includeDeleted') ?? undefined,
    };

    const parsed = projectQuerySchema.safeParse(rawParams);
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400, parsed.error.issues);
    }

    const data = await listProjects(parsed.data);
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

    const parsed = projectCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const project = await createProject(parsed.data);
    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
