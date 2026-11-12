/**
 * Bucket-key helpers for the app-owned routes (`/api/v1/*`).
 *
 * Who is throttled matters as much as how much. Two rules are applied:
 *
 *  1. **Authenticated routes** are keyed on the session identity, not the
 *     address. Several people in one agency share an office NAT, and a shared
 *     address must not let one client exhaust everyone else's budget. Better
 *     Auth has already authenticated the caller before the handler runs, so the
 *     session token is available and is hashed into the bucket key.
 *
 *  2. **Public routes** (invitation preview, token redemption) have no session,
 *     so they are keyed on the client address from `clientAddressForRateLimit`,
 *     which ignores `X-Forwarded-For` unless `TRUST_PROXY_HEADERS` says a
 *     trusted proxy sets it — otherwise the header is a free bucket generator.
 *
 * When there is no session (an unauthenticated probe of an authenticated
 * route), the fallback is the address, so the probe is still bounded.
 */

import { cookies } from 'next/headers';

import {
  clientAddressForRateLimit,
  rateLimitKey,
  type RateLimitPolicy,
} from '@/lib/security/rate-limit';

/** Bucket key for the signed-in caller. */
export async function sessionRateLimitKey(
  policy: RateLimitPolicy,
  request: Request
): Promise<string> {
  const cookieStore = await cookies();
  const session =
    cookieStore.get('better-auth.session_token') ??
    cookieStore.get('__Secure-better-auth.session_token');
  if (session?.value) return rateLimitKey(policy, `session:${session.value}`);
  return rateLimitKey(policy, `address:${clientAddressForRateLimit(request.headers)}`);
}

/** Bucket key for an anonymous caller. */
export function addressRateLimitKey(policy: RateLimitPolicy, request: Request): string {
  return rateLimitKey(policy, `address:${clientAddressForRateLimit(request.headers)}`);
}
