/**
 * AgencyOS authentication - server-only (ADR-0001).
 *
 * Better Auth with Prisma adapter for PostgreSQL.
 * This module imports Prisma and must only be imported in server contexts
 * (API routes, middleware, server components).
 *
 * No external provider credentials required for local development.
 * Email/WhatsApp/e-signature/AI integrations remain interface-only in MVP.
 *
 * Origin configuration:
 * - baseURL is resolved from BETTER_AUTH_URL, then NEXT_PUBLIC_APP_URL,
 *   then falls back to http://localhost:3001 for local development.
 *   Port 3000 is reserved for a separate local project and is never used.
 * - trustedOrigins always includes baseURL plus any additional origins
 *   listed in the comma-separated TRUSTED_ORIGINS env var.
 *   Use TRUSTED_ORIGINS for GitHub Codespaces forwarded HTTPS domains.
 */

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/lib/db';
import { isAccountIdActive } from '@/lib/auth/account-eligibility';
import { VERIFICATION_ADDITIONAL_FIELDS } from '@/lib/auth/verification-schema';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_TTL_SECONDS,
} from '@/lib/auth/password-reset-policy';
import { RATE_LIMITS, consumeRateLimit } from '@/lib/security/rate-limit';

/**
 * Base URL of the application. Used by Better Auth for origin validation,
 * session cookies, and redirect URLs.
 *
 * Precedence:
 * 1. BETTER_AUTH_URL (explicit auth base URL)
 * 2. NEXT_PUBLIC_APP_URL (public app URL)
 * 3. http://localhost:3001 (local development fallback; port 3000 is reserved
 *    for a separate local project)
 */
const baseURL =
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

/**
 * Additional trusted origins beyond baseURL, parsed from a comma-separated
 * TRUSTED_ORIGINS environment variable. Used for GitHub Codespaces forwarded
 * HTTPS domains and other reverse-proxy scenarios.
 *
 * Example: TRUSTED_ORIGINS="https://codespace-1-3001.app.github.dev,https://codespace-2-3001.app.github.dev"
 */
const trustedOriginsFromEnv = process.env.TRUSTED_ORIGINS
  ? process.env.TRUSTED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

/**
 * Trusted origins for origin/CSRF validation. Always includes baseURL plus
 * any additional origins from TRUSTED_ORIGINS. Deduplicated.
 */
const trustedOrigins = Array.from(new Set([baseURL, ...trustedOriginsFromEnv]));

