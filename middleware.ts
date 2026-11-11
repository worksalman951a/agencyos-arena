/**
 * AgencyOS middleware (ADR-0004).
 *
 * Phase 0: Edge-safe cookie presence check for protected routes.
 *
 * This middleware runs in the Next.js Edge Runtime. It only performs a
 * lightweight cookie-presence check: if no `better-auth.session_token` cookie
 * exists, unauthenticated requests to protected paths are redirected to login.
 *
 * Full database-backed session validation is intentionally NOT performed here.
 * Prisma and Better Auth server instances require the Node.js runtime and
 * cannot be imported in Edge middleware. Session validation is handled by
 * protected server layouts (e.g. app/dashboard/layout.tsx) which run in the
 * Node.js server runtime and can safely import @/lib/auth-server.
 *
 * Authorization (role-based, resource-level) is enforced in API route
 * handlers and the service layer (see lib/permissions.ts).
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Public paths that don't require authentication
const PUBLIC_PATHS = ['/', '/login', '/register', '/invite', '/share', '/api/auth', '/api/health'];

// Paths that require authentication (protected app routes)
const PROTECTED_PATH_PREFIXES = [
  '/dashboard',
  '/crm',
  '/sales',
  '/finance',
  '/projects',
  '/documents',
  '/automation',
  '/admin',
  '/settings',
];

export async function middleware(request: Request) {
  const { pathname } = new URL(request.url);

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Edge-safe cookie presence check only.
  // Better Auth cookie name: better-auth.session_token
  // (cookiePrefix "better-auth" + cookieName "session_token").
  // On HTTPS with the Secure attribute, browsers expose the cookie with a
  // "__Secure-" prefix (e.g. __Secure-better-auth.session_token). Check both
  // names so the middleware works on both HTTP localhost and HTTPS Codespaces.
  // No Prisma, no Better Auth, no Node.js-specific imports.
  const cookieStore = await cookies();
  const sessionCookie =
    cookieStore.get('__Secure-better-auth.session_token') ??
    cookieStore.get('better-auth.session_token');

  if (!sessionCookie) {
    // No session cookie -> redirect to login for protected app routes
    if (PROTECTED_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  // Cookie present -> allow request; session validation occurs in server layout
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)',
  ],
};
