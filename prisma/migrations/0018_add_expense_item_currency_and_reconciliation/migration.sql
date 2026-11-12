-- AlterTable ExpenseItem: Add explicit currency and audit reconciliation fields
-- Historical rows keep currency as NULL (representing UNRESOLVED currency).
-- Newly created rows explicitly persist an ISO 4217 currency.
ALTER TABLE "ExpenseItem" ADD COLUMN IF NOT EXISTS "currency" TEXT;
ALTER TABLE "ExpenseItem" ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3);
ALTER TABLE "ExpenseItem" ADD COLUMN IF NOT EXISTS "reconciledBy" TEXT;

-- Index to optimize multi-currency filtering and administrative reconciliation queries
CREATE INDEX IF NOT EXISTS "ExpenseItem_organizationId_currency_idx" ON "ExpenseItem"("organizationId", "currency");
