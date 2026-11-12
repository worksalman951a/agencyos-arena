# Phase 4D / Batch 4A — Secure E-mail Delivery

**Status:** implemented, awaiting review
**Scope:** one delivery path for transactional e-mail (SMTP), used by one
message: the client-portal invitation. Off by default.

---

## 1. What existed before

| Area                      | State before this batch                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Outbound e-mail           | None. No mail library, no template, no transport. `.env.example` had commented `SMTP_*` placeholders.                                                                                                                    |
| Client-portal invitations | Created by `createClientInvitation`; the acceptance link was returned once to the administrator, who had to pass it on by hand.                                                                                          |
| Invitation token          | 32 random bytes, stored only as a SHA-256 hash, valid 7 days, single use, redeemable only by an account with the invited address. **Unchanged.**                                                                         |
| Authorization             | Session → `client.invitation.create` → contact looked up inside the caller's organization → address must match the contact's, when the contact has one. **Unchanged.**                                                   |
| Limiter store             | `RateLimitBucket` in PostgreSQL (Batch 2). **Reused.**                                                                                                                                                                   |
| Requirement (RTM E4)      | "Provider-independent email adapter; SMTP configured; interface-only — no provider behavior or fake delivery success in MVP." This batch goes past interface-only: it implements the SMTP provider, off by default (§3). |

---

## 2. What this batch adds

When e-mail delivery is enabled, creating a client-portal invitation also
e-mails the acceptance link to the invited contact. The administrator still
receives the link once, and is told whether the e-mail went out.

```
POST /api/v1/admin/client-invitations
  └─ createClientInvitation                     lib/services/portal/client-invitation-service.ts
       1. validate payload                      (unchanged)
       2. session + client.invitation.create    (unchanged)
       3. contact inside the caller's org       (unchanged; now also reads the org name)
       4. address matches, no access, no live   (unchanged)
          invitation
       5. store invitation (token hash only)    (unchanged)
       6. audit client.invitation.create        (unchanged)
       7. sendClientInvitationEmail             NEW - last step, never throws
       8. audit client.invitation.email_sent    NEW - or email_failed; nothing when disabled
       9. respond 201 + emailDelivery           NEW field, additive
```

| Module                           | Responsibility                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `lib/email/types.ts`             | The provider-independent interface (`EmailTransport`) and the result types. No I/O.                |
| `lib/email/config.ts`            | Environment → validated settings. Disabled unless switched on; fails closed.                       |
| `lib/email/address.ts`           | Strict validation of addresses and header text.                                                    |
| `lib/email/smtp-transport.ts`    | The one provider: SMTP through Nodemailer. Makes one attempt; classifies the failure.              |
| `lib/email/mailer.ts`            | `sendEmail`: validation, link building, sending budget, bounded retry, the reported outcome.       |
| `lib/email/templates.ts`         | One accessible layout (plain text + HTML) and the client-invitation message.                       |
| `lib/email/sending-limit.ts`     | How much invitation e-mail may leave the deployment (§7).                                          |
| `lib/email/invitation-emails.ts` | Joins the three for the invitation. Not a `'use server'` module: it cannot be called as an action. |
| `lib/email/delivery-notice.ts`   | What the administrator is told. Pure; used by the invite form.                                     |

Adding a second provider means implementing `EmailTransport.deliver`; adding a
second message means one more function in `templates.ts`. Neither exists yet.

---

## 3. Decisions

**One dependency: `nodemailer` 10.x.** SMTP, STARTTLS and MIME encoding are not
worth re-implementing. Nodemailer has no dependencies of its own, ships its own
types and supports Node 20+. No second mail library, no provider SDK.

**Sent inside the request; no queue, no outbox.** The plaintext token exists
only in the memory of the request that created the invitation; the database
holds its hash. A queued message would have to store the link — a usable
credential — or mint a new token later. So the message is sent before the
response, retried at most a couple of times immediately, and the outcome is
reported. A durable retry would need a decision on storing an encrypted link
(or re-issuing tokens) and a worker (ADR-0002); it is not attempted here.

**No schema change.** The outcome is returned in the response and recorded in
the existing audit trail. No migration, no new table.

