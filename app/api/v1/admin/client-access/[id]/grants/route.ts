/**
 * GET  /api/v1/admin/client-access/:id/grants - list shares for one client.
 * POST /api/v1/admin/client-access/:id/grants - share one resource with them.
 *
 * The resource must exist in the actor's organization; a foreign id is a 404.
 */

import { NextResponse } from 'next/server';

import {
  listClientGrants,
  shareResourceWithClient,
} from '@/lib/services/portal/client-access-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const grants = await listClientGrants(id);
    return NextResponse.json({ data: grants });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const grant = await shareResourceWithClient(id, body);
    return NextResponse.json(grant, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
