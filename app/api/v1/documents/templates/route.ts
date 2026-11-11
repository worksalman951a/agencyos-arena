/**
 * AgencyOS Documents API - Templates
 *
 * GET    /api/v1/documents/templates - List document templates
 * POST   /api/v1/documents/templates - Create a template
 */

import { NextResponse } from 'next/server';

import { listTemplates, createTemplate } from '@/lib/services/documents/template-service';
import { templateCreateSchema } from '@/lib/schemas/documents/template.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET() {
  try {
    const data = await listTemplates();
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = templateCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const template = await createTemplate(parsed.data);
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
