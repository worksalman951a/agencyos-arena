# Phase 5B-2 — Project expense and change-order billing

## Existing architecture and additions

The baseline already had optional `ExpenseItem.projectId`, `billable` (default false), workspace-default expense currency, project-linked invoices, invoice line items, server-calculated totals/tax, invoice numbering and payment/idempotency handling. Change orders already had project links, pending/approved/rejected states, approver identity and audit records. Services resolve organization from the authenticated internal user and enforce permissions; portal invoice serializers expose only selected invoice fields and line-item details.

The gap was source-to-invoice linkage: a billable expense or approved change order could not be deliberately added to an invoice or reliably reported as billed. Phase 5B-2 adds nullable source IDs to `InvoiceItem`, a controlled add-to-draft-invoice action, eligible-source listing in invoice detail, status links in expense/change-order lists, and immutable source behavior after billing.

## Workflow and invariants

- Expenses remain optional-project and non-billable by default. Linking requires `expense.create`/`expense.update` plus `project.read`; project and expense are resolved in the caller's organization. Archived/deleted projects cannot receive new expense links.
- Expenses use the workspace currency (the existing model has no per-row currency); change-order amounts also use that currency. Billing rejects a project-source invoice with a different currency, a mismatched project client, non-positive/over-precision amounts, and cross-project or cross-organization sources. No conversion is performed.
- The invoice detail action is explicit and adds only billable expenses and approved change orders to an existing project-linked **draft** invoice. Rejected/pending/draft/cancelled/superseded states are not billable. No source is invoiced automatically.
- The existing invoice total calculator recalculates all existing plus new lines, retaining line/tax behavior. Invoice number allocation, payments, and existing line items are not rewritten.
- Each source ID is unique in `InvoiceItem`; insert, invoice totals, and audit event share a transaction. Concurrent duplicate attempts fail with 409 and roll back. Voided or soft-deleted invoices retain their line/source links, so they do not make a source eligible again. Billed sources cannot be edited/deleted through services; PostgreSQL update triggers close the edit-versus-billing race.
- Source IDs are not added to portal/share/print serializers. The new source listing requires internal RBAC and project access.

## Migration 0023

`prisma/migrations/0023_project_expense_change_order_billing/migration.sql` adds two nullable source columns on `InvoiceItem`, unique indexes, restrictive source foreign keys, and update guards. It inserts/updates/deletes no records. Existing invoice lines remain unlinked and unchanged; existing expense receipts and approval/audit history are preserved. Unlinked expenses remain valid.

### Deployment order

1. Take the normal database backup.
2. Run `npx prisma migrate deploy` so 0023 is applied.
3. Deploy the application build.

The previous application remains compatible with the added nullable columns and does not use them.

### Rollback limitations

Roll back the application first. The safest rollback is code-only while retaining 0023: this preserves billed-source history. If the schema must also be rolled back, only do so after reconciling/retaining all source-to-invoice associations; dropping the columns removes those associations and can make a previously billed source appear eligible if the feature is later redeployed. The rollback DDL (after code rollback) is:

```sql
BEGIN;
DROP TRIGGER IF EXISTS "ExpenseItem_billed_source_immutable" ON "ExpenseItem";
DROP TRIGGER IF EXISTS "ChangeOrder_billed_source_immutable" ON "ChangeOrder";
DROP FUNCTION IF EXISTS prevent_billed_source_update();
ALTER TABLE "InvoiceItem" DROP CONSTRAINT IF EXISTS "InvoiceItem_sourceExpenseId_fkey";
ALTER TABLE "InvoiceItem" DROP CONSTRAINT IF EXISTS "InvoiceItem_sourceChangeOrderId_fkey";
DROP INDEX IF EXISTS "InvoiceItem_sourceExpenseId_key";
DROP INDEX IF EXISTS "InvoiceItem_sourceChangeOrderId_key";
ALTER TABLE "InvoiceItem" DROP COLUMN IF EXISTS "sourceExpenseId";
ALTER TABLE "InvoiceItem" DROP COLUMN IF EXISTS "sourceChangeOrderId";
DELETE FROM "_prisma_migrations" WHERE migration_name = '0023_project_expense_change_order_billing';
COMMIT;
```

Invoice lines, totals, payments and source records survive this DDL, but source attribution does not. Do not use rollback as a billing reversal. A business reversal requires voiding/retaining the invoice and separate accounting treatment; there is no automatic re-bill/reversal feature in this phase.

## Boundaries

No time-entry invoicing, cross-project invoices, accounting ledger, profitability dashboards, currency conversion, or approval/document redesign is included. The invoice client must exactly match the project client (including both being null); there is no implicit third-party billing exception. Hard deletion of invoices is not offered by the application; its existing void/soft-delete paths retain line items and source references.
