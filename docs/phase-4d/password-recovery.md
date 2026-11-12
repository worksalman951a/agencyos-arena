# Phase 4D / Batch 4B — Secure Password Recovery

**Status:** implemented, awaiting review
**Scope:** forgot-password request and reset-password redemption for existing
internal and Client Portal identities. No new authentication system, no new
token table, no migration.

---

## 1. What existed before

| Area                      | State before this batch                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Better Auth configuration | `emailAndPassword` enabled, `autoSignIn: false`, no `sendResetPassword` hook (so `/request-password-reset` answered disabled) |
| Internal sign-in          | `/login` → `/api/auth/sign-in/email`; suspended/removed users blocked by the session-creation hook and `requireOrganization`  |
| Client Portal sign-in     | `/portal/login` → the same Better Auth credential; requires an active `ClientAccess` row                                      |
| Session revocation        | `internalAdapter.deleteUserSessions` (Better Auth) used by the portal revocation flows                                        |
| Transactional e-mail      | Batch 4A SMTP delivery (`lib/email/*`), off by default, hash-only invitation tokens                                           |
| Shared limiter            | `RateLimitBucket` in PostgreSQL (Batch 2), wired to Better Auth and app routes                                                |
| Password reset            | None. UI, routes, e-mail, throttling and tests did not exist.                                                                 |

---

## 2. Better Auth capability and the one gap

Better Auth 1.7 ships a complete recovery flow:

- `POST /request-password-reset` creates a `Verification` row and calls
  `emailAndPassword.sendResetPassword({ user, url, token })`;
- `POST /reset-password` finds `reset-password:<token>`, consumes it, hashes the
  new password, creates the credential account if needed, and (when
  `revokeSessionsOnPasswordReset` is on) deletes every session;
- the vendor explicitly does dummy work for an unknown address, so its response
  body does not reveal whether an account exists.

**The gap:** it stores the raw token in `Verification.identifier`
(`reset-password:<token>`). This batch's mandatory rule is that no reset token
may be stored in plaintext. With no `sendResetPassword` hook configured, the
vendor endpoint answers `RESET_PASSWORD_DISABLED` rather than inventing a
plaintext credential.

**The smallest compatible fix** is therefore not a second auth system:

- keep Better Auth's `Verification` entity (no new table, no migration);
- mint the token here and store **`password-reset:<sha256(token)>`**;
- declare `Verification.userId` as a Better Auth `verification.additionalFields`
  entry (`lib/auth/verification-schema.ts`). This project's Prisma model makes
  the column mandatory, and the adapter's input transform drops undeclared
  fields; without the declaration every token write fails with
  `Argument \`user\` is missing`(covered by`lib/**tests**/auth/verification-schema.test.ts`);
- use Better Auth's own `internalAdapter.createVerificationValue`,
  `consumeVerificationValue` (atomic single-use consume), `password.hash`,
  `findCredentialAccount`, `updatePassword`, `createAccount` and
  `deleteUserSessions`;
- point the e-mailed link at this application's page, not the vendor callback.

Because the stored identifier uses a different namespace, the vendor
`/reset-password` endpoint cannot redeem one of these rows even if a database
leak exposed the hash. The identifier is never a credential by itself.

`emailAndPassword.minPasswordLength` / `maxPasswordLength` are set to the same
constants the reset flow enforces (8 / 128), and
`resetPasswordTokenExpiresIn` / `revokeSessionsOnPasswordReset` are set to the
values the custom flow already guarantees, so re-enabling the vendor path later
cannot quietly weaken either.

---

## 3. Flow

