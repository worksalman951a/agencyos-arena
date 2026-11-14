/**
 * Estimate retirement contract (pure module — no database, no session).
 *
 * Estimates were replaced by the approved Quotation → Invoice workflow
 * (agreement optional). Historical estimate rows are kept forever, but they are
 * **read-only**: nothing in the product may create, edit, duplicate, send,
 * change the status of, delete, or convert an estimate into an invoice.
 *
 * This module is the single source of truth for that rule. It is deliberately
 * free of `server-only`/`'use server'` imports so that:
 *
 *  - service functions (`lib/services/crm/estimate-service.ts`) can throw the
 *    coded error,
 *  - route handlers can answer it without duplicating wording,
 *  - pure unit tests can assert the vocabulary without a running server.
 *
 * Every mutation action that the product used to expose is listed in
 * {@link RETIRED_ESTIMATE_ACTIONS}. `duplicate` and `send` never had dedicated
 * endpoints — duplication was a prefilled create and "send" was the
 * `draft → sent` status transition — but they are named explicitly so a future
 * reader does not re-introduce them, and so the API contract documents what is
 * refused.
 */

/** Stable machine-readable code returned with every refused mutation. */
export const ESTIMATE_READ_ONLY_CODE = 'estimate_read_only';

/**
 * Client-facing explanation. It names the replacement workflow, so an
 * integration hitting a retired endpoint learns what to call instead.
 */
export const ESTIMATE_READ_ONLY_MESSAGE =
  'Estimates are kept for history and are read-only. Create invoices from an accepted quotation instead.';

/** Every estimate mutation the product no longer supports. */
export const RETIRED_ESTIMATE_ACTIONS = [
  'create',
  'edit',
  'duplicate',
  'send',
  'status_change',
  'delete',
  'convert',
] as const;

export type RetiredEstimateAction = (typeof RETIRED_ESTIMATE_ACTIONS)[number];

/**
 * Error raised by any estimate write path.
 *
 * `statusCode` 403 is what `lib/api/route-error.ts` maps onto the HTTP response,
 * and `loadPageData` maps onto the "forbidden" page state, so a stale bookmark
 * to the removed edit/convert pages renders a notice instead of a crash. The
 * code/message are non-disclosing: they never mention a record id or tenant.
 */
export interface EstimateRetiredError extends Error {
  statusCode: number;
  code: typeof ESTIMATE_READ_ONLY_CODE;
  action: RetiredEstimateAction;
}

export function estimateRetiredError(action: RetiredEstimateAction): EstimateRetiredError {
  const error = new Error(ESTIMATE_READ_ONLY_MESSAGE) as Partial<EstimateRetiredError> &
    Error & { statusCode: number };
  error.statusCode = 403;
  error.code = ESTIMATE_READ_ONLY_CODE;
  error.action = action;
  return error as EstimateRetiredError;
}

/** Is this error a refused estimate mutation? */
export function isEstimateRetiredError(error: unknown): error is EstimateRetiredError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === ESTIMATE_READ_ONLY_CODE
  );
}

/** Response body for a refused mutation (routes reuse it verbatim). */
export function estimateRetiredBody(action: RetiredEstimateAction) {
  return {
    error: ESTIMATE_READ_ONLY_MESSAGE,
    code: ESTIMATE_READ_ONLY_CODE,
    action,
  };
}
