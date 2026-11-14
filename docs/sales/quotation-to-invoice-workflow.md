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

The migration is additive: existing invoices and contracts keep every field and
start with `quotationId = NULL`. No table is dropped and no data is deleted.

## Retirement of estimates

Estimates are no longer part of the active sales workflow:

- no `Create Estimate` action on accepted quotations;
- no Estimates item in the sidebar / navigation model;
- no `/finance/estimates/new` page and no links to it (contact, opportunity and
  estimate-list entry points were removed).

Existing estimate records keep full read access (`/finance/estimates`,
`/finance/estimates/[id]`, PDF/share endpoints) and can still be converted to an
invoice through the legacy conversion route. No estimate table, row or
permission is dropped. The legacy `POST /api/v1/finance/estimates` endpoint is
retained only so existing integrations and records stay usable; it is not an
entry point of the approved workflow.

## Tests

- `lib/__tests__/crm/quotation-to-invoice-workflow.test.ts` — unit coverage of
  the two services (source copying, totals, links, permissions, 404/400 paths,
  agreement idempotency).
- `lib/__tests__/integration/sales.quotation-to-invoice.integration.test.ts` —
  real PostgreSQL + HTTP coverage of quotation creation without a proposal,
  both invoice paths, correct source data, permissions and organization scoping.
- `tests/e2e/sales-documents-workflow.spec.ts` — replaces the old
  Quotation → Estimate expectation with the two approved invoice paths.
- `lib/__tests__/infrastructure/navigation.test.ts` — asserts the estimate
  navigation and creation route stay retired while records remain readable.