```
POST /api/v1/auth/password-reset/request        (public, Origin-checked)
  1. address budget        password-reset-request (10/hour)
  2. per-address budget    password-reset-request-account (5/hour, digest key)
  3. find account + status active (internal) / ClientAccess active (client)
  4. invalidate older unused links for the account
  5. store  password-reset:<sha256(token)>  in Verification (30 min)
  6. answer 200 with the uniform message
  7. after() : send text+HTML message through the Batch 4A mailer
              (recipient + deployment budgets); if the result is not `sent`,
              delete the row

POST /api/v1/auth/password-reset/confirm        (public, Origin-checked)
  1. address budget        password-reset-confirm (20/hour)
  2. password policy       (before the token is spent)
  3. token shape           (43 URL-safe chars)
  4. atomic consume        internalAdapter.consumeVerificationValue
  5. account status again  (suspended/removed/revoked -> generic invalid)
  6. revoke all sessions   internalAdapter.deleteUserSessions
  7. hash + write          password.hash -> updatePassword / createAccount
  8. invalidate the account's other outstanding reset rows
  9. answer 200 { status: true }
```

The link is `/reset-password/<token>`. The page is `no-referrer`; the token is
POSTed in a JSON body, never a query string. There is no `callbackUrl` /
`redirectTo` input anywhere, so recovery cannot become an open redirect.

---

## 4. Security guarantees

| Requirement                          | How it is met                                                                                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No plaintext reset token at rest     | Only `password-reset:<sha256(token)>` is stored. The raw token exists in the minting request and the message.                                                                                                                |
| No token in logs or responses        | Request/confirm responses carry no token; log lines from the mailer carry reasons/codes only. Tests search the response bodies and console output for the token.                                                             |
| No plaintext passwords               | `context.password.hash` (Better Auth Scrypt); only the hash reaches `Account.password`.                                                                                                                                      |
| Expiring, single-use tokens          | 30 minutes; `consumeVerificationValue` deletes the row atomically and returns it to exactly one caller. Expired rows are deleted and treated as invalid.                                                                     |
| Uniform responses                    | Known, unknown, suspended, removed and revoked addresses receive the same 200 body. The mail is sent from `after()`, so response time does not depend on account existence or SMTP latency.                                  |
| Password policy                      | 8–128 characters, non-blank, checked before the token is spent; the same bounds are configured in Better Auth.                                                                                                               |
| Throttling                           | Address, recipient and redemption budgets in the shared PostgreSQL limiter; e-mail has recipient and deployment budgets. No budget is keyed on a plaintext address or token.                                                 |
| Session invalidation after reset     | `deleteUserSessions` before the password write; a stale cookie then resolves to no session.                                                                                                                                  |
| No reactivation of suspended/removed | The same `isAccountActive` predicate used by the session-creation hook is checked when issuing **and** when redeeming. The reset changes only the credential; it never touches `status`, `organizationId` or `ClientAccess`. |
| Internal and Client Portal policies  | Internal: `User.status === "active"`. Client: active `ClientAccess` and `User.status === "active"`. Both use the same Better Auth credential and sign-in endpoints.                                                          |
| CSRF / origin / cookies              | Both mutations are under `/api/v1/`, so `middleware.ts` applies the project's Origin/Referer rule before any handler. Better Auth's secure cookie attributes and origin validation are unchanged.                            |
| Open redirect                        | No redirect target is accepted; success offers only the fixed `/login` link.                                                                                                                                                 |
| Insecure e-mail transport            | Unchanged from Batch 4A: SMTP with mandatory TLS; no plaintext or "skip verification" switch.                                                                                                                                |
| SMTP accepted ≠ mailbox owned        | The flow never sets `emailVerified` and never creates a session on redemption. Tests assert `emailVerified` stays unchanged.                                                                                                 |
| Fails safely without e-mail          | Delivery disabled, misconfigured, rate-limited or unreachable → the prepared row is deleted; the HTTP answer stays uniform; no link exists that nobody received.                                                             |

### Deliberate behaviour worth knowing

- **The newest link wins.** Asking again invalidates the previous unused link.
  A user who requests twice and opens the first message is told to request a new
  link.
- **A refused status is final for that token.** If an account is suspended after
  a link was issued, redemption consumes the token, then refuses. Reactivating
  the account does not revive the link; the user requests a new one.
- **Per-address throttling is shared.** An attacker can spend a mailbox's
  5-per-hour request budget, but the HTTP answer is unchanged and the real user
  can request again after the window. This mirrors the existing invitation
  e-mail budget trade-off.
