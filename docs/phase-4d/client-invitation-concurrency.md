# Phase 4D / Batch 4C-2 — Client invitation concurrency and database integrity

**Status:** implemented, awaiting review
**Scope:** the client-portal invitation race only. One migration, one service
change, one new test suite, one document. No change to the Client Portal,
acceptance, e-mail verification, password recovery, authentication,
authorization or the team-invitation flow.

---

## 1. Root cause

`createClientInvitation`
(`lib/services/portal/client-invitation-service.ts`) enforced "one live
invitation per recipient" in application code, in two separate statements:

```ts
// 1. decide
const live = await prisma.clientInvitation.findFirst({
  where: { organizationId: actor.organizationId, email, status: 'pending' },
});
if (live && live.expiresAt > new Date()) throw codedError(...409);

// …workspace checks, token generation…

// 2. act
const invitation = await prisma.clientInvitation.create({ data: { …, status: 'pending' } });
```

Between the read and the write there is a full round trip to PostgreSQL (and two
more reads: the contact lookup and the `ClientAccess` lookup). Any two requests
that overlap in that window both observe "no pending invitation" and both
insert. Nothing in the schema prevented it: `ClientInvitation` had only
`@@index([organizationId, email])`, a non-unique index.

The window is short, which is why it had gone unnoticed — but it is unbounded in
principle and, more importantly, it is _multiplicative across application
instances_: the read happens in one process's memory of the database, so two
Node instances have two independent windows.

### Reproduced (before the fix)

Eight simultaneous `POST /api/v1/admin/client-invitations` for one organization
and one recipient, against a real server and a real PostgreSQL 16 database:

```
statuses: 201+token, 201+token, 409, 409, 409, 409, 409, 409
rows for (org,email): 2 [ 'pending', 'pending' ]
pending rows: 2
distinct usable tokens returned: 2
client.invitation.create audit entries: 2
RESULT: RACE PRESENT (2 pending)
```

Reproduced again at concurrency 16. Consequences that made this a security
issue rather than a cosmetic one:

- **two usable invitation tokens** for the same recipient, both valid for 7 days
  (accepting one leaves the other live, because only the consumed row is
  flipped);
- **two e-mails** to the same person when delivery is enabled (the sender is
  invoked per stored invitation);
- **two audit entries**, so the trail cannot answer "how many invitations did
  we send this contact?";
- the second row can also carry _different capabilities_ than the first, because
  the payloads differ, and whichever link the recipient clicks decides which
  grant is applied.

---

## 2. The invariant and where it is enforced

```sql
CREATE UNIQUE INDEX "ClientInvitation_pending_org_email_key"
  ON "ClientInvitation" ("organizationId", lower(email))
  WHERE status = 'pending';
```

Migration: `prisma/migrations/0020_client_invitation_pending_uniqueness`.

| Property                                     | Why it is expressed this way                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `("organizationId", lower(email))`           | The recipient identity is the mailbox, exactly as the service compares it (`emailsMatch` lowercases both sides) and exactly as the pre-existing lookup treated it. `lower()` also closes the case-variant hole that a plain column index would leave for legacy rows that were stored before normalization. |
| `WHERE status = 'pending'`                   | Only a _live_ invitation is constrained. `accepted`, `revoked` and `expired` rows fall out of the index, so re-inviting after acceptance/revocation/expiry keeps working. A plain `@@unique([organizationId, email])` would have broken those flows.                                                        |
| `organizationId` first                       | Two organizations are fully independent: the same person can hold one live invitation in each, which is the intended cross-tenant behaviour.                                                                                                                                                                |
| Unique index, not a trigger or advisory lock | `INSERT` checks it in the same operation that stores the row, inside PostgreSQL, so it is correct for every writer: one process, many processes, a retry, or an operator with SQL. No application code has to cooperate for the guarantee to hold.                                                          |
| Partial, not an exclusion constraint         | The predicate is immutable, so it is indexable. There is no need for `btree_gist`, no new extension, and no second index.                                                                                                                                                                                   |

### Expired-but-still-`pending` rows

An invitation is invalid once `expiresAt` passes, but its `status` is not
rewritten by a scheduler — `getClientInvitationByToken` flips it to `expired`
lazily and only when somebody opens the link. Such a row is still
`status = 'pending'`, so it occupies the single slot.

A partial index cannot ask "is it still valid?", because an index predicate must
be immutable and `now()` is not. So the slot is released by the application, in
the **same transaction** as the replacement insert:

```sql
UPDATE "ClientInvitation"
   SET "status" = 'expired', "updatedAt" = NOW()
 WHERE "organizationId" = $1
   AND lower("email") = $2
   AND "status" = 'pending'
   AND "expiresAt" <= (NOW() AT TIME ZONE 'UTC');
```

This is the same `pending -> expired` transition the preview path already
performs. It changes no id, no token hash, no expiry and no audit entry, and it
deletes nothing: an expired invitation stays in the table, listed as `expired`,
rejected with `410 Gone` if anyone follows the link. The `NOW() AT TIME ZONE
'UTC'` form matches the `TIMESTAMP(3)` (no time zone) column Prisma writes.

