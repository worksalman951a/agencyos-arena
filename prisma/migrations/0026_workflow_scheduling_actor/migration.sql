-- Bind newly-created scheduled workflow rules to the user whose current
-- organization permissions authorize their actions. Existing rules remain
-- compatible and are intentionally unowned until an explicit future policy.
ALTER TABLE "WorkflowRule" ADD COLUMN "createdBy" TEXT;

ALTER TABLE "WorkflowRule"
  ADD CONSTRAINT "WorkflowRule_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkflowRule_organizationId_trigger_enabled_idx"
  ON "WorkflowRule" ("organizationId", "trigger", "enabled");
CREATE INDEX "WorkflowRule_createdBy_idx" ON "WorkflowRule" ("createdBy");

-- Rollback:
-- DROP INDEX IF EXISTS "WorkflowRule_createdBy_idx";
-- DROP INDEX IF EXISTS "WorkflowRule_organizationId_trigger_enabled_idx";
-- ALTER TABLE "WorkflowRule" DROP CONSTRAINT IF EXISTS "WorkflowRule_createdBy_fkey";
-- ALTER TABLE "WorkflowRule" DROP COLUMN IF EXISTS "createdBy";
