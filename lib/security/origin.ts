/**
 * Cross-origin protection for AgencyOS' own routes and Server Actions.
 *
 * What this module is for
 * -----------------------
 * Better Auth validates the Origin of the requests it serves (`/api/auth/*`):
 * every state-changing call that carries a session cookie must name a trusted
 * origin, and a call with no origin at all is refused. That protection stops at
 * the Better Auth handler. Everything else in this application — the
 * `/api/v1/*` mutations, the client-portal mutations and the Server Actions the
 * UI invokes — is served by our own code and had no Origin check at all.
 *
 * Those routes authenticate with the same `better-auth.session_token` cookie
 * and use `SameSite=Lax`, which the browser does *not* attach to a cross-site
 * `POST`. That is a real mitigation, not a defence in depth one can rely on:
 * `Lax` was chosen so links to the app work, the cookie attribute is not
 * enforced at all by non-browser clients (and is absent on any deployment where
 * `secure` is false), and relying on a single vendor default as the sole
 * control is exactly what the Ph4D security review asked us to stop doing.
 *
 * The model implemented here
 * --------------------------
 * Same-origin policy in the browser already makes `Origin` unforgeable for a
 * cross-site request, so validating it server-side is the standard CSRF
 * defence (OWASP "Verifying Origin With Standard Headers").
 *
 *  - **Unsafe methods** (POST/PUT/PATCH/DELETE) to our own API must name a
 *    trusted origin. If `Origin` is absent we fall back to `Referer`; if both
 *    are absent the request is refused with 403. This is the same contract
 *    Better Auth applies to its own endpoints, so browser form posts and
 *    `fetch()` calls from the app succeed and a cross-site submission is
 *    rejected while remaining consistent for API clients.
 *  - **Safe methods** (GET/HEAD/OPTIONS) are never refused here. Rejecting a
 *    GET on a missing Origin would break top-level navigations (link clicks,
 *    bookmarks) and Server Component fetches, and a GET must not change state
 *    anyway. The one public read that meters (the document-share view) is
 *    called out in `docs/phase-4d/csrf-and-rate-limiting.md` as remaining risk
 *    rather than silently excluded.
 *  - Public token endpoints are listed in `PUBLIC_TOKEN_PATHS` and accept a
 *    token in the path. They still enforce the same origin rule on mutation:
 *    the token authorises the *resource*, it never waives CSRF protection.
 *    That keeps invitation/purchase-order workflows usable from the invitation
 *    page (same origin) while a third-party site cannot replay them.
 *
 * What this module deliberately does not do
 * -----------------------------------------
 * It does not authenticate or authorise: callers must still resolve the session
 * and permissions afterwards, unchanged. It does not read `Forwarded` /
 * `X-Forwarded-Host` to guess the deployment origin — those headers are
 * client-controlled unless a trusted proxy sets them, and guessing here would
 * turn a spoofable header into an accepted origin. Trusted origins come from
 * configuration (`BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_ORIGINS`),
 * exactly the same list Better Auth uses.
 */

/** Methods that must never be refused for lacking an Origin header. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Paths whose credential is a token rather than a session cookie.
 *
 * They are public (no session), but a mutation still requires a trusted origin.
 * Listing them explicitly keeps the allow-list reviewable and prevents an
 * accidental "no session → skip CSRF" shortcut from being reintroduced.
 */
export const PUBLIC_TOKEN_PATHS = [
  '/api/v1/invitations/',
  '/api/v1/portal/invitations/',
  '/api/v1/documents/links/',
] as const;

/**
 * The origins this deployment accepts, mirroring `lib/auth-server.ts`:
 * `BETTER_AUTH_URL`, then `NEXT_PUBLIC_APP_URL`, then the localhost default,
 * plus any comma-separated `TRUSTED_ORIGINS` entries.
 */
export function trustedOrigins(): string[] {
  // `||`, not `??`: an empty-string env var must fall through to the next
  // source, otherwise a deployment that sets `BETTER_AUTH_URL=""` would trust
  // the empty string and refuse every genuine request. Same precedence as
  // lib/auth-server.ts.
  const baseURL =
    process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
  const extra = (process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return Array.from(new Set([baseURL, ...extra]));
}

/** `true` when `value` is exactly one of the configured trusted origins. */
export function isTrustedOrigin(value: string | null | undefined, origins = trustedOrigins()) {
  if (!value) return false;
  // An explicit "null" origin (sandboxed iframe, `file://`, opaque redirect) is
  // never trusted, even if a misconfiguration somehow listed it.
  if (value === 'null') return false;

  let candidate: string;
  try {
    candidate = new URL(value).origin;
  } catch {
    return false;
  }

  return origins.some((origin) => {
    try {
      return new URL(origin).origin === candidate;
    } catch {
      return false;
    }
  });
}

export type OriginVerdict =
  | { ok: true; origin: string }
  | { ok: false; status: 403; reason: 'missing-origin' | 'untrusted-origin' };

/**
 * Decide whether a state-changing request may proceed.
 *
 * Browser behaviour this relies on:
 *  - `fetch()` and form posts always send `Origin` for a cross-origin request,
 *    and `Origin` cannot be set by page script.
 *  - `Referer` is the fallback for older clients and for same-origin
 *    navigations; it is stripped only when a page sets a strict referrer policy,
 *    in which case `Origin` is present instead.
 */
export function checkRequestOrigin(
  request: Pick<Request, 'headers' | 'method'>,
  options: { origins?: string[] } = {}
): OriginVerdict {
  const method = (request.method ?? 'GET').toUpperCase();

  // Never refuse a safe method. A navigation to the app carries no Origin, and
  // refusing it would break links and bookmarks rather than stop an attack.
  if (SAFE_METHODS.has(method)) {
    return { ok: true, origin: 'safe-method' };
  }

  const origins = options.origins ?? trustedOrigins();
  const originHeader = request.headers.get('origin');

  if (originHeader) {
    return isTrustedOrigin(originHeader, origins)
      ? { ok: true, origin: originHeader }
      : { ok: false, status: 403, reason: 'untrusted-origin' };
  }

  // No Origin: fall back to Referer. Modern browsers send Origin for every
  // unsafe cross-origin request, so this path is for clients that predate it
  // or for same-origin form submissions with a strict referrer policy.
  const referer = request.headers.get('referer');
  if (referer) {
    return isTrustedOrigin(referer, origins)
      ? { ok: true, origin: referer }
      : { ok: false, status: 403, reason: 'untrusted-origin' };
  }

  // Neither header. A browser cannot reach this state for a cross-site request:
  // `fetch` and form submissions always attach `Origin` for an unsafe
  // cross-origin request. A non-browser client must therefore identify itself
  // with an allowed Origin — the integration suite does exactly that — and a
  // request that names no origin is refused rather than assumed same-origin.
  return { ok: false, status: 403, reason: 'missing-origin' };
}
