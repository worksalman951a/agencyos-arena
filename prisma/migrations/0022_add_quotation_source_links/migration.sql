-- Migration 0022: source-quotation links for invoices and agreements.
--
-- The approved sales workflow is:
--
--   Quotation ─────────────────────────▶ Invoice          (default)
--   Quotation ──▶ Agreement ───────────▶ Invoice          (optional)
--
-- A proposal stays optional: a quotation can be created directly or from a
-- proposal, and either way the accepted quotation can produce an invoice (and
-- optionally an agreement) with the client, line items, pricing and taxes
-- carried over from the source quotation.
--
-- To preserve that provenance, Invoice and Contract get an optional
-- `quotationId`. This migration is additive and destroys nothing:
--
--   * every existing invoice keeps its id, number, totals, currency, status,
--     payments and project link, and starts with quotationId = NULL;
--   * every existing contract keeps its id, title, status, signatures and
--     proposal/project links, and starts with quotationId = NULL;
--   * no Estimate row is read, changed or deleted. Retiring the estimate entry
--     points is a UI/API change only; the table and its records stay intact.
--
-- Why the foreign keys are composite
-- ----------------------------------
-- A plain FK on ("quotationId") would let any writer attach an invoice or an
-- agreement to a quotation of ANOTHER organization; only application code
-- would stand in the way. The FKs below reference Quotation("id",
-- "organizationId") using the document's own "organizationId", so PostgreSQL
-- rejects a cross-organization link for every writer (services, scripts,
-- imports, manual SQL). MATCH SIMPLE skips the check while "quotationId" IS
-- NULL, which keeps every legacy document valid. "organizationId" is NOT NULL,
-- so a link can never be half-specified.
--
-- Referential actions
-- -------------------
-- ON DELETE NO ACTION: a quotation that produced financial or legal documents
-- can never be hard-deleted (CASCADE would destroy them, SET NULL would
-- silently strip their provenance - and on a composite key it would also try
-- to null "organizationId"). Quotations are retired by soft delete
-- ("deletedAt"), which leaves these links untouched. NO ACTION rather than
-- RESTRICT keeps organization deletion working: both tables cascade from
-- Organization and the check is evaluated at the end of the statement.
-- ON UPDATE NO ACTION: a referenced quotation cannot be moved to another
-- organization underneath its documents.
--
-- Locking / deployment
-- --------------------
--  * ADD COLUMN (nullable, no default) is a catalog-only change.
--  * The unique index on Quotation(id, organizationId) is trivially buildable:
--    "id" is already the primary key.
--  * The (organizationId, quotationId) indexes are ordinary b-trees; every
--    existing row has quotationId NULL, so the builds are cheap.
--  * ADD CONSTRAINT validates existing rows, all of which have quotationId
--    NULL, so it cannot fail on current data.
--  Deploy this migration BEFORE the application code that writes the column;
--  the previous application version is unaffected by the new nullable column.
--
-- Rollback (loses only the source links recorded after this migration; no
-- invoice, agreement or estimate row is affected):
--   ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_quotationId_organizationId_fkey";
--   ALTER TABLE "Contract" DROP CONSTRAINT IF EXISTS "Contract_quotationId_organizationId_fkey";
--   DROP INDEX IF EXISTS "Invoice_organizationId_quotationId_idx";
--   DROP INDEX IF EXISTS "Contract_organizationId_quotationId_idx";
--   DROP INDEX IF EXISTS "Quotation_id_organizationId_key";
--   ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "quotationId";
--   ALTER TABLE "Contract" DROP COLUMN IF EXISTS "quotationId";
-- and remove the 0022 row from "_prisma_migrations".

-- AlterTable: nullable source links (existing rows stay NULL)
ALTER TABLE "Invoice" ADD COLUMN "quotationId" TEXT;
ALTER TABLE "Contract" ADD COLUMN "quotationId" TEXT;

-- CreateIndex: target of the composite foreign keys
-- (matches @@unique([id, organizationId]) on Quotation in schema.prisma)
CREATE UNIQUE INDEX "Quotation_id_organizationId_key" ON "Quotation"("id", "organizationId");

-- CreateIndex: quotation detail listings and the FK check on delete
CREATE INDEX "Invoice_organizationId_quotationId_idx" ON "Invoice"("organizationId", "quotationId");
CREATE INDEX "Contract_organizationId_quotationId_idx" ON "Contract"("organizationId", "quotationId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quotationId_organizationId_fkey" FOREIGN KEY ("quotationId", "organizationId") REFERENCES "Quotation"("id", "organizationId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_quotationId_organizationId_fkey" FOREIGN KEY ("quotationId", "organizationId") REFERENCES "Quotation"("id", "organizationId") ON DELETE NO ACTION ON UPDATE NO ACTION;
