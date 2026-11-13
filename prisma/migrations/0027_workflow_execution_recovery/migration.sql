-- Phase 6B: bounded workflow retries, lease fencing, and operational monitoring.
ALTER TABLE "WorkflowRule" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "WorkflowExecution"
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "terminalAt" TIMESTAMP(3),
  ADD COLUMN "errorCategory" TEXT,
  ADD COLUMN "claimToken" TEXT;

-- Preserve old failed rows and make their first safe retry eligible one minute
-- after the last known attempt. Rows without an action snapshot are quarantined
-- by the recovery worker rather than replaying current rule definitions.
UPDATE "WorkflowExecution"
SET "nextAttemptAt" = COALESCE("lastAttemptAt", "updatedAt") + INTERVAL '1 minute'
WHERE "status" = 'failed';

CREATE INDEX "WorkflowExecution_status_nextAttemptAt_idx"
  ON "WorkflowExecution" ("status", "nextAttemptAt");
CREATE INDEX "WorkflowExecution_status_lastAttemptAt_idx"
  ON "WorkflowExecution" ("status", "lastAttemptAt");
CREATE INDEX "WorkflowExecution_status_errorCategory_updatedAt_idx"
  ON "WorkflowExecution" ("status", "errorCategory", "updatedAt");

-- Rollback:
-- DROP INDEX IF EXISTS "WorkflowExecution_status_errorCategory_updatedAt_idx";
-- DROP INDEX IF EXISTS "WorkflowExecution_status_lastAttemptAt_idx";
-- DROP INDEX IF EXISTS "WorkflowExecution_status_nextAttemptAt_idx";
-- ALTER TABLE "WorkflowExecution" DROP COLUMN IF EXISTS "claimToken";
-- ALTER TABLE "WorkflowExecution" DROP COLUMN IF EXISTS "errorCategory";
-- ALTER TABLE "WorkflowExecution" DROP COLUMN IF EXISTS "terminalAt";
-- ALTER TABLE "WorkflowExecution" DROP COLUMN IF EXISTS "nextAttemptAt";
-- ALTER TABLE "WorkflowRule" DROP COLUMN IF EXISTS "deletedAt";
