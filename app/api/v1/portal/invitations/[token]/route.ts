/**
 * GET /api/v1/portal/invitations/:token - public invitation details.
 *
 * Unauthenticated by design: the unguessable token is the credential, and the
 * response discloses only the organization name, the contact name and the
 * invited e-mail address. Expired, revoked and replayed tokens answer 410.
 */

import { NextResponse } from 'next/server';

import { getClientInvitationByToken } from '@/lib/services/portal/client-invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invitation = await getClientInvitationByToken(token);
    return NextResponse.json(invitation);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
