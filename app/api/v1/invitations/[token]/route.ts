/**
 * AgencyOS Invitation preview API
 *
 * GET /api/v1/invitations/[token] - Public invitation details (org + role only)
 *
 * The unguessable token is the credential. No member, billing or contact data
 * is returned — only what the invited person needs to recognise the invite.
 */

import { NextResponse } from 'next/server';

import { getInvitationByToken } from '@/lib/services/admin/invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return NextResponse.json(await getInvitationByToken(token));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