/**
 * Better Auth instance configured with Prisma adapter.
 * Server-only: imports Prisma Client which is not available in the browser.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  baseURL,
  trustedOrigins,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh session cookie every 24h
  },
  emailAndPassword: {
    enabled: true,
    // Preserve existing sign-in behavior during rollout. Ownership is recorded
    // by our hash-only custom flow, while portal invitation linking checks the
    // flag explicitly; global blocking would lock out legacy administrators.
    requireEmailVerification: false,
    autoSignIn: false,
    // Stated explicitly (they match the vendor defaults) so sign-up and the
    // reset flow use the same policy constants.
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    /**
     * No `sendResetPassword` hook is configured on purpose.
     *
     * Better Auth's `/request-password-reset` endpoint stores the raw token in
     * `Verification.identifier` and would then need a hook to mail it. This
     * application only stores token hashes, so recovery uses
     * `lib/services/auth/password-reset-service.ts`: the same `Verification`
     * table, the same atomic single-use consume and the same Scrypt hasher, but
     * under the `password-reset:<sha256>` namespace. With no hook configured,
     * the vendor endpoint answers `RESET_PASSWORD_DISABLED` instead of minting
     * a plaintext credential.
     *
     * The two options below are therefore latent for that endpoint. They are
     * set to the values the custom flow already enforces, so enabling the
     * vendor path later cannot silently lengthen the link's lifetime or skip
     * session revocation.
     */
    resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
    revokeSessionsOnPasswordReset: true,
  },
  /**
   * This project's `Verification` row belongs to a user (`userId` is required
   * by the Prisma model, so an orphan token is impossible). The vendor's
   * default verification model has no such field, and its adapter's input
   * transform copies only declared fields - without this declaration the
   * column is dropped before Prisma sees it and every create fails.
   *
   * Declaring it here keeps password recovery on the vendor's
   * `createVerificationValue`/`consumeVerificationValue` pair instead of
   * writing the table directly.
   */
  verification: {
    additionalFields: VERIFICATION_ADDITIONAL_FIELDS,
  },
  /**
   * A session may only be created for an identity that is allowed to hold one.
   *
   * - Client-portal identities may hold a session only while their access is
   *   active. Suspending or revoking an access already deletes the client's
   *   sessions; this hook closes the re-login path, so a suspended/revoked
   *   client cannot mint a fresh session and then sit on the portal's
   *   "forbidden" page.
   * - Internal team members may hold a session only while their account is
   *   active. Suspension sets `status = "suspended"`; removal clears the
   *   organization link *and* sets the status to `suspended` (the row and its
   *   login survive). Requiring the active status closes the sign-in path for
   *   both. The status is re-checked on every request in `requireOrganization`,
   *   so a session minted in the narrow race window before a suspension is still
   *   rejected when it is actually used.
   */
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // One predicate, shared with password recovery, so the two paths
          // cannot disagree about a suspended, removed or revoked account.
          // An account that no longer exists never mints a session.
          return isAccountIdActive(session.userId);
        },
      },
    },
  },
  /**
   * Better Auth's own rate limiting (sign-in, sign-up, password reset, …).
   *
   * What is kept from the vendor:
   *  - `enabled` stays at its documented default (`NODE_ENV === "production"`).
   *    That is not a weakened setting: it is the vendor's contract, and the
   *    integration job deliberately runs the built server with
   *    `NODE_ENV=test` because it drives dozens of sign-ins from a single
   *    address per suite. Production (`next start`, NODE_ENV=production) and the
   *    Playwright job both have the limiter on.
   *
   * What is changed, and why:
   *  - **Storage**: the default in-memory `Map` counts per Node process, so two
   *    instances each grant a client a full budget. `customStorage` points the
   *    limiter at the shared PostgreSQL bucket table used by our own routes
   *    (`lib/security/rate-limit.ts`, migration `0019_rate_limit_bucket`), so
   *    the deployment has exactly one distributed limiter rather than an
   *    in-memory control pretending to be one.
   *  - **Rules**: per-endpoint ceilings come from `RATE_LIMITS` so the two
   *    halves of the system cannot drift. All of them are at least as strict as
   *    the vendor defaults they replace (`/sign-in*`, `/sign-up*`,
   *    `/change-password`, `/change-email` were 3 per 10 s; password reset was
   *    3 per 60 s).
   */
  rateLimit: {
    customStorage: {
      consume: (key, rule) => consumeRateLimit(key, rule),
    },
    customRules: {
      '/sign-in/email': RATE_LIMITS['auth-sign-in'],
      '/sign-up/email': RATE_LIMITS['auth-sign-up'],
      '/change-password': RATE_LIMITS['auth-sensitive'],
      '/change-email': RATE_LIMITS['auth-sensitive'],
      '/request-password-reset': RATE_LIMITS['auth-sensitive'],
      // The vendor redemption endpoint cannot consume this application's
      // hashed rows (different identifier namespace), but an open guessing
      // surface is still bounded rather than left unlimited.
      '/reset-password': RATE_LIMITS['auth-sensitive'],
      '/send-verification-email': RATE_LIMITS['auth-sensitive'],
    },
  },
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      secure: baseURL.startsWith('https://') || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    },
  },
});

export type Session = typeof auth.$Infer.Session;

/**
 * Server-side session validation helper.
 * Used by middleware and API routes to validate session tokens.
 */
export async function validateSession(headers: HeadersInit) {
  return auth.api.getSession({ headers });
}
