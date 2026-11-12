/**
 * Distributed rate limiting for AgencyOS' own API routes.
 *
 * Why not just Better Auth's limiter?
 * -----------------------------------
 * Better Auth's built-in limiter is applied inside its own handler, so it
 * covers `/api/auth/*` (and, as shipped, is disabled entirely when
 * `NODE_ENV !== "production"`). It does not see a single request to
 * `/api/v1/*`, the client-portal mutations or the public token endpoints —
 * which is exactly where an invitation token or a password can be guessed.
 *
 * Where Better Auth is sufficient we reuse it rather than adding a second
 * limiter in front of it (`/api/auth/sign-in`, `/sign-up`, …); the two never
 * overlap because this module is only wired into our own route handlers.
 *
 * Why PostgreSQL
 * --------------
 * The in-memory backends (Better Auth's default, and any `Map`-based limiter)
 * count per Node.js process. Behind more than one instance a client gets one
 * budget per instance, so the "limit" multiplies by the instance count and
 * resets on deploy. This deployment is a plain Node server on PostgreSQL
 * (ADR-0003) — there is no Redis to reach for, and inventing a dependency was
 * out of scope — so PostgreSQL is the shared store that already exists.
 *
 * The implementation is a single atomic `INSERT ... ON CONFLICT DO UPDATE`
 * (see `0001_rate_limit_bucket`): check-and-increment happens inside one
 * statement, so concurrent requests cannot all read a stale count before any
 * increment lands, and two app instances share the same bucket. Reads and
 * writes are scoped to the bucket's key, so no lock is taken on tenant tables.
 *
 * Serverless callers can swap the store with `AUTH_RATE_LIMIT_STORAGE=database`
 * in Better Auth's config, but for these routes there is no serverless target
 * yet; if the hosting ADR changes, replacing `consumeRateLimit` is the only
 * change required.
 */

import { prisma } from '@/lib/db';
import { CLIENT_ADDRESS_HEADER, resolveClientAddress } from '@/lib/security/client-address';

export interface RateLimitRule {
  /** Rolling window length in seconds. */
  window: number;
  /** Maximum requests allowed in the window. */
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests left in the current window (never negative). */
  remaining: number;
  /** Whole seconds until the window frees up; 0 when allowed. */
  retryAfter: number;
  limit: number;
  window: number;
}

/**
 * Named policies.
 *
 * Limits are deliberately generous enough for a NAT'd office and a page that
 * fires several requests on load, but small enough that an online guess is not
 * worth attempting. `window` is seconds.
 */