### Deterministic outcome for the loser

```
Request A ──┐
            ├─ INSERT …                    → commits → 201 + token + audit + one e-mail
Request B ──┘   speculative insert waits
                A commits → B raises 23505
                → 409 "A pending invitation already exists for this address"
                → no token, no audit entry, no e-mail
```

PostgreSQL makes the second insert wait on the first transaction's index tuple
rather than lose or double-write it. If A rolls back, B proceeds normally. The
losing request is converted to the same `409` the pre-check produces, so callers
see one consistent answer; it never receives a token, because the token is only
returned after the insert commits.

`isPendingInvitationConflict` recognises the violation on both paths Prisma can
surface it (`P2002`, or a raw `23505` through the driver adapter) and only when
the violation names this index (or its columns). An unrelated unique violation
is rethrown rather than disguised as a duplicate invitation — there is a unit
test for exactly that.

The pre-check (`findFirst`) is kept. It is a fast path that answers the common
case without minting a token; it is no longer what makes the guarantee true.

---

## 3. Migration and legacy data

The migration is additive: **it inserts, updates and deletes no rows.** It
creates one partial unique index.

### 3.1 Detecting legacy duplicates (read-only)

Before applying, run:

```sql
SELECT "organizationId", lower(email) AS recipient, count(*) AS pending_rows,
       string_agg(id, ', ' ORDER BY "createdAt") AS ids
  FROM "ClientInvitation"
 WHERE status = 'pending'
 GROUP BY 1, 2
HAVING count(*) > 1;
```

Any row here is a case of this bug (or of an intentional override made with
direct SQL). Expired-but-`pending` rows count too, because the index cannot tell
them apart — see §2.

### 3.2 The migration refuses to guess

`0020` runs the same detection inside a `DO` block first and raises a
`RAISE EXCEPTION` listing every offending group (up to 20). Verified against a
scratch database seeded with `ci_1`, `ci_2` and `ci_3` (`dup@…`, `dup@…`,
`DUP@…`, all `pending`):

```
ERROR:  Cannot create ClientInvitation_pending_org_email_key: duplicate pending invitations exist.
org org_legacy / recipient dup@legacy.invalid (3 pending rows: ci_1, ci_2, ci_3)
No data was changed. Keep one invitation per group and move the rest to 'expired'
or 'revoked' (never delete them), then re-run the migration.
```

Nothing was changed and no index was created (`prisma migrate deploy` stops
before it). Note that the group is reported across case variants, which is the
whole point of `lower(email)`.

### 3.3 Remediation is a human decision

Per group, keep the invitation the recipient should actually use (the one
already e-mailed, or the newest) and retire the others:

```sql
UPDATE "ClientInvitation"
   SET status = 'expired', "updatedAt" = NOW()   -- or 'revoked' + "revokedAt" if withdrawn
 WHERE id IN ('…', '…');
```

Rows, token hashes and audit history are preserved; only the surplus links stop
being redeemable. Deleting rows is never required and nothing in this repository
does it automatically. Re-run the migration once the query above returns no
rows — verified: after retiring `ci_1` and `ci_3`, `0020` applied cleanly, the
five invitation rows were untouched, and running it a second time was a no-op
(`IF NOT EXISTS`).

### 3.4 Deployment considerations

- **Locking.** `CREATE UNIQUE INDEX` (non-concurrent) takes `ACCESS EXCLUSIVE`
  on `ClientInvitation`; writes to that table wait for the build. The table holds
  at most a handful of rows per recipient, so the build is a fraction of a
  second. If a deployment wants a hard ceiling, apply it with a session-level
  `SET lock_timeout = '5s';` ahead of the migration and retry; do not run it
  against production during peak invitation traffic.
- **Order.** Deploy the migration **before** (or with) the application build.
  The old application keeps working against the new index — it simply cannot
  race any more. The new application against an _old_ schema is still safe from
  duplicate rows only as far as the pre-check, so do not split the two: the
  index is what makes the release correct.
- **Prisma.** Partial indexes cannot be expressed in `prisma/schema.prisma`, so
  `prisma migrate deploy` is the supported path (same rule as migration `0015`),
  and any future migration must be generated with `prisma migrate dev
--create-only` and reviewed so it does not contain a `DROP INDEX` for this
  index. `npm run check:schema` inspects write payloads, not indexes, and is
  unaffected.
- **Do not** run this against a real development or production database as part
  of this batch. Nothing in CI touches a shared database: CI creates a fresh
  PostgreSQL service container and applies the committed migrations to it.

### 3.5 Rollback

The index is additive, so rollback loses no data:

```sql
DROP INDEX IF EXISTS "ClientInvitation_pending_org_email_key";
```

Rolling back re-opens the race; no other behaviour changes. The suite exercises
drop + recreate inside a transaction that is always rolled back, so the schema
is left untouched (`is reversible and idempotent…` test).

---

## 4. Before / after

