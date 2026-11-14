# Approved sales workflow: Quotation → Invoice (Agreement optional)

## Paths

```
Default     Proposal (optional) → Quotation → Invoice
Optional    Proposal (optional) → Quotation → Agreement → Invoice
```

- **Quotation → Invoice is the default path.** No proposal and no agreement is
  required. A quotation can be created directly, or from an accepted proposal
  (`/sales/quotations/builder?fromProposalId=…`).
- **Agreement is the optional middle step.** On an accepted quotation,
  `Create Agreement` produces a draft contract first; the invoice can still be
  created from the same quotation afterwards.
- **Proposal is optional.** `POST /api/v1/crm/quotations` accepts an optional
  `contactId`/`opportunityId`; nothing about invoicing depends on a proposal.

## Actions on an accepted quotation

| Action           | Endpoint                                     | Permission(s)                        | Result                                             |
| ---------------- | -------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Create Invoice   | `POST /api/v1/crm/quotations/[id]/invoice`   | `invoice.create` + `quotation.read`  | Draft invoice, fully prefilled from the quotation  |
| Create Agreement | `POST /api/v1/crm/quotations/[id]/agreement` | `contract.create` + `quotation.read` | Draft contract (agreement) linked to the quotation |

Both endpoints:

- resolve the caller's organization from the session, never from the request;
- read the source quotation with `id + organizationId` and `deletedAt = null`,
  so another tenant's id answers the same non-disclosing `404` as a missing id;
- reject quotations whose status is not `accepted` with `400`;
- are only offered in the UI when the server-resolved permission set contains
  the capability (the service re-checks it anyway).

The request body may be empty, or carry only fields the target document owns
(`title`, `dueDate`, `notes` for an invoice; `title` for an agreement). Source
data is **never** accepted from the client.

## What is copied

| Invoice field          | Source                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| client                 | quotation `contactId`                                              |
| line items             | quotation line items (description, quantity, unit price, tax rate) |
| subtotal / tax / total | recalculated server-side from those lines                          |
| currency               | quotation currency                                                 |
| notes                  | quotation notes (unless overridden)                                |
| title                  | `Invoice for Quotation <number>` (unless overridden)               |
| `quotationId`          | the source quotation                                               |

An agreement has a title and references only. Its title defaults to
`<quotation title> Agreement` and `quotationId` preserves the source link.
Creating an agreement twice for the same quotation is idempotent while a
non-voided agreement exists; a voided agreement can be re-issued.

### Concurrency: one active agreement per quotation

Two simultaneous `Create Agreement` requests for the same accepted quotation
must both return the **same** agreement, never create two. This is guaranteed
twice over:

1. **Row lock (application level).** Agreement creation runs in a transaction
   that takes `SELECT … FROM "Quotation" WHERE id = $1 AND "organizationId" = $2
FOR UPDATE` before looking for an existing agreement. Concurrent requests
   serialize on that row; the second one re-reads after the first commits and
   returns its agreement. The audit entry is written only by the request that
   actually inserted the row.
2. **Partial unique index (database level).** Migration
   `0023_enforce_single_active_agreement` adds
   `Contract_quotationId_active_key`:
   `UNIQUE ("quotationId") WHERE "quotationId" IS NOT NULL AND "status" <> 'voided'`.
   Exactly one non-voided agreement per quotation can exist, whoever writes it.
   A racing writer that bypasses the lock gets a unique violation (Prisma
   `P2002`), which the service resolves to the winning agreement.

Voided agreements are excluded from the index on purpose: the historical row is
kept for audit, and a replacement can be created afterwards (also subject to the
same two guarantees).

The migration runs a pre-flight guard first: if a database already holds
duplicate active agreements from before this change, the migration stops with
the offending quotation ids and changes no data — choosing which one to void is
a business decision.

A quotation may produce several invoices (for example per milestone), each with
its own allocated `PREFIX-YYYY-NNNN` number.

## Data model

Migration `0022_add_quotation_source_links` adds nullable `quotationId` columns
to `Invoice` and `Contract` and composite foreign keys
`(quotationId, organizationId) → Quotation(id, organizationId)` with
`ON DELETE NO ACTION`. The composite key makes a cross-organization link
impossible at the database level, and `NO ACTION` means a quotation that
produced financial or legal documents cannot be hard-deleted; quotations are
retired by soft delete, which leaves provenance intact.

Migration `0023_enforce_single_active_agreement` adds the partial unique index
that enforces one active agreement per quotation (see above).

Both migrations are additive: existing invoices and contracts keep every field
and start with `quotationId = NULL`. No table is dropped and no data is deleted.

## Retirement of estimates (completed)

