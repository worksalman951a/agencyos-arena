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
    requireEmailVerification: false,
    autoSignIn: false,
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
