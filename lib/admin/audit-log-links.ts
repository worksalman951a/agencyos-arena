/**
 * Audit-log pagination links.
 *
 * The audit-log page is a Server Component and the views are Client
 * Components, so the page cannot hand a `hrefBuilder` closure across that
 * boundary - React refuses to serialise functions and the whole page fails
 * with "Functions cannot be passed directly to Client Components".
 *
 * The active filters are plain strings that serialise fine, so the views
 * rebuild the links themselves from those props. Pagination therefore keeps
 * the active action and entity-type filters, and page 1 stays the bare URL.
 *
 * This module is deliberately dependency-free and pure so it can run on the
 * server, in the browser and in unit tests unchanged.
 */

export interface AuditLogFilterParams {
  /** Active action filter, e.g. `notification.` (matched with `startsWith`). */
  action?: string;
  /** Active entity-type filter. */
  entityType?: string;
}

/**
 * Build the list URL for `page`, carrying the active filters.
 *
 * Page 1 omits `page` so the canonical unfiltered first page stays
 * `/admin/audit-logs`, and every other page keeps whatever filters are
 * currently applied.
 */
export function buildAuditLogPageHref(page: number, filters: AuditLogFilterParams = {}): string {
  const query = new URLSearchParams();

  if (filters.action) query.set('action', filters.action);
  if (filters.entityType) query.set('entityType', filters.entityType);
  if (Number.isFinite(page) && page > 1) query.set('page', String(page));

  const queryString = query.toString();
  return queryString ? `/admin/audit-logs?${queryString}` : '/admin/audit-logs';
}
