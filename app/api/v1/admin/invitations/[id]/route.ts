/**
 * AgencyOS Admin Invitation API - Single Invitation
 *
 * DELETE /api/v1/admin/invitations/[id] - Revoke a pending invitation
 */

import { NextResponse } from 'next/server';

import { revokeInvitation } from '@/lib/services/admin/invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await revokeInvitation(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
