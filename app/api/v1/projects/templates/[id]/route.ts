/**
 * AgencyOS Projects API - Single Project Template
 *
 * GET    /api/v1/projects/templates/[id] - Get template by ID
 * PUT    /api/v1/projects/templates/[id] - Update template
 * DELETE /api/v1/projects/templates/[id] - Delete template
 */

import { NextResponse } from 'next/server';

import {
  getProjectTemplate,
  updateProjectTemplate,
  deleteProjectTemplate,
} from '@/lib/services/projects/project-template-service';
import { projectTemplateUpdateSchema } from '@/lib/schemas/projects/project-template.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const template = await getProjectTemplate(id);
    return NextResponse.json(template);
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

    const parsed = projectTemplateUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const template = await updateProjectTemplate(id, parsed.data);
    return NextResponse.json(template);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteProjectTemplate(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