**The response only grows.** `201` with `id`, `token`, `acceptPath`,
`expiresAt`, … exactly as before, plus `emailDelivery`. A failed e-mail does not
turn the request into an error, because the invitation exists and its one-time
link must still reach the administrator.

**No way to weaken TLS.** There is no plaintext mode and no "skip certificate
check" setting, including for development. A local mail catcher must offer TLS
(a private CA can be trusted with `SMTP_TLS_CA_FILE`). Development and CI run
with delivery off instead.

**E-mail is limited where it is sent, not at the route.** A request limiter
keyed on the session can be reset by signing in again. The sending budget is
keyed on the recipient, the organization and the deployment, and is charged
after authorization (§7).

**Not wired in this batch:** team (organization) invitations, password reset,
e-mail verification, notifications. Team invitations keep handing the link to
the administrator.

**The traceability matrix is not edited.** RTM E4 and the implementation audit
of 2026-11-11 describe e-mail as interface-only for the MVP. This batch was
asked to deliver a working SMTP transport, so it goes further than that row;
"never fakes delivery success" is kept. Whether the row should now read
differently is left to its owner.

---

## 4. Configuration

Delivery is **off** unless `EMAIL_TRANSPORT=smtp`. With it off, no connection is
opened, no message is rendered and no credential is needed.

| Variable                                  | Required | Meaning                                                                                                                                   |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_TRANSPORT`                         | —        | empty or `disabled` (default): nothing is sent. `smtp`: send. Anything else is a configuration error.                                     |
| `SMTP_HOST`                               | yes      | Host name or IP address of the relay.                                                                                                     |
| `SMTP_PORT`                               | no       | Default `587`; `465` when `SMTP_SECURE=true`.                                                                                             |
| `SMTP_SECURE`                             | no       | `true`: TLS from the first byte. `false`: STARTTLS, mandatory. Unset: implicit TLS on port 465, STARTTLS otherwise.                       |
| `SMTP_USER` / `SMTP_PASS`                 | together | Credentials. Both or neither. If set and the relay offers no authentication, sending fails.                                               |
| `SMTP_TLS_CA_FILE`                        | no       | Absolute path to a PEM CA. Replaces the system trust store for this connection. Cannot disable verification.                              |
| `SMTP_TIMEOUT_MS`                         | no       | Limit for one attempt, 1000–30000, default 10000. Connection set-up gets at most half of it, capped at 5 s.                               |
| `SMTP_MAX_ATTEMPTS`                       | no       | Attempts per message, 1–3, default 2.                                                                                                     |
| `EMAIL_FROM_ADDRESS`                      | yes      | Sender address. Must be one the relay may send as.                                                                                        |
| `EMAIL_FROM_NAME`                         | no       | Sender display name, default `AgencyOS`.                                                                                                  |
| `EMAIL_REPLY_TO`                          | no       | Reply-To address.                                                                                                                         |
| `BETTER_AUTH_URL` (`NEXT_PUBLIC_APP_URL`) | yes      | Origin every link is built on. Must be `https://`; `http://` is accepted for `localhost` only. There is no fallback when SMTP is enabled. |

When `EMAIL_TRANSPORT=smtp` and anything above is missing or malformed, nothing
is sent: each invitation reports `emailDelivery: { status: "failed", reason:
"configuration" }` and the server log lists the variables at fault (names only,
never values).

---

## 5. Security properties

