/**
 * Canonical invoice statuses accepted by the current application.
 *
 * Historical rows are not migrated by this module: readers continue to return
 * their stored status, while all new API/service writes are validated here.
 */
export const INVOICE_STATUS_VALUES = ['draft', 'sent', 'paid', 'overdue', 'voided'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number];

/** Initial states available when creating an invoice. */
export const INVOICE_INITIAL_STATUSES = ['draft', 'sent'] as const;

/** States that may be edited through the ordinary invoice update operation. */
export const INVOICE_EDITABLE_STATUSES = ['draft', 'sent'] as const;

/**
 * Status targets accepted from the ordinary update endpoint. `paid` and
 * `overdue` are system-managed states: only payment recording may mark an
 * invoice paid, and overdue must come from a trusted aging process.
 */
export const INVOICE_MANUAL_UPDATE_STATUSES = ['draft', 'sent', 'voided'] as const;

/**
 * Manual transitions mirrored by the edit screen and enforced by the service.
 * Payment recording is the only path that may transition an invoice to `paid`.
 */
export const INVOICE_STATUS_TRANSITIONS: Partial<
  Record<InvoiceStatus, readonly (typeof INVOICE_MANUAL_UPDATE_STATUSES)[number][]>
> = {
  draft: ['sent', 'voided'],
  sent: ['voided'],
};
