# Phase 5B-1 — Direct project time linking, billing rates, and summaries

**Status:** implemented
**Scope:** direct `projectId` linking on `TimeEntry`, optional `hourlyRate` + `currency` snapshotting, owner/admin authorization hardening, multi-currency project time summaries, and Phase 5A client-mismatch isolation verification. Expense billing, invoice generation from time entries, and profitability/billed-vs-budget reporting remain deferred to later Phase 5B sub-phases.

---

## 1. Phase 5A Client-Mismatch Security Follow-up

Phase 5A intentionally keeps an invoice's `projectId` and `clientId` independent (supporting third-party / agency billing where a project's contact differs from the payer). Security review confirmed:

- `invoice-service.ts` gates project summaries (`INVOICE_PROJECT_SELECT` = `id`, `name`, `status`, `deletedAt`, excluding `clientId`/`client`) on `project.read`. Callers without `project.read` receive `project: null`.
- `portal-workspace-service.ts` (`listPortalInvoices` and `getPortalProject`) uses explicit `select` allow-lists backed by per-resource `ClientResourceGrant` checks: portal invoices never expose `projectId`, `project`, or `clientId`, and portal project views never select or surface `invoices`, `timeEntries`, `budget`, or `clientId`.
- `/share/[token]` does not support invoices.
- Regression tests added to `lib/__tests__/portal/portal-workspace.test.ts` and `lib/__tests__/integration/finance.project-invoices.integration.test.ts`.

---

## 2. Data model & Migration `0022_time_entry_project_and_billing`

`TimeEntry` gains:

- `projectId String?` — direct optional project link (`TimeEntry_projectId_organizationId_fkey` composite FK referencing `Project(id, organizationId)` with `ON DELETE NO ACTION ON UPDATE NO ACTION`, reusing `Project_id_organizationId_key` from migration `0021`).
- `hourlyRate Decimal?` — optional snapshotted hourly billing rate (billable entries only).
- `currency String?` — ISO 4217 alphabetic code paired with `hourlyRate`.
- `updatedAt DateTime @default(now()) @updatedAt`.
- Composite indexes `TimeEntry_organizationId_projectId_idx` and `TimeEntry_organizationId_userId_date_idx`.

### Backfill & referential behavior

- Existing task-linked rows (`taskId IS NOT NULL` and `projectId IS NULL`) have `projectId` safely backfilled from `Task.projectId` within the same `organizationId`.
- Existing billing rates and currencies remain `NULL` (never guessed).
- Deleting a `Task` (`ON DELETE SET NULL` on `taskId`) preserves `TimeEntry.projectId`, so project hours and summaries stay intact.
- `ON DELETE NO ACTION` on `(projectId, organizationId)` prevents accidental raw SQL hard-deletes of projects that hold time entries while keeping whole-organization cascade deletes (`Organization` -> `Project` & `TimeEntry`) working via end-of-statement constraint checking.

### Deployment order & rollback

1. Take a pre-deployment backup.
2. Run `npx prisma migrate deploy` (`0022`) before deploying application code.
3. Rollback (only after rolling application code back first):

```sql
BEGIN;
ALTER TABLE "TimeEntry" DROP CONSTRAINT IF EXISTS "TimeEntry_projectId_organizationId_fkey";
DROP INDEX IF EXISTS "TimeEntry_organizationId_userId_date_idx";
DROP INDEX IF EXISTS "TimeEntry_organizationId_projectId_idx";
ALTER TABLE "TimeEntry"
  DROP COLUMN IF EXISTS "updatedAt",
  DROP COLUMN IF EXISTS "currency",
  DROP COLUMN IF EXISTS "hourlyRate",
  DROP COLUMN IF EXISTS "projectId";
DELETE FROM "_prisma_migrations" WHERE migration_name = '0022_time_entry_project_and_billing';
COMMIT;
```

---

## 3. Security, Authorization & Validation Rules

- **Session & organization isolation:** `organizationId` is resolved strictly from the authenticated session; `.strict()` Zod schemas reject client-supplied `organizationId` with `400`. Cross-organization lookups return non-disclosing `404`.
- **RBAC:** `GET` / `POST` / `PUT` / `DELETE` require `time.entry.read` / `time.entry.create` / `time.entry.update` / `time.entry.delete`.
- **Ownership:** Non-admin users can only log time for themselves (`403` when targeting another `userId`) and can only update or delete their own entries (`403` otherwise). Organization `Administrator` (`isSystem: true`) users may manage entries across org members.
- **Task / project consistency:** If `taskId` is provided, `projectId` is automatically derived from `task.projectId`, and mismatched `projectId !== task.projectId` is rejected (`400`).
- **Archived & deleted projects:** Creating or moving a time entry onto an archived project is rejected (`400`); soft-deleted projects return `404`. Historical entries on subsequently archived or deleted projects remain readable and editable for typo fixes as long as their project/task link is not reassigned onto an archived/deleted target.

---

## 4. Billing Rate Snapshots & Multi-Currency Summaries

- **Non-billable entries:** Store `hourlyRate: null` and `currency: null`. Toggling an entry from `billable: true` to `billable: false` clears `hourlyRate` and `currency`. Setting `hourlyRate` or `currency` on a non-billable entry without `billable: true` returns `400`.
- **Billable entries:**
  - `hourlyRate` and `currency` remain optional for backward compatibility.
  - When `hourlyRate` is provided without `currency`, the organization's `defaultCurrency` is resolved once at write time and snapshotted onto the `TimeEntry`.
  - Specifying `currency` without `hourlyRate` returns `400`.
  - `timeEntryUpdateSchema` declares fields without `.default(...)` so partial updates (`hours`, `description`, etc.) or later changes to organization `defaultCurrency` never mutate historical billing fields.
- **Exact arithmetic & summary (`lib/projects/time-entry-billing.ts`):**
  - Hours are accumulated in integer ten-thousandths (`10_000`ths) and money is computed via `BigInt` multiplication with half-up rounding into integer minor units.
  - `GET /api/v1/projects/time-entries` keeps returning `TimeEntryResponse[]` for backward compatibility; `GET /api/v1/projects/time-entries/summary` and `getProjectWorkspaceDetails().timeSummary` return `TimeEntrySummary` with `billableAmountsByCurrency` strictly grouped per ISO currency (never combined or converted) and `unratedBillableHours` tracked separately.
