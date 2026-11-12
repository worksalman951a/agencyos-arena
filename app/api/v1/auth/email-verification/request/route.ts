import { NextResponse, after } from 'next/server';

import { EMAIL_VERIFICATION_REQUEST_MESSAGE } from '@/lib/auth/email-verification-policy';
import { emailVerificationRequestSchema } from '@/lib/schemas/auth/email-verification.schema';
import {
  discardEmailVerification,
  prepareEmailVerification,
} from '@/lib/services/auth/email-verification-service';
import { sendEmailVerificationEmail } from '@/lib/email/email-verification-emails';
import {
  consumeRateLimit,
  rateLimitKey,
  rateLimitedResponse,
  RATE_LIMITS,
} from '@/lib/security/rate-limit';
import { addressRateLimitKey } from '@/lib/security/rate-limit-subject';

export const dynamic = 'force-dynamic';

function uniformResponse() {
  return NextResponse.json(
    { status: true, message: EMAIL_VERIFICATION_REQUEST_MESSAGE },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  const byAddress = await consumeRateLimit(
    addressRateLimitKey('email-verification-request', request),
    RATE_LIMITS['email-verification-request']
  );
  if (!byAddress.allowed) return rateLimitedResponse(byAddress);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = emailVerificationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'A valid e-mail address is required' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { email } = parsed.data;
  const byAccount = await consumeRateLimit(
    rateLimitKey('email-verification-request-account', `email:${email}`),
    RATE_LIMITS['email-verification-request-account']
  );
  if (!byAccount.allowed) return rateLimitedResponse(byAccount);

  // Lookups, token preparation and SMTP all happen after the generic response;
  // account existence cannot be measured by request latency.
  after(async () => {
    try {
      const prepared = await prepareEmailVerification(email);
      if (!prepared) return;
      const delivery = await sendEmailVerificationEmail({
        to: prepared.to,
        token: prepared.token,
        expiresAt: prepared.expiresAt,
      });
      if (delivery.status !== 'sent') await discardEmailVerification(prepared.identifier);
    } catch (error) {
      console.error('[auth] ownership verification request could not be processed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  });

  return uniformResponse();
}
