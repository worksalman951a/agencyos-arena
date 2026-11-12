/**
 * AgencyOS Invitation preview API
 *
 * GET /api/v1/invitations/[token] - Public invitation details (org + role only)
 *
 * The unguessable token is the credential. No member, billing or contact data
 * is returned — only what the invited person needs to recognise the invite.
 *
 * Rate-limited by client address (`invitation-preview`): the endpoint is public
 * and answers differently for a live and a dead token, so it is the natural
 * oracle for a token-guessing attempt. Throttling is by IP because there is no
 * session to key on yet.
 */

import { NextResponse } from 'next/server';

import { getInvitationByToken } from '@/lib/services/admin/invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { consumeRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit';
import { addressRateLimitKey } from '@/lib/security/rate-limit-subject';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const decision = await consumeRateLimit(
    addressRateLimitKey('invitation-preview', request),
    RATE_LIMITS['invitation-preview']
  );
  if (!decision.allowed) return rateLimitedResponse(decision);

  try {
    return NextResponse.json(await getInvitationByToken(token));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
