/**
 * GET /api/v1/admin/client-access - list portal identities for the organization.
 *
 * Organization scoping and the `client.access.read` permission are enforced in
 * the service; the route never accepts an organization id.
 */

import { NextResponse } from 'next/server';

import { listClientAccesses } from '@/lib/services/portal/client-access-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const accesses = await listClientAccesses();
    return NextResponse.json({ data: accesses });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
