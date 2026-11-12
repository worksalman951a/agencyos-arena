-- Migration 0022 (Phase 5B-1): direct optional project link, billing rate,
-- currency snapshot, and update timestamp on TimeEntry.
--
--   TimeEntry.projectId  NULL           -> general non-project time entry
--   TimeEntry.projectId  = Project.id   -> time entry belongs to that project
--                                          (either direct project time or via task)
--   TimeEntry.hourlyRate                -> optional snapshotted hourly rate (when billable)
--   TimeEntry.currency                  -> ISO 4217 currency code for hourlyRate
--   TimeEntry.updatedAt                 -> last modification timestamp
--
-- Additive only for columns and constraints. Existing time entries keep their
-- id, userId, taskId, date, hours, description, billable, and createdAt.
-- Any existing task-linked time entry with projectId IS NULL has its projectId
-- safely backfilled from Task.projectId (within the same organization) so
-- project-level time summaries and filters cover legacy entries uniformly, and
-- task deletions (ON DELETE SET NULL on taskId) never lose project attribution.
-- Billing rates and currencies stay NULL on historical rows (never guessed).
--
-- Why the foreign key is composite
-- --------------------------------
-- Mirrors Invoice_projectId_organizationId_fkey (migration 0021).
-- Project("id", "organizationId") already carries Project_id_organizationId_key.
-- referencing ("projectId", "organizationId") ensures PostgreSQL rejects any
-- cross-organization link at the database layer regardless of writer.
-- MATCH SIMPLE skips the check while "projectId" IS NULL.
--
-- Referential actions
-- -------------------
-- ON DELETE NO ACTION: a project with time entries cannot be hard-deleted via
--   raw SQL without preserving or cleaning up its entries (the app only
--   soft-deletes/archives projects, leaving historical time intact).
--   NO ACTION rather than RESTRICT preserves Organization cascade deletes
--   because both tables cascade from Organization and NO ACTION is evaluated
--   at statement end.
-- ON UPDATE NO ACTION: a referenced project cannot be moved across orgs.
--
-- Deployment order
-- ----------------
-- 1. Take a pre-deployment backup.
-- 2. Apply migration 0022 (`npx prisma migrate deploy`) BEFORE deploying code.
--
-- Rollback (loses only direct projectId / hourlyRate / currency / updatedAt):
--   ALTER TABLE "TimeEntry" DROP CONSTRAINT IF EXISTS "TimeEntry_projectId_organizationId_fkey";
--   DROP INDEX IF EXISTS "TimeEntry_organizationId_userId_date_idx";
--   DROP INDEX IF EXISTS "TimeEntry_organizationId_projectId_idx";
--   ALTER TABLE "TimeEntry"
--     DROP COLUMN IF EXISTS "updatedAt",
--     DROP COLUMN IF EXISTS "currency",
--     DROP COLUMN IF EXISTS "hourlyRate",
--     DROP COLUMN IF EXISTS "projectId";
-- and remove the 0022 row from "_prisma_migrations" after rolling back the app.

-- AlterTable
ALTER TABLE "TimeEntry"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "hourlyRate" DECIMAL(65,30),
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill direct projectId for existing task-linked time entries (same organization only)
UPDATE "TimeEntry" AS te
SET "projectId" = t."projectId"
FROM "Task" AS t
WHERE te."taskId" = t."id"
  AND te."organizationId" = t."organizationId"
  AND te."projectId" IS NULL;

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_projectId_idx" ON "TimeEntry"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_userId_date_idx" ON "TimeEntry"("organizationId", "userId", "date");

-- AddForeignKey
ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_projectId_organizationId_fkey"
  FOREIGN KEY ("projectId", "organizationId")
  REFERENCES "Project"("id", "organizationId")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