- **The request blocks no longer than the token insert.** The SMTP conversation
  happens after the response. A relay outage still invalidates the link, so a
  user retries rather than holding a live link that was never delivered.

---

## 5. Configuration and deployment

No new environment variable and **no migration** (schema baseline remains 19
migrations). Recovery uses:

- the existing `DATABASE_URL` and `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`
  (the public origin every link is built on);
- the Batch 4A `EMAIL_TRANSPORT` / `SMTP_*` / `EMAIL_FROM_*` settings. With
  `EMAIL_TRANSPORT` unset, recovery is safe but returns no usable link because
  no message can be sent;
- the existing `RateLimitBucket` table (migration `0019`).

Operational checklist:

1. Apply the existing migrations; no new one.
2. Set `BETTER_AUTH_URL` to the public `https://` origin.
3. Enable SMTP as described in `docs/phase-4d/email-delivery.md`, including
   SPF/DKIM/DMARC for the sender domain.
4. Keep reverse-proxy timeouts above the Batch 4A SMTP worst case even though
   the response no longer waits for it: the `after()` task still needs the
   request's lifetime.
5. Verify once: request a reset, confirm the message arrives, open the link,
   set a password, and check that an older browser session is signed out.

---

## 6. Tests

| Layer       | File                                                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `lib/__tests__/auth/password-reset-policy.test.ts`                  | 256-bit URL-safe token shape, uniqueness, namespaced SHA-256 identifier, 30-minute TTL, password bounds, malformed-token rejection                                                                                                                                                                                                                                                                                                                          |
| Unit        | `lib/__tests__/email/templates.test.ts`                             | reset message text/HTML, exactly one link, expiry in UTC, no account-type disclosure, non-http(s) link refused, escaping                                                                                                                                                                                                                                                                                                                                    |
| Unit        | `lib/__tests__/email/password-reset-emails.test.ts`                 | disabled/misconfigured/unreachable delivery sends nothing and charges no budget; recipient+deployment budgets, their order and digest keys; no token/recipient in logs                                                                                                                                                                                                                                                                                      |
| Integration | `lib/__tests__/integration/auth.password-reset.integration.test.ts` | real PostgreSQL + HTTP: uniform request answers, no raw token at rest, newest-link-wins, single-use redemption, session revocation, old/new password, expired/invalid/reused tokens, policy before spend, 429 thresholds, suspended/removed accounts, suspended/revoked clients, active client recovery, CSRF/Origin, e-mail disabled/unreachable cleanup, `emailVerified` unchanged, vendor endpoint cannot consume hashed rows, other accounts unaffected |
| E2E         | `tests/e2e/auth.smoke.test.ts`                                      | `/forgot-password` renders and shows the uniform confirmation for an unknown address; `/reset-password/<malformed>` refuses without a form                                                                                                                                                                                                                                                                                                                  |

Existing sign-in, session, invitation and portal suites run unchanged in the
same CI jobs, which is the regression check for the shared session hook,
password policy and limiter table.

---

## 7. Remaining risks and what is not done

1. **E-mail verification is still out of scope.** `emailVerified` remains
   unchanged by recovery; the account identity is still the address on file.
2. **SMTP acceptance is not delivery.** No bounce handling and no durable retry;
   a failed message invalidates the prepared link (safe, but the user must ask
   again).
3. **Mail can be suppressed by budgets.** A mailbox or deployment ceiling stops
   the message; the request still answers uniformly.
4. **The post-response send is in-process.** On a platform that terminates the
   instance immediately after the response, the `after()` task may not finish;
   the link is then unused, not leaked. This deployment is a Node server
   (ADR-0003).
5. **A compromised inbox can reset the password** - that is the point of the
   flow. Session revocation and the 30-minute single-use link bound the window.
6. **No per-account notification on reset** (for example "your password was
   changed"). The audit trail does not record recovery events, by design:
   recording an e-mail address or token would duplicate the exposure.
7. **Invitation-concurrency remediation** and broader e-mail verification remain
   separately tracked and are not touched here.
8. **No user-configurable password policy.** The bounds are constants shared by
   sign-up and reset.
