# Phase 5A — Secure project-to-invoice linking

**Status:** implemented, awaiting review
**Scope:** the optional link between an invoice and a project, and the screens
that use it. One migration, changes to the existing invoice service / forms /
pages, tests, this document. Time-entry billing, expense billing, change-order
billing and profitability are **Phase 5B** and are not started here.

---

## 1. Data model

```
Organization 1 ─── n Project 1 ─── n Invoice        (Invoice.projectId is optional)
```

| Rule                                                   | How it is enforced                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| One project has many invoices                          | `Project.invoices Invoice[]`                                                                                                |
| An invoice belongs to at most one project              | single nullable column `Invoice.projectId`                                                                                  |
| Existing / project-less invoices stay valid            | column is nullable, no default, no backfill; `MATCH SIMPLE` skips the FK while it is `NULL`                                 |
| Project and invoice are in the **same organization**   | **composite foreign key** `Invoice(projectId, organizationId) → Project(id, organizationId)` — checked by PostgreSQL itself |
| A project cannot be moved away underneath its invoices | `ON UPDATE NO ACTION` on the same key                                                                                       |
| No destructive cascade on financial records            | `ON DELETE NO ACTION` — never `CASCADE`, never `SET NULL`                                                                   |
| Invoice id, number, totals, payments, history          | untouched: the migration adds one column and writes no row                                                                  |

### Why a composite foreign key

A plain `FOREIGN KEY ("projectId") REFERENCES "Project"("id")` only proves that
the project _exists_. Whether it belongs to the invoice's organization would then
depend on every writer (services, future imports, scripts, manual SQL) getting
the check right. The composite key makes the invoice's own `organizationId` part
of the reference, so a cross-organization link is not representable in the
database at all. The only schema adjustment this needs is a unique index on
`Project(id, organizationId)` as the key's target; `id` is already the primary
key, so that index can never reject a project row.

### Archive / delete behaviour

| Operation                                              | Result                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Archive a project (`status = archived`)                | Existing links are kept. The invoice shows the project with an `archived` badge. **New** links to the project are refused (400). |
| Soft-delete a project (`deletedAt`, the only app path) | Existing links are kept; badge `deleted`. New links are refused (404, indistinguishable from "does not exist").                  |
| Hard-delete a project that has invoices (SQL only)     | Rejected by PostgreSQL (`23503`). Invoices are neither deleted nor detached.                                                     |
| Hard-delete a project without invoices                 | Allowed, as before.                                                                                                              |
| Delete a whole organization                            | Works as before: `Invoice` and `Project` both cascade from `Organization`; `NO ACTION` is checked at statement end.              |
| Soft-delete / void an invoice                          | Link is kept (history), and can no longer be changed.                                                                            |

`NO ACTION` was chosen over `RESTRICT` deliberately: `RESTRICT` is checked
immediately and would break the existing organization-delete cascade.

---

## 2. Migration `0020_bento_invoice_project_link`

```sql
ALTER TABLE "Invoice" ADD COLUMN "projectId" TEXT;

CREATE UNIQUE INDEX "Project_id_organizationId_key"
  ON "Project"("id", "organizationId");

CREATE INDEX "Invoice_organizationId_projectId_idx"
  ON "Invoice"("organizationId", "projectId");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_organizationId_fkey"
  FOREIGN KEY ("projectId", "organizationId")
  REFERENCES "Project"("id", "organizationId")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
```

| Object                                   | Purpose                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `Invoice.projectId` (nullable `TEXT`)    | the link                                                                           |
| `Project_id_organizationId_key` (unique) | target of the composite FK; adds no new restriction (`id` is the primary key)      |
| `Invoice_organizationId_projectId_idx`   | project workspace list, project filter, and the FK check when a project is deleted |
| `Invoice_projectId_organizationId_fkey`  | same-organization integrity, no cascade                                            |

Properties:

- **Additive.** No `UPDATE`, `INSERT` or `DELETE`. No backfill and no automatic
  assignment: every existing invoice starts with `projectId = NULL`.
- **Backward compatible.** The previous application version neither reads nor
  writes the column and keeps working against the migrated database.
- **Locking.** `ADD COLUMN` (nullable, no default) is catalog-only. The unique
  index is built over the primary-key column plus one more column and cannot
  fail on existing data. `ADD CONSTRAINT` validates existing rows, all of which
  are `NULL` and therefore skipped. Locks are short; on very large tables run
  the migration in a quiet period.

### Deployment order

