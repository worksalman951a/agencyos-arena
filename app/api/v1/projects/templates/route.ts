/**
 * AgencyOS Projects API - Project Templates
 *
 * GET    /api/v1/projects/templates - List project templates
 * POST   /api/v1/projects/templates - Create a project template
 */

import { NextResponse } from 'next/server';

import {
  listProjectTemplates,
  createProjectTemplate,
} from '@/lib/services/projects/project-template-service';
import { projectTemplateCreateSchema } from '@/lib/schemas/projects/project-template.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET() {
  try {
    const data = await listProjectTemplates();
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

    const parsed = projectTemplateCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const template = await createProjectTemplate(parsed.data);
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