| Property                                                | How                                                                                                                                                                                                            | Asserted in                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Off by default                                          | `loadEmailConfig` returns `disabled` unless `EMAIL_TRANSPORT=smtp`; leftover `SMTP_*` values do nothing                                                                                                        | `config.test.ts`, `mailer.test.ts`, integration                  |
| Fails closed on bad configuration                       | Any missing/malformed setting → `invalid` → nothing sent                                                                                                                                                       | `config.test.ts`, `mailer.test.ts`                               |
| Credentials and message never travel in plaintext       | Implicit TLS, or `requireTLS`: a relay without STARTTLS is a failure, not a fallback                                                                                                                           | `smtp-transport.test.ts`                                         |
| Server certificate and host name always verified        | `rejectUnauthorized: true` set explicitly, so `NODE_TLS_REJECT_UNAUTHORIZED=0` has no effect; TLS 1.2 minimum requested                                                                                        | `smtp-transport.test.ts` (version floor not tested)              |
| No unauthenticated send when credentials are configured | `forceAuth`                                                                                                                                                                                                    | `smtp-transport.test.ts`                                         |
| Exactly one recipient: the invited address              | Recipient = the address stored on the invitation row, the one every check ran on; `isDeliverableAddress` refuses lists, display names, line breaks and brackets — in the mailer **and** again in the transport | `address.test.ts`, `smtp-transport.test.ts`, `mailer.test.ts`    |
| No header injection                                     | Subject, sender name and Message-ID must be single-line; untrusted names are flattened by the template                                                                                                         | `address.test.ts`, `templates.test.ts`, `smtp-transport.test.ts` |
| No HTML injection                                       | Every string is escaped where it is written; the layout takes plain text only                                                                                                                                  | `templates.test.ts` (parsed with a DOM)                          |
| Links point at the application only                     | Origin from configuration, never from a request header; path must match `/segment/segment`; `https` enforced off localhost                                                                                     | `config.test.ts`, `mailer.test.ts`                               |
| Sent only after authorization and tenant checks         | The send is the last step of the service; the recipient, organization and link come from the service's own organization-scoped records                                                                         | `client-invitation-service.test.ts`                              |
| No fake success                                         | `sent` only after the relay accepted the message; an unknown outcome is `failed`; `disabled` is reported as `disabled`; the UI says "e-mailed" only for `sent`                                                 | `mailer.test.ts`, `delivery-result.test.ts`, integration         |
| Token never logged or stored in plaintext               | The link exists only inside the message; logs and audit entries carry reasons, codes and a Message-ID                                                                                                          | `mailer.test.ts`, `client-invitation-service.test.ts`            |
| Server replies and addresses never logged or returned   | The transport copies codes only (`EAUTH`, `550`, `RCPT TO`), never text                                                                                                                                        | `smtp-transport.test.ts`                                         |
| Credentials not serializable                            | Non-enumerable, frozen; absent from `JSON.stringify` and `console.log` of the settings                                                                                                                         | `config.test.ts`                                                 |
| Bounded outbound volume                                 | Three budgets in the shared limiter store (§7)                                                                                                                                                                 | `invitation-emails.test.ts`                                      |
| No duplicate from a retry                               | Only failures where the message was certainly not accepted are retried (§6); the Message-ID is the same on every attempt                                                                                       | `smtp-transport.test.ts`, `mailer.test.ts`                       |

One library behaviour is worth knowing. Nodemailer's address parser is lenient:
given `a@x.test,b@y.test`, or an address containing a line break or an angle
bracket, it delivers to a second — or a different — recipient, even when the
envelope is passed explicitly. This was observed against the test server and is
why the transport validates addresses itself rather than trusting its caller.

**What the message discloses:** the organization's display name (already shown
on the public invitation page), the contact's first name, the link and its
expiry. No ids, no role or capabilities, no staff identity.

---

## 6. Delivery semantics

`emailDelivery` in the `201` response:

| Value                                 | Meaning                                                                        | Audit entry                                              |
| ------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `{ "status": "sent" }`                | The relay accepted the message for delivery.                                   | `client.invitation.email_sent` (`messageId`, `attempts`) |
| `{ "status": "failed", "reason": … }` | Not recorded as sent. The invitation is valid; the administrator has the link. | `client.invitation.email_failed` (`reason`, `attempts`)  |
| `{ "status": "disabled" }`            | Delivery is off; nothing was attempted.                                        | none                                                     |

Reasons: `configuration`, `invalid_message`, `rate_limited`, `connection`,
`timeout`, `tls`, `authentication`, `rejected`, `unknown`.

**"Sent" means accepted by the relay.** It does not mean the message reached an
inbox. Bounces are not processed.

**Retries.** Up to `SMTP_MAX_ATTEMPTS` attempts, each on a new connection,
0.5 s then 1 s apart.

