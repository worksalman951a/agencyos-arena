/**
 * AgencyOS Admin Invitations API
 *
 * GET  /api/v1/admin/invitations - List organization invitations
 * POST /api/v1/admin/invitations - Invite an e-mail address (returns the token once)
 *
 * POST is rate-limited per administrator (`invitation-create`): the endpoint
 * mints a bearer credential and is the entry point an attacker would use to
 * farm invitations, so it is throttled even though RBAC already gates it.
 * The bucket is keyed on the caller's session identity, not on the IP, because
 * several administrators legitimately share one office NAT.
 */

import { NextResponse } from 'next/server';

import { createInvitation, listInvitations } from '@/lib/services/admin/invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { withRateLimit } from '@/lib/security/rate-limit';
import { sessionRateLimitKey } from '@/lib/security/rate-limit-subject';

export async function GET() {
  try {
    return NextResponse.json(await listInvitations());
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  return withRateLimit(
    'invitation-create',
    await sessionRateLimitKey('invitation-create', request),
    () => createHandler(request)
  );
}

async function createHandler(request: Request): Promise<Response> {
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
