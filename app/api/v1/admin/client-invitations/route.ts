/**
 * GET  /api/v1/admin/client-invitations - list client invitations.
 * POST /api/v1/admin/client-invitations - invite a contact into the portal.
 *
 * The raw token is returned exactly once; only its hash is stored.
 *
 * POST also e-mails the acceptance link to the invited address when e-mail
 * delivery is enabled (docs/phase-4d/email-delivery.md). The response always
 * carries `emailDelivery` - `sent`, `failed` (with a reason) or `disabled` - and
 * stays 201 either way: a failed e-mail does not undo the invitation.
 */

import { NextResponse } from 'next/server';

import {
  createClientInvitation,
  listClientInvitations,
} from '@/lib/services/portal/client-invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const invitations = await listClientInvitations();
    return NextResponse.json({ data: invitations });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const invitation = await createClientInvitation(body);
    return NextResponse.json(invitation, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
