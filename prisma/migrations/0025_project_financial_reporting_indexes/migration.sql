-- Support project-financial summaries and per-invoice payment aggregation.
-- Additive only: these indexes do not alter or rewrite financial records.
CREATE INDEX "ExpenseItem_organizationId_projectId_expenseDate_idx"
  ON "ExpenseItem" ("organizationId", "projectId", "expenseDate");

CREATE INDEX "ChangeOrder_organizationId_projectId_status_idx"
  ON "ChangeOrder" ("organizationId", "projectId", "status");

CREATE INDEX "Payment_invoiceId_idx"
  ON "Payment" ("invoiceId");

-- Rollback: DROP INDEX IF EXISTS "ExpenseItem_organizationId_projectId_expenseDate_idx";
-- Rollback: DROP INDEX IF EXISTS "ChangeOrder_organizationId_projectId_status_idx";
-- Rollback: DROP INDEX IF EXISTS "Payment_invoiceId_idx";
