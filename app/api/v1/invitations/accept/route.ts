/**
 * AgencyOS Invitation acceptance API
 *
 * POST /api/v1/invitations/accept - Join the organization the token belongs to.
 *
 * Requires a signed-in session whose e-mail matches the invitation. The token
 * alone is never sufficient (see invitation-service).
 *
 * Two independent controls apply before the handler runs:
 *  - CSRF: the Origin must be trusted (enforced in `middleware.ts` for every
 *    mutating `/api/v1/*` request). The token authorises the *resource*, not
 *    the cross-site request.
 *  - Rate limiting (`invitation-accept`, per **session**): redemption needs a
 *    session whose e-mail matches the invitation, so a burst from one identity
 *    is either a replay loop or an attempt to brute-force a token. Keying on the
 *    address instead would penalise every colleague behind the same NAT.
 */

import { NextResponse } from 'next/server';

import { acceptInvitation } from '@/lib/services/admin/invitation-service';
import { invitationAcceptSchema } from '@/lib/schemas/admin/invitation.schema';
import { apiErrorFrom } from '@/lib/api/route-error';
import { consumeRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit';
import { sessionRateLimitKey } from '@/lib/security/rate-limit-subject';

export async function POST(request: Request) {
  const decision = await consumeRateLimit(
    await sessionRateLimitKey('invitation-accept', request),
    RATE_LIMITS['invitation-accept']
  );
  if (!decision.allowed) return rateLimitedResponse(decision);

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
