/**
 * AgencyOS Invitation acceptance API
 *
 * POST /api/v1/invitations/accept - Join the organization the token belongs to.
 *
 * Requires a signed-in session whose e-mail matches the invitation. The token
 * alone is never sufficient (see invitation-service).
 */

import { NextResponse } from 'next/server';

import { acceptInvitation } from '@/lib/services/admin/invitation-service';
import { invitationAcceptSchema } from '@/lib/schemas/admin/invitation.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(request: Request) {
  try {
    const parsed = invitationAcceptSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', issues: parsed.error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(await acceptInvitation(parsed.data.token));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
