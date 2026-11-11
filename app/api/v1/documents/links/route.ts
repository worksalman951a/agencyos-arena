/**
 * AgencyOS Documents API - Shareable Links
 *
 * GET    /api/v1/documents/links          - List document links
 * POST   /api/v1/documents/links          - Create a shareable link (documentId or sales entity)
 * DELETE /api/v1/documents/links?id=<id>  - Revoke a shareable link
 */

import { NextResponse } from 'next/server';

import {
  createDocumentLink,
  createSalesDocumentShareLink,
  listDocumentLinks,
  revokeDocumentLink,
} from '@/lib/services/documents/link-service';
import {
  documentLinkCreateSchema,
  salesDocumentShareLinkCreateSchema,
} from '@/lib/schemas/documents/link.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET() {
  try {
    const data = await listDocumentLinks();
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body && typeof body === 'object' && 'entityType' in body) {
      const parsed = salesDocumentShareLinkCreateSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          parsed.error.issues[0]?.message ?? 'Invalid request body',
          400,
          parsed.error.issues
        );
      }
      const link = await createSalesDocumentShareLink(parsed.data);
      return NextResponse.json(link, { status: 201 });
    }

    const parsed = documentLinkCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        parsed.error.issues[0]?.message ?? 'Invalid request body',
        400,
        parsed.error.issues
      );
    }

    const link = await createDocumentLink(parsed.data);
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return errorResponse('Link id is required', 400);
    }

    const result = await revokeDocumentLink(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
