/**
 * Dashboard metric assembly.
 *
 * Revenue is the sum of recorded payments, per currency, with no conversion.
 * `buildDashboardMetrics` is the pure half of the dashboard service (the SQL
 * aggregate is exercised by the integration suite), so these tests pin the rules
 * that matter for correctness:
 *
 *  • the org default currency is the headline, other currencies are separate,
 *  • currencies are never added together,
 *  • partial payments are already aggregated per invoice in SQL,
 *  • voided/draft invoices are excluded by the SQL, not by display code.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_CURRENCY_TOTALS,
  DASHBOARD_TOTALS_SQL,
  buildDashboardMetrics,
  mapRawCurrencyTotals,
  type RawCurrencyTotals,
} from '@/lib/services/dashboard/dashboard-metrics';

const row = (
  currency: string,
  invoiced: string,
  collected: string,
  outstanding: string,
  overdue: string
): RawCurrencyTotals => ({ currency, invoiced, collected, outstanding, overdue });

describe('mapRawCurrencyTotals', () => {
  it('converts NUMERIC text into exact minor units', () => {
    expect(mapRawCurrencyTotals(row('usd', '1234.50', '1000.00', '234.50', '12.25'))).toEqual({
      currency: 'USD',
      invoicedMinor: 123450,
      collectedMinor: 100000,
      outstandingMinor: 23450,
      overdueMinor: 1225,
    });
  });

  it('tolerates the driver returning numbers', () => {
    const mapped = mapRawCurrencyTotals({
      currency: 'PKR',
      invoiced: 1000 as unknown as string,
      collected: 0 as unknown as string,
      outstanding: 1000 as unknown as string,
      overdue: 0 as unknown as string,
    });
    expect(mapped.invoicedMinor).toBe(100000);
    expect(mapped.collectedMinor).toBe(0);
  });
});

describe('buildDashboardMetrics', () => {
  const context = { defaultCurrency: 'USD', invoiceCount: 4, issuedInvoiceCount: 3 };

  it('uses the default currency as the headline and lists others separately', () => {
    const metrics = buildDashboardMetrics(
      [
        row('USD', '1000.00', '400.00', '600.00', '100.00'),
        row('PKR', '250000.00', '50000.00', '200000.00', '0.00'),
      ],
      context
    );

    expect(metrics.defaultCurrency).toBe('USD');
    expect(metrics.headline).toEqual({
      currency: 'USD',
      invoicedMinor: 100000,
      collectedMinor: 40000,
      outstandingMinor: 60000,
      overdueMinor: 10000,
    });
    expect(metrics.otherCurrencies).toHaveLength(1);
    expect(metrics.otherCurrencies[0].currency).toBe('PKR');
    expect(metrics.otherCurrencies[0].collectedMinor).toBe(5000000);

    // Crucially: no conversion — the headline is USD only.
    expect(metrics.headline.invoicedMinor).not.toBe(100000 + 250000 * 0.0036);
  });

  it('zeroes the headline when the default currency has no activity', () => {
    const metrics = buildDashboardMetrics([row('EUR', '500.00', '250.00', '250.00', '0.00')], {
      defaultCurrency: 'USD',
      invoiceCount: 1,
      issuedInvoiceCount: 1,
    });

    expect(metrics.headline).toEqual(EMPTY_CURRENCY_TOTALS('USD'));
    expect(metrics.otherCurrencies.map((entry) => entry.currency)).toEqual(['EUR']);
  });

  it('drops currencies with no activity at all', () => {
    const metrics = buildDashboardMetrics(
      [row('USD', '0.00', '0.00', '0.00', '0.00'), row('GBP', '0.00', '0.00', '0.00', '0.00')],
      context
    );
    expect(metrics.headline.collectedMinor).toBe(0);
    expect(metrics.otherCurrencies).toEqual([]);
  });

  it('handles partial payments and multiple payments per invoice (already summed in SQL)', () => {
    // invoice 1: total 1000, two payments 300 + 200 → collected 500, outstanding 500
    // invoice 2: total  500, one payment 500       → collected 500, outstanding   0
    const metrics = buildDashboardMetrics([row('USD', '1500.00', '1000.00', '500.00', '500.00')], {
      defaultCurrency: 'USD',
      invoiceCount: 2,
      issuedInvoiceCount: 2,
    });

    expect(metrics.headline.collectedMinor).toBe(100000);
    expect(metrics.headline.outstandingMinor).toBe(50000);
    expect(metrics.headline.overdueMinor).toBe(50000);
    expect(metrics.headline.invoicedMinor).toBe(150000);
  });

  it('falls back to the default currency when the org setting is unusable', () => {
    const metrics = buildDashboardMetrics([row('USD', '10.00', '0.00', '10.00', '0.00')], {
      ...context,
      defaultCurrency: 'not-a-currency',
    });
    expect(metrics.defaultCurrency).toBe('USD');
    expect(metrics.headline.invoicedMinor).toBe(1000);
  });

  it('reports invoice counts so "no invoices yet" is only shown when true', () => {
    const metrics = buildDashboardMetrics([], {
      ...context,
      invoiceCount: 0,
      issuedInvoiceCount: 0,
    });
    expect(metrics.invoiceCount).toBe(0);
    expect(metrics.issuedInvoiceCount).toBe(0);
    expect(metrics.headline.collectedMinor).toBe(0);
  });
});

describe('DASHBOARD_TOTALS_SQL', () => {
  it('is organization scoped and excludes deleted/voided/draft invoices', () => {
    expect(DASHBOARD_TOTALS_SQL).toContain('i."organizationId" = $1');
    expect(DASHBOARD_TOTALS_SQL).toContain('i."deletedAt" IS NULL');
    expect(DASHBOARD_TOTALS_SQL).toContain("('sent', 'paid', 'overdue')");
    expect(DASHBOARD_TOTALS_SQL).not.toMatch(/'voided'.*THEN i\."total"/);

    // Payments are aggregated per invoice first, so an invoice with several
    // payments cannot multiply its own total.
    expect(DASHBOARD_TOTALS_SQL).toContain('GROUP BY "invoiceId"');
    expect(DASHBOARD_TOTALS_SQL).toContain('GROUP BY i."currency"');

    // Exact money: NUMERIC sums are cast to text, never to float.
    expect(DASHBOARD_TOTALS_SQL).toContain('::text');
    expect(DASHBOARD_TOTALS_SQL).not.toContain('::float');
  });
});
