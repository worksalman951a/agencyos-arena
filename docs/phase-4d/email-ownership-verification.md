# Email ownership verification (Phase 4D / Batch 4C-1)

## Design

AgencyOS keeps Better Auth for identity, sessions and its PostgreSQL `Verification` table, and uses the existing SMTP mailer. The custom verification token is 32 random bytes; only a namespaced SHA-256 digest is stored. The row is associated with its user, expires after 30 minutes, and Better Auth's atomic `consumeVerificationValue` performs single-use redemption. The stored claim binds the token to both the user id and the exact email address that received the message.

The email points to `/verify-email#<token>`. The fragment is not sent in the HTTP request or a Referer header. The page strips it from browser history and sends it in a same-origin, Origin-checked POST only after an explicit user action. No callback/redirect destination is accepted.

Requests use one generic response for unknown, verified, inactive and eligible unverified identities. Per-address and per-account request limits run before account lookup; email has separate per-recipient and deployment-wide SMTP ceilings. Undelivered links are deleted. No token, recipient or message body is logged.

## Rollout behavior

`emailAndPassword.requireEmailVerification` remains `false`. Existing internal users, including legacy accounts whose `emailVerified` value is false, retain sign-in and active application access. The verification banner and settings profile report the database value accurately and provide a safe request action. Verification changes only `User.emailVerified`.

A client invitation can no longer link an identity based only on a matching email string. The accepting account must have `emailVerified = true`; an unverified invitee sees a request action. Existing client identities and access are not suspended or otherwise changed by rollout. Suspended internal accounts and suspended/revoked client access cannot request or redeem a token, and verification never changes status or access rows.

The Better Auth vendor verification email flow is intentionally not enabled: it emits raw JWT tokens in URL query strings and uses a distinct lifecycle. The custom `/api/v1/auth/email-verification/*` handlers own request and redemption instead. Password recovery keeps its existing `password-reset:` token namespace and is unchanged.

## Deployment and data

- No database migration is required: the existing `User.emailVerified` flag and `Verification` table are reused.
- No dependency or environment-variable change is required. SMTP configuration and delivery controls are the existing `EMAIL_TRANSPORT=smtp`, `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`, and SMTP settings described in [email delivery](./email-delivery.md).
- With email delivery disabled or misconfigured, the API remains enumeration-neutral and does not leave a redeemable link. Configure SMTP before relying on users to verify new addresses or accept client invitations.
- Existing unverified users are not bulk-marked verified and are not blocked from sign-in. They may voluntarily verify; client invitation acceptance is gated until they do.
