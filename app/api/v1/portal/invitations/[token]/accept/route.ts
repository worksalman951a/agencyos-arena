/**
 * POST /api/v1/portal/invitations/:token/accept - redeem an invitation.
 *
 * Requires a signed-in session whose e-mail matches the invitation, and refuses
 * to convert an existing team member or an existing client identity. The
 * created identity has no organization membership and no internal roles.
 */

import { NextResponse } from 'next/server';

import { acceptClientInvitation } from '@/lib/services/portal/client-invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const accepted = await acceptClientInvitation(token);
    return NextResponse.json(accepted);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