| Situation                                                                          | Retried | Why                                                                      |
| ---------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| Connection refused, host not found, no connection, greeting or TLS upgrade in time | yes     | No SMTP session started; nothing can have been accepted.                 |
| `4xx` reply at any step                                                            | yes     | The relay said "not now".                                                |
| `5xx` reply                                                                        | no      | Final.                                                                   |
| Authentication refused (any code)                                                  | no      | The credentials will not change; repeated failures can lock the account. |
| TLS unavailable or certificate not trusted                                         | no¹     | A configuration problem.                                                 |
| Connection dropped or silent mid-session; attempt timed out                        | no      | The relay may already hold the message; a retry could duplicate it.      |

¹ A `4xx` reply to the STARTTLS command itself is retried, as a `4xx`.

In the last row the outcome is genuinely unknown and is reported as `failed`.
The error is deliberately one-sided: a recipient may receive an e-mail that was
reported as failed, never the reverse.

**Time.** The request waits for delivery. Worst case is
`attempts × SMTP_TIMEOUT_MS + back-off`: 20.5 s with defaults, 91.5 s at the
maximum settings. An unreachable relay is given up on after about 10.5 s with
defaults. Keep any reverse-proxy read timeout above the configured worst case.

**A failed e-mail is not retried later.** The administrator passes the link on,
or revokes the invitation and creates a new one.

---

## 7. Limits

Charged only when a message is really about to be sent (delivery enabled,
configuration valid, message valid), in this order; the first exhausted budget
stops the check. Counters live in `RateLimitBucket`, so all application
instances share them. Keys are digests; no address is stored.

| Policy                          | Window | Max | Keyed on     | Rationale                                                                               |
| ------------------------------- | ------ | --- | ------------ | --------------------------------------------------------------------------------------- |
| `invitation-email-recipient`    | 3600 s | 5   | recipient    | One address cannot be flooded by revoke-and-reinvite, from one organization or several. |
| `invitation-email-organization` | 3600 s | 30  | organization | A tenant cannot use the deployment as a bulk mailer; signing in again buys nothing.     |
| `invitation-email-deployment`   | 3600 s | 200 | deployment   | Ceiling for a caller who registers many organizations.                                  |

A budget is charged when it is checked. An attempt therefore counts whether or
not the relay then accepts the message, and a narrower budget stays charged when
a wider one then refuses the attempt.

An exhausted budget never refuses the request. The invitation is created, the
link is returned, and `emailDelivery` is `{ "status": "failed", "reason":
"rate_limited" }`; the server log names the policy. If the limiter store cannot
be reached, nothing is sent (`reason: "unknown"`).

The limits are constants in `lib/security/rate-limit.ts`.

---

## 8. Deployment requirements

1. **To keep e-mail off, do nothing.** Nothing new is required.
2. **To enable it,** set `EMAIL_TRANSPORT=smtp` and the variables in §4, with the
   password from the secret manager. The relay must offer TLS with a certificate
   valid for `SMTP_HOST`.
3. **`BETTER_AUTH_URL` must be the public `https://` origin.** It becomes the
   host of every e-mailed link.
4. **Sender reputation is the relay's and the domain's job:** SPF, DKIM and DMARC
   for the domain of `EMAIL_FROM_ADDRESS` are configured outside the application.
5. **Migration `0019_rate_limit_bucket` must be applied** (already required since
   Batch 2); the sending budgets use it.
6. **Run the test suites with `EMAIL_TRANSPORT` unset.** The integration and E2E
   suites create invitations for `.invalid` addresses; against a server with
   SMTP enabled those would be handed to the relay.
7. **After enabling, verify once:** invite a test contact and check that the
   response says `"emailDelivery": {"status": "sent"}` and the message arrives.
   On `failed`, the reason and the server log line (`[email] …`) say why.

---

## 9. Remaining risks and what is not done

1. **Accepted is not delivered.** No bounce or complaint handling.
2. **No durable retry.** If the relay is down when an invitation is created, the
   e-mail is not sent later.
3. **An unknown outcome is reported as failed** (§6); the recipient may still get
   the message.
4. **The request blocks while sending** (§6).
5. **Tenant-chosen text appears in the message.** The organization name and the
   contact's first name are escaped, flattened to one line and capped (120 / 80
   characters), but they are still words a tenant chose, shown under the
   deployment's sender address. The budgets bound how often.
