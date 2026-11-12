/**
 * GET  /api/v1/admin/client-comments - read client feedback and internal notes.
 * POST /api/v1/admin/client-comments - reply to a client on a shared resource.
 *
 * `visibility: "internal"` keeps a note team-only; a client never receives it.
 */

import { NextResponse } from 'next/server';

import {
  createInternalComment,
  listCommentsForOrganization,
} from '@/lib/services/portal/client-comment-service';
import { isPortalResourceType } from '@/lib/portal/resource-registry';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawType = searchParams.get('resourceType');
    const resourceType = rawType && isPortalResourceType(rawType) ? rawType : undefined;

    const comments = await listCommentsForOrganization(resourceType);
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

    const comment = await createInternalComment(body);
    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