1. Take the usual pre-deployment backup.
2. `npx prisma migrate deploy` (applies `0020`).
3. Deploy the application code.

The reverse order is not safe: the new code selects `Invoice.projectId`.

### Rollback

1. Roll the application back to the previous release **first**.
2. Then, only if the column must go:

```sql
BEGIN;
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_projectId_organizationId_fkey";
DROP INDEX IF EXISTS "Invoice_organizationId_projectId_idx";
DROP INDEX IF EXISTS "Project_id_organizationId_key";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "projectId";
DELETE FROM "_prisma_migrations" WHERE migration_name = '0020_bento_invoice_project_link';
COMMIT;
```

Rolling back loses only the project links recorded after the migration. Invoice
numbers, totals, payments and audit rows are not touched. Step 1 alone is a
complete rollback of behaviour; step 2 is optional.

### Compatibility evidence

Verified on PostgreSQL 16 against a database migrated to the baseline
(`0001`–`0020`) and loaded with legacy data **before** `0020` was applied:
250 invoices, 250 line items, 100 payments in two organizations.

| Check                                                                   | Result                                 |
| ----------------------------------------------------------------------- | -------------------------------------- |
| Row counts of invoices / items / payments before vs. after              | identical                              |
| md5 fingerprint of every pre-existing column of all three tables        | identical                              |
| Sum of invoice totals (58 625) and of payments (11 975)                 | identical                              |
| Invoices linked by the migration                                        | 0                                      |
| Link an invoice to a project of its own organization                    | accepted                               |
| Link to a project of another organization                               | rejected, `23503` on the composite FK  |
| Link to a project id that does not exist                                | rejected, `23503`                      |
| Hard-delete a project that has invoices                                 | rejected, `23503`; invoices intact     |
| Move a referenced project, or a linked invoice, to another organization | rejected, `23503`                      |
| Hard-delete a project without invoices                                  | accepted                               |
| Delete an organization (cascade)                                        | accepted; other organization untouched |
| Rollback DDL (executed inside a transaction that was rolled back)       | succeeds                               |

The same guarantees are asserted permanently by the `migration 0020` and
`cross-organization association` groups of
`lib/__tests__/integration/finance.project-invoices.integration.test.ts`, which
run against the CI PostgreSQL service on every push.

---

## 3. Backend

All logic lives in the existing `lib/services/crm/invoice-service.ts`; no new
service, route or permission was introduced.

**API contract** (`/api/v1/crm/invoices`, unchanged routes)

| Call                    | `projectId`                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `POST`                  | omitted or `null` → no project; cuid → link                                                      |
| `PUT /:id`              | omitted → unchanged; `null` → unlink; cuid → link / reassign                                     |
| `GET ?projectId=<cuid>` | filter; always combined with the caller's organization                                           |
| responses               | `projectId` always; `project { id, name, status, deleted }` only for callers with `project.read` |

**Authorization**

- The organization always comes from the session. The schemas are `.strict()`,
  so a client-supplied `organizationId` is rejected with 400 rather than ignored.
- Linking requires `project.read` **in addition to** `invoice.create` /
  `invoice.update`: a finance-only role cannot attach invoices to projects it is
  not allowed to see, and cannot use the endpoint to probe project ids.
- An eligible project is in the caller's organization, not soft-deleted and not
  archived. Unknown, foreign and soft-deleted ids all answer the same
  non-disclosing `404`; an archived project answers `400`.
- Project names are serialized only for callers with `project.read`. Others get
  the bare `projectId` and the UI shows "Linked to a project you do not have
  access to".
- The project filter never widens access: it is an additional `WHERE` term next
  to `organizationId`, so a foreign project id yields an empty page.

**Lifecycle rules for changing the association**

| Invoice state                   | Link / reassign / unlink |
| ------------------------------- | ------------------------ |
| `draft`, no payments            | allowed                  |
| `sent`, no payments             | allowed                  |
| `sent` with a (partial) payment | refused, 400             |
| `paid`, `overdue`, `voided`     | refused, 400             |
| soft-deleted                    | refused, 400             |

The decision is taken inside the update transaction after
`SELECT … FOR UPDATE` on the invoice row — the same lock `recordPayment` takes —
so a reassignment and a concurrent payment are serialized; whichever commits
second sees the other's result. Re-sending the current `projectId` is not a
change: it is neither re-validated nor audited, so an invoice whose project was
archived later stays editable.

**Audit.** Every real change writes an `invoice.project_change` audit row
(`from`, `to`) in the same transaction as the update. Creation records the
project in the existing `invoice.create` row.

