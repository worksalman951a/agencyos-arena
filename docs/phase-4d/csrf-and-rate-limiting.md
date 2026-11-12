# Phase 4D / Batch 2 — CSRF Protection & Rate Limiting

**Status:** implemented, awaiting review
**Scope:** cross-origin protection for AgencyOS-owned routes, and a single
distributed rate limiter for the endpoints where abuse is worth attempting.

---

## 1. What was already protected (do not re-add)

| Surface                                                              | Existing protection                                                                                                                                                   | Where                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/api/auth/*`                                                        | Origin validation on every unsafe request that carries a cookie, `Referer` fallback, Fetch-Metadata CSRF for origin-less form posts, callback/redirect URL validation | `better-auth` `originCheckMiddleware` + `formCsrfMiddleware`                                   |
| `/api/auth/sign-in`, `/sign-up`, `/change-password`, `/change-email` | Built-in limiter, 3 requests / 10 s                                                                                                                                   | `better-auth` `getDefaultSpecialRules()`                                                       |
| Session cookies                                                      | `httpOnly`, `SameSite=Lax`, `Secure` when the base URL is HTTPS or `NODE_ENV=production`, `Path=/`                                                                    | `lib/auth-server.ts` `advanced.defaultCookieAttributes`                                        |
| `trustedOrigins`                                                     | `BETTER_AUTH_URL` → `NEXT_PUBLIC_APP_URL` → `localhost:3001`, plus `TRUSTED_ORIGINS`; deduplicated; no wildcard                                                       | `lib/auth-server.ts`                                                                           |
| Server Actions                                                       | Framework compares `Origin` against the request host and rejects mismatches                                                                                           | Next.js 16 built-in (`serverActions.allowedOrigins` empty = same-origin only)                  |
| Multi-tenant authorization                                           | Every service resolves the organization from the session; ids from the client are never trusted                                                                       | `lib/permissions.ts`, `lib/portal/access-control.ts`                                           |
| Public token endpoints                                               | 32-byte random tokens, stored as SHA-256 hashes, single-use / expiry enforced in the service                                                                          | `lib/services/admin/invitation-service.ts`, `lib/services/portal/client-invitation-service.ts` |

Verified by reading the vendor implementation in `node_modules`, not assumed.

---

## 2. Confirmed gaps and their fixes

### Gap 1 — No origin validation on AgencyOS-owned mutations (high)

**Root cause.** Better Auth's origin check is applied by its own handler. Every
`/api/v1/*` route and `/api/auth/bootstrap-organization` are served by our code
and had no `Origin` check at all. `SameSite=Lax` was the only barrier.

**Fix.** `middleware.ts` now refuses any unsafe request (`POST`, `PUT`, `PATCH`,
`DELETE`) to `/api/v1/*` or `/api/auth/bootstrap-organization` unless the
request names a trusted origin, falling back to `Referer`. Failure is a `403`
with `Cache-Control: no-store` and no resource detail. Safe methods are never
refused. Implementation: `lib/security/origin.ts`.

Affected endpoints: all 84 mutating route handlers under `app/api/v1/**` plus
`app/api/auth/bootstrap-organization`.

**Why middleware and not a per-route wrapper:** there are ~90 handlers; a
central rule cannot be forgotten by the next route. Coverage is enforced by
`lib/__tests__/security/csrf-coverage.test.ts`, which fails if a new mutating
route lands outside the protected patterns without a written justification.

### Gap 2 — Public token endpoints had no abuse bound (medium)

**Root cause.** `/api/v1/invitations/[token]`, `/api/v1/portal/invitations/[token]`,
their `/accept` siblings and `/api/v1/documents/links/[token]` are public by
design (the token is the credential). Nothing limited how many guesses a caller
could make, and the invitation preview distinguishes a live token from a dead
one — i.e. it is an oracle.

**Fix.** Per-caller limits on all six endpoints (`RATE_LIMITS` in
`lib/security/rate-limit.ts`). Preview endpoints are keyed on the client address
(there is no session); accept endpoints are keyed on the session, because a
legitimate redemption always has one and an entire office must not share a
budget.

### Gap 3 — The limiter did not exist outside Better Auth (high)

**Root cause.** Better Auth rate-limits only its own endpoints, and by default
stores counters in a per-process `Map`.

**Fix.** One shared limiter, stored in PostgreSQL
(`RateLimitBucket`, migration `0019_rate_limit_bucket`), used by both halves:
Better Auth's `rateLimit.customStorage` points at the same table, and the six
public endpoints above call `consumeRateLimit` directly. One implementation,
one counter store, no duplicated limits.

### Gap 4 — `X-Forwarded-For` was not normalized (medium)

**Root cause.** Any address-keyed limiter needs a trustworthy client address. The
leftmost `X-Forwarded-For` entry is whatever the client claimed, so using it
hands an attacker a fresh bucket per request.

**Fix.** `middleware.ts` resolves the address once, writes it to
`x-agencyos-client-address` (overwriting any client-supplied value), and handlers
read only that. `TRUST_PROXY_HEADERS` gates whether a forwarding chain is
honoured at all. See §5.

---

## 3. Deliberate non-changes

- **`GET /api/v1/documents/links/[token]` meters accesses.** A GET increments
  `DocumentLink.accessCount`. It is reachable cross-site but carries no session
  credential, so it is not a CSRF vector; the worst case is a client consuming
  its own link's `maxAccess` budget. The endpoint now also consumes one unit of
  `document-link-access` per call, which bounds that loop as well. Changing the
  verb would break the existing public contract for no security gain, so the
  risk is recorded in §6 instead.
- **`SameSite` stays `Lax`.** `Strict` would break following a link from an
  e-mail into the app. The origin check is the primary control; `Lax` is defense
  in depth.
- **No `csrf` token cookie.** A double-submit token would add a second
  mechanism with the same guarantee (the browser's same-origin policy), plus
  state to deploy and rotate. Origin validation is the OWASP-recommended primary
  defence and is what Better Auth already uses.
- **Better Auth's `enabled` flag is untouched.** It stays at the vendor default
  (`NODE_ENV === "production"`). The integration job runs the built server with
  `NODE_ENV=test` on purpose: dozens of sign-ins per suite from one address would
  otherwise be throttled, which is correct production behaviour but wrong for a
  test fixture. Production and the Playwright job both have it enabled.

---

## 4. Deployment requirements

1. **Apply migration `0019_rate_limit_bucket`.** This is mandatory, not
   optional: Better Auth's limiter now writes to this table, so leaving it out
   makes every limiter-guarded auth request fail closed with a 500. Run
   `prisma migrate deploy` as part of the normal release step.
2. **Keep `BETTER_AUTH_URL` (or `NEXT_PUBLIC_APP_URL`) correct for every public
   origin.** It is the trusted origin for both Better Auth and this
   middleware. Additional origins (preview deployments, custom domains) go in
   `TRUSTED_ORIGINS`, comma separated, full scheme and host.
3. **If, and only if, a reverse proxy is in front of the app,** set
   `TRUST_PROXY_HEADERS=1` _and_ configure the proxy to **overwrite**
   `X-Forwarded-For` with the real peer address (`proxy_set_header
X-Forwarded-For $remote_addr;` for nginx). The proxy must not merely append.
   Left unset (the default), a client-supplied header is ignored.
4. **Cookie `Secure`** follows `BETTER_AUTH_URL`; serve over HTTPS in
   production.
5. **Housekeeping (optional):** `RateLimitBucket` rows are reused in place when
   their window elapses, so the table only grows with distinct keys. An
   occasional `DELETE FROM "RateLimitBucket" WHERE "expiresAt" < now() - interval '1 day'`
   keeps it tidy; nothing depends on it.

---

## 5. Limits

| Policy                      | Window | Max | Keyed on | Rationale                                                               |
| --------------------------- | ------ | --- | -------- | ----------------------------------------------------------------------- |
| `auth-sign-in`              | 60 s   | 10  | address  | ~14k guesses/day against one account; human sign-in is far below        |
| `auth-sign-up`              | 60 s   | 20  | address  | blocks junk-account and mail flooding; a team onboarding day still fits |
| `auth-sensitive`            | 60 s   | 5   | address  | password reset / change / verification resend: spam and enumeration     |
| `invitation-preview`        | 60 s   | 120 | address  | token enumeration; a UI loads at most a few                             |
| `invitation-accept`         | 3600 s | 20  | session  | redemption is once per invitee                                          |
| `portal-invitation-preview` | 60 s   | 120 | address  | as above                                                                |
| `portal-invitation-accept`  | 3600 s | 20  | session  | as above                                                                |
| `document-link-access`      | 60 s   | 120 | address  | bounds enumeration _and_ burning a link's `maxAccess`                   |
| `invitation-create`         | 3600 s | 30  | session  | mints bearer credentials                                                |
| `organization-bootstrap`    | 3600 s | 10  | session  | once per account, ever                                                  |

Batch 4A added three `invitation-email-*` policies to the same table. They are
not request limits - they bound outbound invitation e-mail and never produce a
`429` - and are described in [`email-delivery.md`](./email-delivery.md#7-limits).

`429` responses carry `Retry-After` and `RateLimit-Limit` /
`RateLimit-Remaining` / `RateLimit-Reset` headers and a generic body that names
no resource. Counters reset when the window elapses; the window restarts on the
first request after expiry, so recovery is automatic (asserted in
`lib/__tests__/security/rate-limit.test.ts` and
`integration/security.integration.test.ts`).

---

## 6. Remaining risks

1. **GET metering on document links** (§3). Bounded, not eliminated.
2. **Limiter availability is coupled to PostgreSQL.** If the database is down,
   limiter-guarded requests fail rather than silently allowing traffic. This is
   the fail-closed choice; it trades availability for not losing the control.
3. **Single trusted-proxy hop assumed.** `TRUST_PROXY_HEADERS=1` with a proxy
   that _appends_ instead of overwriting would let a client inject the rightmost
   entry. The deployment note above is the mitigation; there is no way to detect
   it from inside the app.
4. **Better Auth's limiter is off when `NODE_ENV !== "production"`.** A staging
   deployment that runs without `NODE_ENV=production` has no auth limiter. The
   app-owned routes are unaffected (they always limit).
5. **No alerting.** A sustained 429 rate is not currently surfaced to operators;
   it is visible in logs only.

---

## 7. Tests

| Layer       | File                                                     | What it proves                                                                                                                                                       |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `lib/__tests__/security/origin.test.ts`                  | origin/Referer decision table, `null` origin, look-alikes, spoofed forwarding headers, safe-method pass-through                                                      |
| Unit        | `lib/__tests__/security/rate-limit.test.ts`              | key construction, address resolution, off-by-one at the cap, 429 shape and headers, handler not invoked when throttled                                               |
| Unit        | `lib/__tests__/security/middleware.test.ts`              | the real middleware function: protected paths, missing/foreign origin, bootstrap coverage, Better Auth left alone, header overwrite                                  |
| Audit       | `lib/__tests__/security/csrf-coverage.test.ts`           | every mutating route is covered or justified                                                                                                                         |
| Integration | `lib/__tests__/integration/security.integration.test.ts` | real HTTP + real PostgreSQL: allowed writes, 403s with no side effect, portal coverage, authorization unchanged, live 429 threshold and recovery, shared-store proof |
