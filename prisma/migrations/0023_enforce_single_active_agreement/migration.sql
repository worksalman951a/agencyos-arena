-- Migration 0023: database guarantee of at most one active agreement per
-- quotation.
--
-- The approved sales workflow allows an optional Quotation -> Agreement step.
-- Two simultaneous "Create Agreement" requests for the same accepted quotation
-- must both end up pointing at the same agreement, not create two contracts.
-- Application code serialises on the quotation row, but a constraining
-- application check alone is not a guarantee; this partial unique index is:
--
--     at most one Contract per quotationId whose status is not 'voided'.
--
-- Why partial
-- ------------
--  * Agreements that were not created from a quotation ("quotationId" IS NULL)
--    are not constrained; standalone and proposal-sourced contracts are
--    unaffected.
--  * Voided agreements are excluded, so a replacement agreement can be created
--    after the previous one is voided, while the voided row is kept for audit.
--  * A quotation may therefore have any number of historical (voided)
--    agreements, but exactly one active one.
--
-- Prisma cannot express partial indexes in schema.prisma, so the constraint
-- lives here (the same approach as migration 0015's payment idempotency index).
--
-- Pre-flight guard - report duplicates, never repair them
-- ------------------------------------------------------
-- If a database already contains two active agreements for one quotation (for
-- example created during a race before this migration), creating the index
-- would fail. The DO block below stops the migration with the offending
-- quotation ids instead, and changes no data: voiding one of the duplicates is a
-- business decision that must be made explicitly.
--
-- Locking / deployment
-- --------------------
--  * The index build scans Contract but writes nothing.
--  * It takes a SHARE lock on "Contract"; on very large tables run during a
--    quiet period.
--  * Deploy the migration before the application version that relies on it.
--
-- Rollback (additive index only; no data is changed):
--   DROP INDEX IF EXISTS "Contract_quotationId_active_key";
-- and remove the 0023 row from "_prisma_migrations".

-- ============================================
-- Pre-flight guard
-- ============================================

DO $$
DECLARE
  duplicate_agreements TEXT;
BEGIN
  SELECT string_agg(
           format('quotation %s (org %s): %s active agreements (%s)',
                  "quotationId", "organizationId", occurrences, ids),
           E'\n' ORDER BY "quotationId")
    INTO duplicate_agreements
    FROM (
      SELECT "quotationId",
             "organizationId",
             count(*) AS occurrences,
             string_agg(id, ', ' ORDER BY "createdAt", id) AS ids
        FROM "Contract"
       WHERE "quotationId" IS NOT NULL
         AND "status" <> 'voided'
       GROUP BY "quotationId", "organizationId"
      HAVING count(*) > 1
       LIMIT 20
    ) duplicates;

  IF duplicate_agreements IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create the single-active-agreement unique index: duplicates exist.%',
      E'\n' || duplicate_agreements ||
      E'\nNo data was changed. Void the duplicate agreements (status = ''voided'')'
      ' or investigate them, then re-run the migration.';
  END IF;
END
$$;

-- ============================================
-- One active (non-voided) agreement per quotation
-- ============================================

CREATE UNIQUE INDEX "Contract_quotationId_active_key"
  ON "Contract" ("quotationId")
  WHERE "quotationId" IS NOT NULL AND "status" <> 'voided';