**Unchanged on purpose:** number allocation and its retry, total calculation,
currency handling, payment recording and idempotency, status transitions, the
estimate → invoice conversion (creates an unlinked invoice), and every portal /
print / share reader (they select explicit columns and never load the project).

### Defect fixed on the way

`invoiceUpdateSchema` was built from the create schema with `.partial()` and so
inherited `currency: z.string().default('USD')`. Zod applies defaults to
optional keys, which meant **every `PUT` that omitted `currency` carried
`currency: 'USD'`** — and an empty body passed the "at least one field" check.
A project-only update (`{ "projectId": … }`) of a EUR invoice would have rewritten
it to USD. The update schema now declares `currency` without a default. This is
present at the baseline commit, independent of this feature, and is covered by
`does not rewrite the currency when only the project is changed`.

---

## 4. UI

Existing pages and forms were extended; nothing was rebuilt.

| Screen                        | Change                                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/finance/invoices/new`       | optional **Project** select ("No project" default). `?projectId=` preselects the project and its client — only if the server finds it among the caller's eligible projects; otherwise a notice is shown and nothing is preselected. |
| `/finance/invoices/[id]/edit` | same select; disabled with an explanation once the invoice has payments, and the field is then not sent at all.                                                                                                                     |
| `/finance/invoices/[id]`      | **Project** card with a link to the workspace and an `archived` / `deleted` badge.                                                                                                                                                  |
| `/finance/invoices`           | **Project** column and a project filter (hidden for roles without `project.read`).                                                                                                                                                  |
| `/projects/[id]`              | **Invoices (n)** section (only with `invoice.read`), "View all" → filtered list, "+ New Invoice" → handoff (only with `invoice.create`, never for archived / deleted projects).                                                     |

The pickers are filled by `listProjectOptions()` in the project service
(`project.read`, organization-scoped, no soft-deleted, archived excluded unless
it is the invoice's current project). The browser never decides eligibility: the
select is a convenience, the service and the foreign key are the control.

---

## 5. Tests

| Layer                         | File                                                                     | Tests |
| ----------------------------- | ------------------------------------------------------------------------ | ----- |
| Unit (service + schema)       | `lib/__tests__/crm/invoice-project-link.test.ts`                         | 28    |
| Unit (forms + page wiring)    | `lib/__tests__/finance/invoice-project-ui.test.tsx`                      | 13    |
| Unit (portal redaction)       | `lib/__tests__/portal/portal-workspace.test.ts` (+1)                     | 1     |
| PostgreSQL / HTTP integration | `lib/__tests__/integration/finance.project-invoices.integration.test.ts` | 39    |
| End-to-end (Playwright)       | `tests/e2e/project-invoices.spec.ts`                                     | 2     |

Required case → integration group:

| #   | Requirement                               | Group                                                      |
| --- | ----------------------------------------- | ---------------------------------------------------------- |
| 1–3 | linked / unlinked / many per project      | `creating invoices`                                        |
| 4   | cross-organization rejection              | `cross-organization association` (service **and** raw SQL) |
| 5   | unauthorized project / invoice access     | `unauthorized project/invoice access`                      |
| 6   | invalid / archived projects               | `invalid or archived projects`                             |
| 7   | project filter                            | `filtering invoices by project`                            |
| 8   | project → invoice handoff                 | `project-to-invoice creation handoff` + E2E                |
| 9   | lifecycle / reassignment                  | `invoice lifecycle and reassignment restrictions`          |
| 10  | payments, currencies, numbering unchanged | `payments, currencies and numbering are unchanged`         |
| 11  | migration compatibility                   | `migration 0020`                                           |

---

## 6. Known limitations

- An invoice has one project. Splitting one invoice across projects is out of
  scope (and would be a line-level concept, Phase 5B at the earliest).
- The project and the client of an invoice are independent: the handoff
  preselects the project's client, but a different client may be chosen.
- Invoices converted from estimates start unlinked; the estimate has no project.
- The project pickers list at most 200 projects and the project workspace shows
  the 50 most recent invoices, with "View all" for the rest.
- Once an invoice has a payment or has left `draft` / `sent`, its project is
  frozen. Correcting a wrong link then needs a void-and-reissue, by design.
- The link carries no amounts: project budgets, billed-to-date and
  profitability are not derived from it yet.

## 7. Left for Phase 5B

Time-entry billing (`TimeEntry` has no `projectId` today, only `taskId`),
expense billing, change-order billing, project profitability / billed-vs-budget
reporting, and any line-level attribution of invoice items to project work.
