/**
 * POST /api/v1/auth/password-reset/confirm - redeem a reset token.
 *
 * Public (the user cannot sign in) and Origin-checked by `middleware.ts` like
 * every mutating `/api/v1/*` route. The token is in the JSON body rather than
 * the query string, so it does not end up in access logs or a Referer header;
 * the page that collects it is `no-referrer` as well.
 *
 * The service checks the password policy before spending the token, consumes
 * it atomically, re-checks the account status and then revokes every session
 * for the account. Expired, invalid, reused and inactive-account tokens share
 * one status and one message.
 */

import { NextResponse } from 'next/server';

import { redeemPasswordReset } from '@/lib/services/auth/password-reset-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { consumeRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit';
import { addressRateLimitKey } from '@/lib/security/rate-limit-subject';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const decision = await consumeRateLimit(
    addressRateLimitKey('password-reset-confirm', request),
    RATE_LIMITS['password-reset-confirm']
  );
  if (!decision.allowed) return rateLimitedResponse(decision);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const result = await redeemPasswordReset(body);
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const { status, message } = apiErrorFrom(error);
    return NextResponse.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
