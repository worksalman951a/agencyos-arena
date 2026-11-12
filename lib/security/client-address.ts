/**
 * Client address resolution for rate limiting.
 *
 * Shared by `middleware.ts` (which normalizes once per request) and the bucket
 * helpers (which read the normalized value). Kept in its own module so the
 * middleware does not pull in `lib/db.ts` through `rate-limit.ts` — middleware
 * must stay free of Prisma.
 *
 * The rules:
 *  - `X-Forwarded-For` is a chain each hop appends to. The **rightmost** entry
 *    is the one written by the hop closest to the server, so a client cannot
 *    forge it when a trusted proxy appends it. The leftmost entry is always
 *    whatever the client claimed.
 *  - A client can send the header itself. That is why `TRUST_PROXY_HEADERS`
 *    gates its use: it must only be enabled behind a proxy that *overwrites*
 *    (not appends to) `X-Forwarded-For`, e.g. Vercel, Cloudflare, or an nginx
 *    `proxy_set_header X-Forwarded-For $remote_addr`.
 *  - When nothing usable is available the function returns `null`, and callers
 *    decide. Never a placeholder shared by all callers: a single global bucket
 *    would let one client lock out everybody.
 */

/** Header middleware sets after normalization; handlers only read this one. */
export const CLIENT_ADDRESS_HEADER = 'x-agencyos-client-address';

/** `true` when this deployment declares a trusted proxy in front of the app. */
export function proxyHeadersTrusted(): boolean {
  return /^(1|true|yes)$/i.test(process.env.TRUST_PROXY_HEADERS ?? '');
}

export function normalizeForwardedAddress(headers: Pick<Headers, 'get'>): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) return null;
  const hops = forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  const last = hops[hops.length - 1];
  return last || null;
}

/**
 * The address this request came from, or `null` when it cannot be established.
 *
 * `directAddress` is the socket peer, available to Node route handlers (not to
 * middleware, which only sees headers). Next.js itself populates a single-value
 * `x-forwarded-for` with the socket address when there is no proxy, which is
 * what makes the header usable on a direct connection too.
 */
export function resolveClientAddress(
  headers: Pick<Headers, 'get'>,
  directAddress?: string | null
): string | null {
  if (proxyHeadersTrusted()) {
    return normalizeForwardedAddress(headers) ?? directAddress ?? null;
  }
  // No trusted proxy: only accept a single, unambiguous value. A chain means a
  // client wrote it (or a proxy appended without being declared), and the
  // leftmost entry in it is client-controlled.
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length === 1) return hops[0]!;
  }
  return directAddress ?? null;
}
