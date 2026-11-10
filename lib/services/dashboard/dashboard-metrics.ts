/**
 * Dashboard metric assembly (pure — no database imports, unit tested).
 *
 * Definitions (deliberately distinct):
 *
 *  • Total Invoiced            invoices that have been issued (sent / paid /
 *                              overdue). Drafts are not invoiced; voided
 *                              invoices and soft-deleted rows never count.
 *  • Total Collected           payments actually recorded against issued
 *                              invoices (`Payment.paidAt` is required by the
 *                              schema, so every row is collected money).
 *  • Outstanding Receivables   per invoice: max(total − payments, 0), summed
 *                              over issued invoices.
 *  • Overdue Amount            the same outstanding amount, limited to issued
 *                              invoices whose due date has passed.
 *
 * Money rules: sums are exact integer minor units (NUMERIC cast to text in SQL,
 * parsed digit by digit), never floating point, and never combined across
 * currencies — there is no exchange-rate conversion anywhere.
 */

import { parseAmountToMinorUnits, normalizeCurrencyCode, DEFAULT_CURRENCY } from '@/lib/currencies';

export type Permissioned<T> = { ok: true; data: T } | { ok: false; reason: 'forbidden' };

export interface CurrencyTotals {
  currency: string;
  invoicedMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
}

export interface DashboardMetrics {
  defaultCurrency: string;
  /** Totals for the organization's default currency (zeroed when unused). */
  headline: CurrencyTotals;
  /** Totals for every other currency that has any activity. */
  otherCurrencies: CurrencyTotals[];
  /** Invoices in any status (non-deleted) — distinguishes "no invoices" from "none issued". */
  invoiceCount: number;
  /** Invoices that have been issued (sent / paid / overdue). */
  issuedInvoiceCount: number;
}

/**
 * Single aggregate query over invoices and their payments, grouped by invoice
 * currency. `::text` keeps NUMERIC → JS conversion exact.
 */
export const DASHBOARD_TOTALS_SQL = `
SELECT
  i."currency" AS currency,
  COALESCE(SUM(CASE WHEN i."status" IN ('sent', 'paid', 'overdue') THEN i."total" ELSE 0 END), 0)::text
    AS invoiced,
  COALESCE(SUM(CASE WHEN i."status" IN ('sent', 'paid', 'overdue') THEN COALESCE(p.paid, 0) ELSE 0 END), 0)::text
    AS collected,
  COALESCE(SUM(CASE WHEN i."status" IN ('sent', 'paid', 'overdue')
                    THEN GREATEST(i."total" - COALESCE(p.paid, 0), 0) ELSE 0 END), 0)::text
    AS outstanding,
  COALESCE(SUM(CASE WHEN i."status" IN ('sent', 'overdue')
                     AND i."dueDate" IS NOT NULL
                     AND i."dueDate" < now()
                    THEN GREATEST(i."total" - COALESCE(p.paid, 0), 0) ELSE 0 END), 0)::text
    AS overdue
FROM "Invoice" i
LEFT JOIN (
  SELECT "invoiceId", SUM("amount") AS paid
    FROM "Payment"
   GROUP BY "invoiceId"
) p ON p."invoiceId" = i."id"
WHERE i."organizationId" = $1
  AND i."deletedAt" IS NULL
GROUP BY i."currency"
ORDER BY i."currency"
`;

export interface RawCurrencyTotals {
  currency: string;
  invoiced: string;
  collected: string;
  outstanding: string;
  overdue: string;
}

/** Convert a raw SQL row into exact minor units. Pure — used by unit tests. */
export function mapRawCurrencyTotals(row: RawCurrencyTotals): CurrencyTotals {
  return {
    currency: normalizeCurrencyCode(row.currency) ?? row.currency,
    invoicedMinor: parseAmountToMinorUnits(row.invoiced),
    collectedMinor: parseAmountToMinorUnits(row.collected),
    outstandingMinor: parseAmountToMinorUnits(row.outstanding),
    overdueMinor: parseAmountToMinorUnits(row.overdue),
  };
}

export const EMPTY_CURRENCY_TOTALS = (currency: string): CurrencyTotals => ({
  currency,
  invoicedMinor: 0,
  collectedMinor: 0,
  outstandingMinor: 0,
  overdueMinor: 0,
});

/**
 * Split per-currency totals into the default-currency headline and the rest.
 * Pure — used by unit tests.
 */
export function buildDashboardMetrics(
  rows: readonly RawCurrencyTotals[],
  context: { defaultCurrency: string; invoiceCount: number; issuedInvoiceCount: number }
): DashboardMetrics {
  const totals = rows.map(mapRawCurrencyTotals);
  const defaultCurrency = normalizeCurrencyCode(context.defaultCurrency) ?? DEFAULT_CURRENCY;

  const headline = totals.find((entry) => entry.currency === defaultCurrency);
  const otherCurrencies = totals.filter(
    (entry) =>
      entry.currency !== defaultCurrency &&
      (entry.invoicedMinor !== 0 ||
        entry.collectedMinor !== 0 ||
        entry.outstandingMinor !== 0 ||
        entry.overdueMinor !== 0)
  );

  return {
    defaultCurrency,
    headline: headline ?? EMPTY_CURRENCY_TOTALS(defaultCurrency),
    otherCurrencies,
    invoiceCount: context.invoiceCount,
    issuedInvoiceCount: context.issuedInvoiceCount,
  };
}
