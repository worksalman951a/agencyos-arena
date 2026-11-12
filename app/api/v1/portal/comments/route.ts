/**
 * GET  /api/v1/portal/comments?resourceType=&resourceId= - client-visible thread.
 * POST /api/v1/portal/comments - post client feedback.
 *
 * Only `visibility: "client"` rows are ever returned; the service forces that
 * visibility on writes, so a client cannot create an internal-only note.
 */

import { NextResponse } from 'next/server';

import {
  createClientComment,
  listClientVisibleComments,
} from '@/lib/services/portal/client-comment-service';
import { requirePortalAccess } from '@/lib/portal/access-control';
import { isPortalResourceType } from '@/lib/portal/resource-registry';
import { clientCommentQuerySchema } from '@/lib/schemas/portal/client-portal.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawType = searchParams.get('resourceType') ?? '';
    const rawId = searchParams.get('resourceId') ?? '';

    const parsed = clientCommentQuerySchema.safeParse({
      resourceType: rawType,
      resourceId: rawId,
    });
    if (!parsed.success || !isPortalResourceType(parsed.data.resourceType)) {
      return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
    }

    const context = await requirePortalAccess();
    const comments = await listClientVisibleComments(
      context,
      parsed.data.resourceType,
      parsed.data.resourceId
    );
    return NextResponse.json({ data: comments });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const comment = await createClientComment(body);
    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
