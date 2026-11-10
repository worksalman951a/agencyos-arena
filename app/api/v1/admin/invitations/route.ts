/**
 * AgencyOS Admin Invitations API
 *
 * GET  /api/v1/admin/invitations - List organization invitations
 * POST /api/v1/admin/invitations - Invite an e-mail address (returns the token once)
 */

import { NextResponse } from 'next/server';

import { createInvitation, listInvitations } from '@/lib/services/admin/invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    return NextResponse.json(await listInvitations());
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const invitation = await createInvitation(body);
    return NextResponse.json(invitation, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}
