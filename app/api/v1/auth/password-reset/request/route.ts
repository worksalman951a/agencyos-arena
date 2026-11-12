/**
 * POST /api/v1/auth/password-reset/request - ask for a password-reset link.
 *
 * Public by design (the caller cannot sign in). It is still a state-changing
 * request, so `middleware.ts` applies the same Origin/CSRF rule as every other
 * `/api/v1/*` mutation.
 *
 * Enumeration resistance:
 *  - a known and an unknown address get the same status, the same body and the
 *    same headers;
 *  - the message is sent from an `after()` task, so the response does not wait
 *    for SMTP. Whether the account exists is not measurable from how long the
 *    request takes, and an unavailable relay cannot delay (or distinguish) one
 *    case;
 *  - the rate-limit budgets are charged before the lookup, so exhausting them
 *    is also independent of account existence.
 *
 * The token itself never appears in the response. It is handed to the mailer
 * inside this process only.
 */

import { NextResponse, after } from 'next/server';

import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  discardPasswordReset,
  preparePasswordReset,
} from '@/lib/services/auth/password-reset-service';
import { sendPasswordResetEmail } from '@/lib/email/password-reset-emails';
import { passwordResetRequestSchema } from '@/lib/schemas/auth/password-reset.schema';
import {
  consumeRateLimit,
  rateLimitKey,
  rateLimitedResponse,
  RATE_LIMITS,
} from '@/lib/security/rate-limit';
import { addressRateLimitKey } from '@/lib/security/rate-limit-subject';

export const dynamic = 'force-dynamic';

/** The one answer for a validly-shaped request, whatever the account is. */
function uniformResponse() {
  return NextResponse.json(
    { status: true, message: PASSWORD_RESET_REQUEST_MESSAGE },
    {
      status: 200,
      headers: {
        // Never let a shared cache serve one requester's answer to another.
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function POST(request: Request) {
  // 1. Per client address. Charged before anything is looked up.
  const byAddress = await consumeRateLimit(
    addressRateLimitKey('password-reset-request', request),
    RATE_LIMITS['password-reset-request']
  );
  if (!byAddress.allowed) return rateLimitedResponse(byAddress);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = passwordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'A valid e-mail address is required' },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  // 2. Per recipient address, whoever is asking. A digest is the bucket key;
  //    the address itself is never stored by the limiter.
  const byAccount = await consumeRateLimit(
    rateLimitKey('password-reset-request-account', `email:${email}`),
    RATE_LIMITS['password-reset-request-account']
  );
  if (!byAccount.allowed) return rateLimitedResponse(byAccount);

  const prepared = await preparePasswordReset(email);

  if (prepared) {
    after(async () => {
      const delivery = await sendPasswordResetEmail({
        to: prepared.to,
        resetPath: prepared.resetPath,
        expiresAt: prepared.expiresAt,
      });

      // Only a message the mail server accepted leaves its link redeemable.
      // Delivery disabled, configuration invalid, a budget exhausted or an
      // unreachable relay all mean the recipient never got a link.
      if (delivery.status !== 'sent') {
        await discardPasswordReset(prepared.identifier);
      }
    });
  }

  return uniformResponse();
}
