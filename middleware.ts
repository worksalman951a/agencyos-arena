/**
 * AgencyOS edge middleware: cross-origin enforcement and address normalization.
 *
 * Two jobs, in order:
 *
 *  1. **CSRF / cross-origin enforcement** for our own state-changing routes.
 *     Better Auth validates the Origin of the requests it serves; the
 *     `/api/v1/*` mutations and `bootstrap-organization` are served by our code
 *     and had no origin check. Doing it here (rather than in ~90 handlers)
 *     means a route added later is covered automatically, and
 *     `lib/__tests__/security/csrf-coverage.test.ts` fails if a new route lands
 *     outside the protected patterns without justification.
 *
 *  2. **Client-address normalization** for rate limiting. Handlers must never
 *     parse `X-Forwarded-For` themselves — a client can send any value and
 *     would get a fresh bucket per request. Middleware resolves the address
 *     once and writes it to `x-agencyos-client-address`, overwriting anything
 *     the client sent, so the header handlers read is server-produced.
 *
 * What is not touched:
 *  - Safe methods (GET/HEAD/OPTIONS) are never refused. Navigations carry no
 *    Origin and a GET must not change state.
 *  - `/api/auth/*` keeps Better Auth's own, stricter origin + Fetch Metadata
 *    validation. Duplicating it here could only diverge from it.
 *  - Public token endpoints still get the origin rule on mutation: the token is
 *    the credential for the *resource*, not a CSRF exemption.
 *  - The existing session-cookie redirect logic for page routes is preserved.
 *
 * Runtime: Next.js 16 runs this file on the Node.js runtime and compiles it
 * separately from `serverExternalPackages`, so this module uses only
 * Web-standard APIs plus pure helpers that import nothing server-only.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { checkRequestOrigin } from '@/lib/security/origin';
import { CLIENT_ADDRESS_HEADER, resolveClientAddress } from '@/lib/security/client-address';

// Public paths that don't require authentication
//
// `/portal/invite` and `/portal/login` are public because an invitee has no
// session yet; the rest of `/portal` requires a session, and the portal layout
// additionally requires an active client access row.
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/register',
  '/invite',
  '/share',
  // Password recovery is for visitors who cannot sign in. The routes under
  // `/api/v1/auth/password-reset/*` are not listed here: they need no session
  // gate, but they do need the `/api/v1/` Origin check above, and leaving them
  // out keeps that handler path identical to every other mutating API route.
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/api/auth',
  '/api/health',
  '/portal/invite',
  '/portal/login',
];

// Paths that require authentication (protected app routes)
const PROTECTED_PATH_PREFIXES = [
  '/dashboard',
  '/portal',
  '/crm',
  '/sales',
  '/finance',
  '/projects',
  '/documents',
  '/automation',
  '/admin',
  '/settings',
];

/** Mutating routes owned by AgencyOS that must be origin-checked. */
const CSRF_PROTECTED_API_PREFIXES = ['/api/v1/'];

/**
 * Cookie-authenticated mutations outside Better Auth's own handler. A future
 * sibling route would not be covered, which is why
 * `csrf-coverage.test.ts` asserts every mutating route is either under
 * `/api/v1/`, listed here, or explicitly justified.
 */
const CSRF_PROTECTED_EXTRA_PATHS = ['/api/auth/bootstrap-organization'];

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isCsrfProtectedPath(pathname: string): boolean {
  if (CSRF_PROTECTED_EXTRA_PATHS.includes(pathname)) return true;
  return CSRF_PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = (request.method ?? 'GET').toUpperCase();

  // -------------------------------------------------------------------------
  // 1. CSRF / cross-origin enforcement.
  //
  // Reject before the handler, the session lookup or any database work. 403
  // (not 401) so it is distinguishable from "you are not signed in", and the
  // body names no resource.
  // -------------------------------------------------------------------------
  if (!CSRF_SAFE_METHODS.has(method) && isCsrfProtectedPath(pathname)) {
    const verdict = checkRequestOrigin(request);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: 'Cross-origin request rejected' },
        {
          status: 403,
          headers: {
            // Never let a browser cache a rejected CSRF response.
            'Cache-Control': 'no-store',
            Vary: 'Origin',
          },
        }
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. Client-address normalization for API rate limiting.
  //
  // Only API routes pay for this; page navigations are unaffected. The header
  // is rebuilt from scratch and set explicitly, so a client-supplied copy is
  // discarded rather than trusted.
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    const headers = new Headers(request.headers);
    headers.delete(CLIENT_ADDRESS_HEADER);
    const address = resolveClientAddress(request.headers);
    if (address) headers.set(CLIENT_ADDRESS_HEADER, address);

    if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      return NextResponse.next({ request: { headers } });
    }

    return withSessionGate(request, pathname, headers);
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  return withSessionGate(request, pathname, null);
}

/**
 * Session-cookie presence check (ADR-0004).
 *
 * This is a lightweight redirect guard, not authentication: full
 * database-backed validation happens in the protected server layouts and the
 * service layer, which run in the Node.js runtime and can import
 * `@/lib/auth-server`.
 *
 * Better Auth cookie name: `better-auth.session_token`. On HTTPS with the
 * `Secure` attribute browsers expose it with a `__Secure-` prefix, so both
 * names are checked.
 */
async function withSessionGate(request: Request, pathname: string, headers: Headers | null) {
  const cookieStore = await cookies();
  const sessionCookie =
    cookieStore.get('__Secure-better-auth.session_token') ??
    cookieStore.get('better-auth.session_token');

  const next = () => (headers ? NextResponse.next({ request: { headers } }) : NextResponse.next());

  if (!sessionCookie) {
    // No session cookie -> redirect to login for protected app routes.
    //
    // The portal has its own sign-in page: sending a client to the team login
    // would be a dead end (a client has no workspace), so /portal/* goes to
    // /portal/login instead.
    if (PROTECTED_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
      const loginPath = pathname.startsWith('/portal') ? '/portal/login' : '/login';
      return NextResponse.redirect(new URL(loginPath, request.url));
    }
    return next();
  }

  // Cookie present -> allow the request; session validation happens later.
  return next();
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
