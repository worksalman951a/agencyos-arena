/**
 * AgencyOS Documents API - Single Template
 *
 * GET    /api/v1/documents/templates/[id] - Get template by ID
 * PUT    /api/v1/documents/templates/[id] - Update template
 * DELETE /api/v1/documents/templates/[id] - Delete template
 */

import { NextResponse } from 'next/server';

import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from '@/lib/services/documents/template-service';
import { templateUpdateSchema } from '@/lib/schemas/documents/template.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const template = await getTemplate(id);
    return NextResponse.json(template);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = templateUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const template = await updateTemplate(id, parsed.data);
    return NextResponse.json(template);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteTemplate(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