6. **The link is a bearer credential in transit** through the relay and the
   recipient's mailbox. It is single-use, expires in 7 days and can be redeemed
   only by an account with the invited address — and that account's address is
   not verified by e-mail.
7. **The recipient budget can be spent by someone else.** Five invitations to an
   address in an hour, from any organization and whether or not their e-mails
   went out, stop further e-mail to it for the rest of the window. Invitations
   still work; the link is handed over manually.
8. **Limits are not configurable** without a code change.
9. **Delivery status is not shown in the invitation list;** it is in the response
   at creation time and in the audit trail.
10. **No real mail provider and no real mail client have been tested.** Everything
    was exercised against an in-process SMTP server; HTML rendering was checked
    structurally, not in Gmail, Outlook or Apple Mail.
11. **Creating a client invitation has no request limiter** (team invitations
    have `invitation-create`). Pre-existing; the e-mail side is bounded by §7.
12. **One e-mail per stored invitation, not per address.** The "one pending
    invitation per address" rule is a read followed by an insert with no unique
    index behind it (pre-existing, not changed here). Requests for the same
    address whose reads and inserts interleave all pass it; each stored
    invitation is then e-mailed once, so the contact gets several messages, each
    with its own valid link. Simultaneous requests did not interleave in local
    runs unless the insert was held back; the form disables its button while a
    request is in flight, and the recipient budget caps the total at five an
    hour.
13. **Not wired:** team invitations, e-mail verification. Password reset now
    reuses this delivery path; see `docs/phase-4d/password-recovery.md`.
14. **Workflow rules still reject `send_email`.** Nothing in the automation
    module changed; its form still explains that with "no SMTP … infrastructure
    exists in this phase", which now describes the automation module only.

---

## 10. Tests

| Layer       | File                                                     | What it proves                                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `lib/__tests__/email/address.test.ts`                    | single bare mailbox only; header-injection and multi-recipient forms refused; untrusted text flattened                                                                                                                                                                                       |
| Unit        | `lib/__tests__/email/config.test.ts`                     | off by default; every malformed setting refused; no TLS-weakening setting; link origin rules; secrets not serializable; problems never echo values                                                                                                                                           |
| Unit        | `lib/__tests__/email/templates.test.ts`                  | escaping (DOM-parsed), one link only, single-line subject, disclosure, accessibility structure and contrast                                                                                                                                                                                  |
| Unit        | `lib/__tests__/email/smtp-transport.test.ts`             | real TCP + TLS against a scriptable SMTP server: STARTTLS / implicit TLS, credentials only after TLS, certificate and host-name refusal, no plaintext fallback, authentication, rejections, timeouts, drops, abort, wire format, SMTP smuggling, recipient injection, codes-only diagnostics |
| Unit        | `lib/__tests__/email/mailer.test.ts`                     | disabled / misconfigured send nothing; end to end from environment to bytes; link confinement; budget order; retry and no-retry rules; never throws; nothing sensitive logged                                                                                                                |
| Unit        | `lib/__tests__/email/invitation-emails.test.ts`          | the three budgets, their order and keys; the invitation message; hostile names cannot redirect it                                                                                                                                                                                            |
| Unit        | `lib/__tests__/email/delivery-result.test.ts`            | "sent" is said only for `sent`, in the API summary, the audit record and the administrator notice                                                                                                                                                                                            |
| Unit        | `lib/__tests__/portal/client-invitation-service.test.ts` | the e-mail is the last step; nothing is sent on any refusal (validation, 401, 403, cross-tenant 404, mismatch, 409s, storage failure); outcome reported and audited; response contract; token never logged                                                                                   |
| Integration | `lib/__tests__/integration/portal.integration.test.ts`   | real HTTP + PostgreSQL with delivery off: `emailDelivery` is `disabled`, the link is still returned, no delivery is audited                                                                                                                                                                  |

`lib/__tests__/email/mock-smtp-server.ts` is the test server: loopback only, a
throwaway certificate generated per run with `openssl`, nothing leaves the
process.
