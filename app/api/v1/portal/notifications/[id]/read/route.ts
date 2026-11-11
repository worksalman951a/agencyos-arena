/**
 * POST /api/v1/portal/notifications/:id/read - mark one notification read.
 *
 * The lookup is scoped to the caller's own user id, so another client's or a
 * teammate's notification id answers 404.
 */

import { NextResponse } from 'next/server';

import { markPortalNotificationRead } from '@/lib/services/portal/portal-workspace-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await markPortalNotificationRead(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
