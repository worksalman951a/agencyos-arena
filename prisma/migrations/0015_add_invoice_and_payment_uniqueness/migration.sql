-- Migration 0015: Database-level uniqueness for invoice numbers and payment
-- idempotency keys.
--
-- Incremental only: creates two indexes, modifies no rows.
--
-- Run scripts/audit-uniqueness.mjs (read-only) on a database before applying
-- this migration. If duplicates exist the DO block below stops the migration
-- with the offending keys instead of letting PostgreSQL fail mid-way, and no
-- data is changed: numbering/repointing stays a manual decision.
-- Remediation guidance: docs/phase-3a/uniqueness-hardening.md
--
-- Rollback (safe at any time; both indexes are additive):
--   DROP INDEX IF EXISTS "Invoice_organizationId_number_key";
--   DROP INDEX IF EXISTS "Payment_invoiceId_idempotencyKey_key";
--
-- ============================================
-- Pre-flight guard — report duplicates, never repair them
-- ============================================

DO $$
DECLARE
  duplicate_invoices TEXT;
  duplicate_payments TEXT;
BEGIN
  SELECT string_agg(
           format('org %s / number %s (%s rows: %s)',
                  "organizationId", number, occurrences, ids),
           E'\n' ORDER BY number)
    INTO duplicate_invoices
    FROM (
      SELECT "organizationId",
             number,
             count(*) AS occurrences,
             string_agg(id, ', ' ORDER BY id) AS ids
        FROM "Invoice"
       GROUP BY "organizationId", number
      HAVING count(*) > 1
       LIMIT 20
    ) duplicates;

  IF duplicate_invoices IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create the invoice number unique index: duplicate numbers exist.%',
      E'\n' || duplicate_invoices ||
      E'\nNo data was changed. Run node scripts/audit-uniqueness.mjs and see'
      ' docs/phase-3a/uniqueness-hardening.md.';
  END IF;

  SELECT string_agg(
           format('invoice %s / key %s (%s rows: %s)',
                  "invoiceId", "idempotencyKey", occurrences, ids),
           E'\n')
    INTO duplicate_payments
    FROM (
      SELECT "invoiceId",
             "idempotencyKey",
             count(*) AS occurrences,
             string_agg(id, ', ' ORDER BY id) AS ids
        FROM "Payment"
       WHERE "idempotencyKey" IS NOT NULL
         AND btrim("idempotencyKey") <> ''
       GROUP BY "invoiceId", "idempotencyKey"
      HAVING count(*) > 1
       LIMIT 20
    ) duplicates;

  IF duplicate_payments IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create the payment idempotency unique index: duplicate keys exist.%',
      E'\n' || duplicate_payments ||
      E'\nNo data was changed. Run node scripts/audit-uniqueness.mjs and see'
      ' docs/phase-3a/uniqueness-hardening.md.';
  END IF;
END
$$;

-- ============================================
-- Invoice numbers are unique per organization
-- (matches @@unique([organizationId, number]) in schema.prisma)
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_number_key"
  ON "Invoice" ("organizationId", "number");

-- ============================================
-- Payment idempotency keys are unique per invoice.
--
-- Partial index: keyless payments (NULL) and legacy blank keys stay valid and
-- unconstrained, so the index never blocks a legitimate payment. New writes
-- normalise blank keys to NULL before insert.
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_invoiceId_idempotencyKey_key"
  ON "Payment" ("invoiceId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL AND btrim("idempotencyKey") <> '';
