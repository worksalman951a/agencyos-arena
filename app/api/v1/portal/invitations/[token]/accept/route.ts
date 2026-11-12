/**
 * POST /api/v1/portal/invitations/:token/accept - redeem an invitation.
 *
 * Requires a signed-in session whose e-mail matches the invitation, and refuses
 * to convert an existing team member or an existing client identity. The
 * created identity has no organization membership and no internal roles.
 *
 * Origin validation happens in `middleware.ts` (all mutating `/api/v1/*`
 * requests); the token does not exempt this route from CSRF protection because
 * the request still carries a session cookie. A second control,
 * `portal-invitation-accept` rate limiting, bounds token guessing per session
 * (the route requires a signed-in invitee), so it never penalises an entire
 * office sharing one egress address.
 */

import { NextResponse } from 'next/server';

import { acceptClientInvitation } from '@/lib/services/portal/client-invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { consumeRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit';
import { sessionRateLimitKey } from '@/lib/security/rate-limit-subject';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const decision = await consumeRateLimit(
    await sessionRateLimitKey('portal-invitation-accept', request),
    RATE_LIMITS['portal-invitation-accept']
  );
  if (!decision.allowed) return rateLimitedResponse(decision);

  try {
    const { token } = await params;
    const accepted = await acceptClientInvitation(token);
    return NextResponse.json(accepted);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
