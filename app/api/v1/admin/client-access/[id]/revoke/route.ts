/**
 * POST /api/v1/admin/client-access/:id/revoke - permanently revoke portal access.
 *
 * Revocation deletes the client's sessions and disables the login; it is
 * audited and cannot be undone (a new invitation is required).
 */

import { NextResponse } from 'next/server';

import { revokeClientAccess } from '@/lib/services/portal/client-access-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const revoked = await revokeClientAccess(id, body ?? {});
    return NextResponse.json(revoked);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
