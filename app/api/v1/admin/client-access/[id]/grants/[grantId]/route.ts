/**
 * DELETE /api/v1/admin/client-access/:id/grants/:grantId - withdraw one share.
 *
 * The grant id is looked up within the client access and organization, so a
 * guessed grant id from another tenant answers 404.
 */

import { NextResponse } from 'next/server';

import { revokeClientGrant } from '@/lib/services/portal/client-access-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; grantId: string }> }
) {
  try {
    const { id, grantId } = await params;
    const revoked = await revokeClientGrant(id, grantId);
    return NextResponse.json(revoked);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
