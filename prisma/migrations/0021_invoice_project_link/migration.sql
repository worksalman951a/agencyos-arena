-- Migration 0021 (Phase 5A): optional, organization-safe link from an invoice
-- to a project.
--
--   Invoice.projectId  NULL            -> invoice is not tied to a project
--   Invoice.projectId  = Project.id    -> invoice belongs to that project
--
-- One project may have many invoices; an invoice has at most one project.
--
-- Additive only. No row is inserted, updated or deleted: every existing
-- invoice keeps its id, number, totals, currency, status and payments, and
-- starts with projectId = NULL (nothing is backfilled or guessed).
--
-- Why the foreign key is composite
-- --------------------------------
-- A plain FK on ("projectId") would let any writer attach an invoice to a
-- project of ANOTHER organization; only application code would stand in the
-- way. The FK below references Project("id", "organizationId") using the
-- invoice's own "organizationId", so PostgreSQL rejects a cross-organization
-- link for every writer (services, scripts, imports, manual SQL).
--
-- MATCH SIMPLE (the default) skips the check while "projectId" IS NULL, which is
-- exactly what keeps project-less invoices valid. "organizationId" is NOT NULL,
-- so a link can never be half-specified.
--
-- Referential actions
-- -------------------
-- ON DELETE NO ACTION: a project that still has invoices cannot be hard-deleted.
--   Never CASCADE (would destroy financial records) and never SET NULL (would
--   silently detach them; on a composite key it would also try to null
--   "organizationId"). The application only soft-deletes/archives projects, and
--   those operations leave the link untouched.
--   NO ACTION rather than RESTRICT so that deleting a whole organization still
--   works: both tables cascade from Organization and the check is evaluated at
--   the end of the statement, when the invoices are already gone.
-- ON UPDATE NO ACTION: a referenced project cannot be moved to another
--   organization (or re-keyed) underneath its invoices.
--
-- Locking / deployment
-- --------------------
--  * ADD COLUMN (nullable, no default) is a catalog-only change.
--  * The unique index is built on (id, organizationId); "id" is already the
--    primary key, so the build cannot fail on existing data.
--  * ADD CONSTRAINT validates existing rows, all of which have projectId NULL.
--  The statements take short ACCESS EXCLUSIVE / SHARE ROW EXCLUSIVE locks on
--  "Invoice" and "Project". On very large tables run during a quiet period.
--  Deploy the migration BEFORE the application code that reads the column; the
--  previous application version is unaffected by the new nullable column.
--
-- Rollback (loses only the project links recorded after this migration):
--   ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_projectId_organizationId_fkey";
--   DROP INDEX IF EXISTS "Invoice_organizationId_projectId_idx";
--   DROP INDEX IF EXISTS "Project_id_organizationId_key";
--   ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "projectId";
-- and remove the 0021 row from "_prisma_migrations". Roll the application back
-- first. Details: docs/phase-5a/project-invoice-linking.md

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "projectId" TEXT;

-- CreateIndex: target of the composite foreign key
-- (matches @@unique([id, organizationId]) on Project in schema.prisma)
CREATE UNIQUE INDEX "Project_id_organizationId_key" ON "Project"("id", "organizationId");

-- CreateIndex: project workspace listing, project filter, FK check on delete
-- (matches @@index([organizationId, projectId]) on Invoice in schema.prisma)
CREATE INDEX "Invoice_organizationId_projectId_idx" ON "Invoice"("organizationId", "projectId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE NO ACTION ON UPDATE NO ACTION;
