import { NextResponse } from 'next/server';

import { apiErrorFrom } from '@/lib/api/route-error';
import { redeemEmailVerification } from '@/lib/services/auth/email-verification-service';
import { consumeRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit';
import { addressRateLimitKey } from '@/lib/security/rate-limit-subject';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const decision = await consumeRateLimit(
    addressRateLimitKey('email-verification-confirm', request),
    RATE_LIMITS['email-verification-confirm']
  );
  if (!decision.allowed) return rateLimitedResponse(decision);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    return NextResponse.json(await redeemEmailVerification(body), {
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