| Situation                                                   | Before                                                                                                                                                                  | After                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Two simultaneous invitations, same org + recipient          | both `201`, two tokens, two pending rows, two e-mails, two audit entries                                                                                                | one `201` with one token; the other `409`, no token, no e-mail, no audit entry                                 |
| Two concurrent invitations through two app instances        | same as above (no shared state to stop it)                                                                                                                              | same as above (the database is the shared state)                                                               |
| Same recipient invited by two different organizations       | independent, both allowed                                                                                                                                               | unchanged                                                                                                      |
| Re-invite after the previous invitation expired             | allowed only if the old row was still `pending` **and** the pre-check happened to see it; the old row kept `status = 'pending'` for ever unless someone opened the link | allowed; the old row is retired to `expired` in the same transaction, keeping its id, hash, expiry and history |
| Re-invite after revocation                                  | allowed                                                                                                                                                                 | unchanged                                                                                                      |
| Re-invite a contact that already has portal access          | `409`                                                                                                                                                                   | unchanged                                                                                                      |
| Accept an invitation twice (double click, replay, two tabs) | one wins, the other `410`                                                                                                                                               | unchanged (already atomic via the conditional claim)                                                           |
| `tokenHash` collision (2⁻²⁵⁶)                               | `500`                                                                                                                                                                   | `500`, deliberately not reported as a duplicate                                                                |
| Direct `INSERT` by an operator or a future service          | two live rows possible                                                                                                                                                  | rejected by the index                                                                                          |

---

## 5. Verification

New suite:
`lib/__tests__/integration/portal.invitation-concurrency.integration.test.ts`
(real PostgreSQL, real HTTP, real transactions — no sequential mocks; skips
without `DATABASE_URL`).

| #   | Required coverage                                       | Test                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Simultaneous creation, same recipient                   | `permits exactly one of eight concurrent invitations for the same recipient`                                                                                                                                                                                                                                                                              |
| 2   | Exactly one active pending invitation, one usable token | same test (row count, `tokenHash` match, single audit entry)                                                                                                                                                                                                                                                                                              |
| 3   | No duplicate successful e-mail dispatch                 | `dispatches one e-mail and hands out one token when six creations race` (transport stubbed, six real concurrent inserts; sender called once)                                                                                                                                                                                                              |
| 4   | Cross-organization independence                         | `keeps the same recipient independent across organizations`                                                                                                                                                                                                                                                                                               |
| 5   | Expired and revoked replacement                         | `replaces an expired invitation and keeps it as history`, `replaces a revoked invitation and keeps the revocation`                                                                                                                                                                                                                                        |
| 6   | Acceptance and replay protection                        | `lets exactly one of two simultaneous acceptances create the portal identity`                                                                                                                                                                                                                                                                             |
| 7   | E-mail ownership compatibility                          | `requires proven email ownership before the invitation can be consumed`                                                                                                                                                                                                                                                                                   |
| 8   | Unauthorized attempts                                   | `rejects an anonymous creation and stores nothing`, `rejects a contact that belongs to another organization (404, no row)`, `rejects an invitation e-mail that is not the contact e-mail`                                                                                                                                                                 |
| 9   | Client Portal isolation and permissions                 | client identity assertions in the acceptance test (`userType = 'client'`, no organization, no `UserRole`, `403` on the admin invitation API)                                                                                                                                                                                                              |
| 10  | Database uniqueness under genuine concurrency           | `lets exactly one of six concurrent inserts commit` (direct inserts, five rejected with `P2002` naming the index), `rejects the losing request at the database even when the pre-check cannot see the winner` (a second connection holds an uncommitted row; the request waits ~0.9 s for the lock and is then rejected), `is reversible and idempotent…` |

Unit coverage in `lib/__tests__/portal/client-invitation-service.test.ts`: the
expired-row retirement runs in the same transaction as the insert and only
touches expired pending rows; `P2002`/`23505` on this index become `409` with no
e-mail and no audit entry; an unrelated unique violation is not disguised; the
non-conflict failure is not swallowed; the pre-check compares case-insensitively.

---

## 6. Remaining risks (out of scope, unchanged by this batch)

1. **Team invitations** (`model Invitation`, `lib/services/admin/invitation-service.ts`)
   use the same read-then-insert pattern. They do not send e-mail and never
   create portal access, but the same duplicate-invitation race exists there.
   Fixing it is a one-index change of the same shape and should be its own batch.
2. **`POST /api/v1/admin/client-invitations` has no rate limit**, unlike
   `POST /api/v1/admin/invitations` (`invitation-create`, 30/hour per
   administrator). Rate limiting is a separate control and would not have
   prevented this race (every request is an authorized administrator action), so
   it was not changed here.
3. **Invite-vs-accept overlap.** The "contact already has portal access" check
   and the insert are still two statements: a contact can, in principle, accept
   an old invitation while a new invitation is being created. The consequence is
   an extra pending row that the contact no longer needs — not a second usable
   identity, and not a second live invitation for the same recipient.
4. **Legacy duplicates that the migration forces an operator to resolve** (§3.3)
   are, by definition, still present until that operator acts. They are reported
   by the migration and by the query in §3.1; they are never silently resolved.