export const RATE_LIMITS = {
  /** Creating an invitation: an administrator-only action, few per day. */
  'invitation-create': { window: 60 * 60, max: 30 },
  /** Reading an invitation by token: enumeration attempts against a 32-byte token. */
  'invitation-preview': { window: 60, max: 120 },
  /** Redeeming an invitation: a real user does this once. */
  'invitation-accept': { window: 60 * 60, max: 20 },
  /** Client-portal invitation preview/accept, same reasoning as above. */
  'portal-invitation-preview': { window: 60, max: 120 },
  'portal-invitation-accept': { window: 60 * 60, max: 20 },
  /** Public document share links: view-only, but still a bearer credential. */
  'document-link-access': { window: 60, max: 120 },
  /** Organization bootstrap runs once per sign-up. */
  'organization-bootstrap': { window: 60 * 60, max: 10 },

  /* ---------------------------------------------------------------------
   * Better Auth endpoints. Wired through `rateLimit.customRules` in
   * lib/auth-server.ts so both halves of the limiter share one counter table.
   * ------------------------------------------------------------------- */

  /**
   * Sign-in: the credential-guessing surface. 10 per minute per address is
   * above any human pace and below a useful brute force (10/min ≈ 14k/day
   * against an unknown password for one address).
   */
  'auth-sign-in': { window: 60, max: 10 },
  /**
   * Sign-up: abused for junk accounts and e-mail flooding. The E2E suite
   * registers ~20 accounts per run from one address across several minutes, so
   * the ceiling is per minute rather than absolute.
   */
  'auth-sign-up': { window: 60, max: 20 },
  /** Password reset / change / verification resend: spam and enumeration. */
  'auth-sensitive': { window: 60, max: 5 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitPolicy = keyof typeof RATE_LIMITS;

/**
 * Truncate a client-controlled value (a token, a header) before it becomes part
 * of a bucket key, so an attacker cannot blow up the table by sending 8 KB
 * tokens and cannot make two different values collide by string truncation of a
 * hashed prefix. Hashing is done in SQL-free code to keep the key stable across
 * instances.
 */
import { createHash } from 'node:crypto';

export function rateLimitKey(policy: RateLimitPolicy, subject: string): string {
  const digest = createHash('sha256').update(subject).digest('hex').slice(0, 32);
  return `${policy}:${digest}`;
}

/**
 * The client address for a bucket.
 *
 * Middleware normalizes the address once and sets `x-agencyos-client-address`;
 * handlers read only that. The raw request is still consulted as a fallback so
 * calling a handler directly (unit tests, a future server-to-server caller)
 * degrades predictably instead of silently landing every caller in one bucket.
 */
export function clientAddressForRateLimit(
  headers: Pick<Headers, 'get'>,
  directAddress?: string | null
): string {
  return (
    headers.get(CLIENT_ADDRESS_HEADER) ?? resolveClientAddress(headers, directAddress) ?? 'unknown'
  );
}

/**
 * Consume one unit against `key` and report the decision.
 *
 * The SQL is a single statement:
 *   - no row           → insert with count 1 (allowed);
 *   - window elapsed   → reset count to 1 and restart the window;
 *   - count < max      → increment;
 *   - count >= max     → leave the row untouched (no increment past the cap).
 * `allowed` is derived from the row returned by the statement.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule
): Promise<RateLimitDecision> {
  // `prisma` is typed `any` on purpose (see lib/db.ts), so the generic form of
  // $queryRawUnsafe cannot be used; cast the result instead.
  const rows = (await prisma.$queryRawUnsafe(
    `
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt", "updatedAt")
    VALUES ($1, 1, NOW(), NOW() + ($2 || ' seconds')::interval, NOW())
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN 1
        WHEN "RateLimitBucket"."count" < $3 THEN "RateLimitBucket"."count" + 1
        ELSE "RateLimitBucket"."count"
      END,
      "windowStart" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN NOW()
        ELSE "RateLimitBucket"."windowStart"
      END,
      "expiresAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN NOW() + ($2 || ' seconds')::interval
        ELSE "RateLimitBucket"."expiresAt"
      END,
      "updatedAt" = NOW()
    RETURNING
      "count"::int AS count,
      GREATEST(CEIL(EXTRACT(EPOCH FROM ("RateLimitBucket"."expiresAt" - NOW()))), 0)::int AS retry_after
    `,
    key,
    String(rule.window),
    rule.max
  )) as { count: number; retry_after: number }[];

  const row = rows[0];
  const count = row?.count ?? 1;
  const retryAfter = row?.retry_after ?? 0;
  const allowed = count <= rule.max;

  return {
    allowed,
    remaining: Math.max(rule.max - count, 0),
    retryAfter: allowed ? 0 : retryAfter,
    limit: rule.max,
    window: rule.window,
  };
}

/**
 * `429 Too Many Requests` with the standard `Retry-After` and
 * `RateLimit-*` headers (RFC 6585 / draft-ietf-httpapi-ratelimit-headers).
 *
 * The body is deliberately generic: a rate-limit response must not disclose
 * whether the guessed token exists, only that the caller should slow down.
 */
export function rateLimitedResponse(decision: RateLimitDecision): Response {
  return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.max(decision.retryAfter, 1)),
      'RateLimit-Limit': String(decision.limit),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(Math.max(decision.retryAfter, 1)),
    },
  });
}

/** Headers advertising the remaining budget on a successful response. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    'RateLimit-Limit': String(decision.limit),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(decision.retryAfter),
  };
}

/**
 * Run a handler with one unit consumed against `policy`.
 *
 * Returns a `429` before the handler runs when the budget is exhausted, so the
 * expensive work (hashing a token, touching the database, verifying a password)
 * never happens on a throttled request.
 */
export async function withRateLimit(
  policy: RateLimitPolicy,
  subject: string,
  handler: () => Promise<Response>
): Promise<Response> {
  const rule = RATE_LIMITS[policy];
  const decision = await consumeRateLimit(rateLimitKey(policy, subject), rule);

  if (!decision.allowed) {
    return rateLimitedResponse(decision);
  }

  const response = await handler();
  for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
    response.headers.set(name, value);
  }
  return response;
}
