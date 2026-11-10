# Finance uniqueness hardening (migration 0015)

Adds database-level guarantees behind two file-level contracts that previously
rested on application logic alone:

| Index                                  | Table     | Protects                                                                                                                                                                               |
| -------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invoice_organizationId_number_key`    | `Invoice` | Invoice numbers are unique **per organization** (`@@unique([organizationId, number])` in `prisma/schema.prisma`).                                                                      |
| `Payment_invoiceId_idempotencyKey_key` | `Payment` | A payment idempotency key is unique **per invoice**, partial index (`WHERE "idempotencyKey" IS NOT NULL AND btrim("idempotencyKey") <> ''`) so keyless payments are never constrained. |

Both indexes are additive. The migration **modifies no rows**.

## 1. Audit first (read-only)

```bash
DATABASE_URL="postgresql://…" node scripts/audit-uniqueness.mjs
```

The script only issues `SELECT`/`SHOW` statements. It reports:

1. `Invoice(organizationId, number)` duplicate groups, with the affected ids and
   how many of them are not soft-deleted.
2. `Payment(invoiceId, idempotencyKey)` duplicate groups, ignoring `NULL` and
   blank keys.
3. Blank (`''`) idempotency keys — informational, they are excluded from the
   partial index and normalised to `NULL` on new writes.
4. Existing indexes/constraints on both tables, plus whether the two target
   indexes are already present.

Exit codes: `0` = no blocking duplicates, `1` = duplicates found (nothing was
changed), `2` = audit could not run.

## 2. If the audit reports duplicates

Do not apply the migration, and do not let anything "fix" the data
automatically. The migration's pre-flight `DO` block fails with the offending
keys, so `prisma migrate deploy` stops before any index is created.

Remediation is a human decision per group, because both cases involve financial
records:

**Invoice numbers (`Invoice(organizationId, number)`)**

1. Decide which row keeps the number (the one referenced by payments, sent to the
   client, or the earliest `createdAt`).
2. Give the other rows a fresh number from the organization's allocator sequence
   (`INV-YYYY-NNNN`), never a hand-invented one, and record why.
3. Re-run the audit until it exits `0`.

`lib/services/settings/document-numbering.ts` seeds its counter from the highest
existing sequence, so numbers assigned after remediation will not collide again.

**Payment idempotency keys (`Payment(invoiceId, idempotencyKey)`)**

Duplicates here mean the same submission was stored twice. Inspect the pair:

- Identical `amount`, `paidAt`, `reference` and `recordedBy` → a genuine double
  write. Correcting it **changes recorded revenue**, so it needs explicit
  approval; if approved, remove the surplus row _and_ re-derive the invoice status
  from the remaining payments.
- Different amounts or references → the key was reused by mistake. Keep both
  payments and clear the key on the later row (`UPDATE "Payment" SET
"idempotencyKey" = NULL WHERE id = '…'`), which preserves the money trail.

Nothing in this repository performs either of those edits automatically.

## 3. Applying the migration

```bash
node_modules/.bin/prisma migrate deploy
```

`migrate deploy` is the supported path: it applies the committed SQL in order and
records it in `_prisma_migrations`. Because `Payment_invoiceId_idempotencyKey_key`
is a **partial** index, `prisma migrate dev` would propose dropping it (Prisma
cannot express partial indexes); use `migrate deploy` for this repository.

The development database is not touched by CI or by any script here — applying
the migration to a real database is an explicit operator step.

## 4. Rollback

Both indexes are additive, so rollback is safe at any time and loses no data:

```sql
DROP INDEX IF EXISTS "Invoice_organizationId_number_key";
DROP INDEX IF EXISTS "Payment_invoiceId_idempotencyKey_key";
```

If the schema change should also be reverted, remove
`@@unique([organizationId, number])` from `model Invoice` and create a follow-up
migration that runs the two `DROP INDEX` statements above.

Rollback compatibility is exercised by
`lib/__tests__/integration/finance.uniqueness.integration.test.ts`, which drops
and recreates both indexes inside a transaction that is always rolled back.

## 5. Application behaviour on a collision

| Collision                            | Behaviour                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Invoice number taken (counter drift) | `createInvoice` retries up to three times with a freshly allocated number.         |
| Payment idempotency key taken        | `recordPayment` replays the stored payment (`duplicate: true`) instead of failing. |
| Blank / whitespace key               | Normalised to `NULL` before insert, so keyless payments stay unconstrained.        |
