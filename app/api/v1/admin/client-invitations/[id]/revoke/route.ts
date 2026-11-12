/**
 * POST /api/v1/admin/client-invitations/:id/revoke - revoke a pending invitation.
 */

import { NextResponse } from 'next/server';

import { revokeClientInvitation } from '@/lib/services/portal/client-invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const revoked = await revokeClientInvitation(id);
    return NextResponse.json(revoked);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
