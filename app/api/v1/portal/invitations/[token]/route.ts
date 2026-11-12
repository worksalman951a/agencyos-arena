/**
 * GET /api/v1/portal/invitations/:token - public invitation details.
 *
 * Unauthenticated by design: the unguessable token is the credential, and the
 * response discloses only the organization name, the contact name and the
 * invited e-mail address. Expired, revoked and replayed tokens answer 410.
 *
 * Rate-limited by client address (`portal-invitation-preview`) because the
 * status difference between a live and a dead token makes this an oracle for
 * token enumeration.
 */

import { NextResponse } from 'next/server';

import { getClientInvitationByToken } from '@/lib/services/portal/client-invitation-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { consumeRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit';
import { addressRateLimitKey } from '@/lib/security/rate-limit-subject';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const decision = await consumeRateLimit(
    addressRateLimitKey('portal-invitation-preview', _request),
    RATE_LIMITS['portal-invitation-preview']
  );
  if (!decision.allowed) return rateLimitedResponse(decision);

  try {
    const invitation = await getClientInvitationByToken(token);
    return NextResponse.json(invitation);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