Estimates are no longer part of the sales workflow at all: they are **historical
records**, preserved and readable, but immutable.

### Removed from the UI

- no `Create Estimate` action on accepted quotations, contacts or opportunities;
- no Estimates item in the sidebar / navigation model;
- no `/finance/estimates/new` page;
- no `/finance/estimates/[id]/edit` page (deleted);
- no `/finance/estimates/[id]/convert` page (deleted);
- no status/delete action bar on the estimate record (deleted);
- the list has no `Edit` link and the record shows a read-only notice.

### Refused server-side

Every mutation answers `403` with
`{ error, code: "estimate_read_only", action }` from
`lib/sales/estimate-retirement.ts`. The refusal is unconditional — no body
parsing, no service call, no database read — so it cannot leak which ids exist
and cannot be bypassed by a caller that skips authorization.

| Action               | Endpoint / surface                                                              | Answer                              |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| create               | `POST /api/v1/finance/estimates`                                                | 403 `action: "create"`              |
| edit / send / status | `PUT`/`PATCH /api/v1/finance/estimates/[id]`                                    | 403 `action: "edit"`                |
| duplicate            | `POST /api/v1/finance/estimates` (was a create)                                 | 403 `action: "create"`              |
| delete               | `DELETE /api/v1/finance/estimates/[id]`                                         | 403 `action: "delete"`              |
| convert to invoice   | `POST /api/v1/finance/estimates/[id]/convert`                                   | 403 `action: "convert"`             |
| automation status    | `POST /api/v1/automation/events` with `set_status` and `recordType: "Estimate"` | action reported `skipped`, no write |

`duplicate` and `send` never had dedicated endpoints (duplication was a
prefilled create, "send" was the `draft → sent` transition); both are now
impossible because the underlying create and update paths are refused.
`RETIRED_ESTIMATE_ACTIONS` in the retirement module lists the full surface.

Internal services (`lib/services/crm/estimate-service.ts`) no longer contain any
write. The exported mutation symbols remain only as fail-closed stubs that throw
the same coded 403, so an in-process caller cannot mutate an estimate either.
The workflow executor's `set_status` allow-list no longer contains `Estimate`.

### Preserved

- full read access: `/finance/estimates`, `/finance/estimates/[id]`,
  `GET /api/v1/finance/estimates[/:id]` (gated by `estimate.read`);
- PDF rendering and download: `GET /api/v1/finance/estimates/[id]/pdf`;
- public share links and document snapshots (`entityType: "estimate"`) keep
  resolving, including already-issued links;
- financial reports keep their historical estimate totals;
- all estimate rows, tables and permissions (`estimate.read` is the only one
  enforced now; the write codes are left provisioned so existing roles and audit
  history keep resolving);
- tenant scoping: every read resolves `id + organizationId` and answers a
  non-disclosing 404 for another tenant's record.

No migration is required: nothing is dropped and no row is rewritten.

## Tests

- `lib/__tests__/crm/quotation-to-invoice-workflow.test.ts` — unit coverage of
  the two services (source copying, totals, links, permissions, 404/400 paths,
  agreement idempotency).
- `lib/__tests__/integration/sales.quotation-to-invoice.integration.test.ts` —
  real PostgreSQL + HTTP coverage of quotation creation without a proposal,
  both invoice paths, correct source data, permissions and organization scoping,
  plus two simultaneous agreement requests (same id, exactly one active
  agreement) and a replacement after voiding.
- `tests/e2e/sales-documents-workflow.spec.ts` — replaces the old
  Quotation → Estimate expectation with the two approved invoice paths.
- `lib/__tests__/infrastructure/navigation.test.ts` — asserts the estimate
  navigation and creation route stay retired while records remain readable.
- `lib/__tests__/sales/estimate-read-only.test.ts` — unit coverage of the
  retirement contract: every retired mutation (create, edit, duplicate, send,
  status change, delete, convert) is refused by the service with `403` and
  `code: "estimate_read_only"` without touching the database, the pure
  vocabulary matches, and historical reads keep their `id + organizationId`
  scoping.
- `lib/__tests__/api/estimate-mutation-routes.test.ts` — HTTP contract of the
  retired routes (`POST` collection, `PUT`/`PATCH`/`DELETE` detail, `POST`
  convert): `403` with the coded body and **no** service call, while `GET`
  still returns historical records and the PDF route still renders.
- `lib/__tests__/integration/sales.estimate-read-only.integration.test.ts` — a
  real estimate row survives every refused mutation byte-for-byte, stays
  listable/readable/PDF-downloadable and cross-tenant scoped, while both
  quotation → invoice flows keep working.
