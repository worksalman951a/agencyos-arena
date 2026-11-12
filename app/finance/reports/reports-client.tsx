'use client';

import * as React from 'react';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoFinancialReportsView } from '@/components/finance/bento-financial-reports-view';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import type { CurrencyTotals, DashboardMetrics } from '@/lib/services/dashboard/dashboard-service';

interface FinancialReportsClientProps {
  metrics: DashboardMetrics;
  statuses: Array<{ status: string; currency: string; count: number; totalMinor: number }>;
  estimates: Array<{ status: string; total: string; currency: string }>;
  expenses: Array<{
    amount: string;
    billable: boolean;
    currency?: string;
    isHistoricalUnresolved?: boolean;
  }>;
}

export function FinancialReportsClient(props: FinancialReportsClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoFinancialReportsView {...props} />;
  }

  // Legacy Presentation
  const { metrics, statuses, estimates, expenses } = props;
  const currencyRows = [metrics.headline, ...metrics.otherCurrencies];
  const defaultCurrency = metrics.defaultCurrency;

  const money = (totals: CurrencyTotals, field: keyof CurrencyTotals) =>
    formatMinorUnitsAsCurrency(totals[field] as number, totals.currency);

  const estimateTotals = new Map<string, { total: number; accepted: number; count: number }>();
  for (const estimate of estimates) {
    const currency = estimate.currency || defaultCurrency;
    const bucket = estimateTotals.get(currency) ?? { total: 0, accepted: 0, count: 0 };
    const value = Number(estimate.total || 0);
    bucket.total += Number.isFinite(value) ? value : 0;
    bucket.count += 1;
    if (estimate.status === 'accepted') bucket.accepted += Number.isFinite(value) ? value : 0;
    estimateTotals.set(currency, bucket);
  }

  // Expenses: totals grouped per currency; unresolved currencies tracked distinctly
  const expensesByCurrency = new Map<string, { total: number; billable: number; count: number }>();
  let unresolvedCount = 0;
  let unresolvedTotal = 0;

  for (const exp of expenses) {
    if (exp.isHistoricalUnresolved) {
      unresolvedCount += 1;
      unresolvedTotal += Number(exp.amount || 0);
      continue;
    }
    const expCurrency = exp.currency || defaultCurrency;
    const bucket = expensesByCurrency.get(expCurrency) ?? { total: 0, billable: 0, count: 0 };
    bucket.total += Number(exp.amount || 0);
    bucket.count += 1;
    if (exp.billable) bucket.billable += Number(exp.amount || 0);
    expensesByCurrency.set(expCurrency, bucket);
  }

  if (expensesByCurrency.size === 0 && unresolvedCount === 0) {
    expensesByCurrency.set(defaultCurrency, { total: 0, billable: 0, count: 0 });
  }

  const STATUS_ORDER = ['draft', 'sent', 'paid', 'overdue', 'voided'];
  const statusRows = STATUS_ORDER.flatMap((status) =>
    statuses
      .filter((bucket) => bucket.status === status)
      .map((bucket) => ({
        status,
        currency: bucket.currency,
        count: bucket.count,
        total: formatMinorUnitsAsCurrency(bucket.totalMinor, bucket.currency),
      }))
  );

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Invoicing and collections by currency</h2>
        {currencyRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <th className="pb-3 font-medium">Currency</th>
                  <th className="pb-3 font-medium text-right">Invoiced</th>
                  <th className="pb-3 font-medium text-right">Collected</th>
                  <th className="pb-3 font-medium text-right">Outstanding</th>
                  <th className="pb-3 font-medium text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {currencyRows.map((totals) => (
                  <tr key={totals.currency} className="border-b border-border">
                    <td className="py-3 font-medium">{totals.currency}</td>
                    <td className="py-3 text-right">{money(totals, 'invoicedMinor')}</td>
                    <td className="py-3 text-right text-green-600">
                      {money(totals, 'collectedMinor')}
                    </td>
                    <td className="py-3 text-right text-amber-600">
                      {money(totals, 'outstandingMinor')}
                    </td>
                    <td className="py-3 text-right text-red-600">
                      {money(totals, 'overdueMinor')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {metrics.invoiceCount} invoice{metrics.invoiceCount === 1 ? '' : 's'} in this workspace,{' '}
          {metrics.issuedInvoiceCount} issued.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Estimates</h2>
          {estimateTotals.size === 0 ? (
            <p className="text-sm text-muted-foreground">No estimates recorded yet.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {[...estimateTotals.entries()].map(([currency, bucket]) => (
                <div key={currency} className="space-y-1">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{currency} — total estimated</dt>
                    <dd className="font-medium">
                      {formatMinorUnitsAsCurrency(Math.round(bucket.total * 100), currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{currency} — accepted</dt>
                    <dd className="font-medium text-green-600">
                      {formatMinorUnitsAsCurrency(Math.round(bucket.accepted * 100), currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Estimates</dt>
                    <dd className="font-medium">{bucket.count}</dd>
                  </div>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Expenses by Currency</h2>
          <div className="space-y-4">
            {[...expensesByCurrency.entries()].map(([curr, bucket]) => (
              <dl key={curr} className="space-y-1 text-sm border-b pb-2 last:border-b-0">
                <div className="font-semibold text-xs text-muted-foreground uppercase">{curr}</div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Total expenses</dt>
                  <dd className="font-medium">
                    {formatMinorUnitsAsCurrency(Math.round(bucket.total * 100), curr)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Billable expenses</dt>
                  <dd className="font-medium text-emerald-600">
                    {formatMinorUnitsAsCurrency(Math.round(bucket.billable * 100), curr)}
                  </dd>
                </div>
              </dl>
            ))}
            {unresolvedCount > 0 && (
              <div className="rounded border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-semibold">
                  Unresolved Historical Expenses ({unresolvedCount})
                </div>
                <div>Amount pending reconciliation: {unresolvedTotal.toFixed(2)}</div>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Expenses display their permanently persisted transaction currency.
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Invoice status breakdown</h2>
        {statusRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Currency</th>
                  <th className="pb-3 font-medium text-right">Count</th>
                  <th className="pb-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map((row) => (
                  <tr key={`${row.status}-${row.currency}`} className="border-b border-border">
                    <td className="py-3 font-medium capitalize">{row.status}</td>
                    <td className="py-3">{row.currency}</td>
                    <td className="py-3 text-right text-sm">{row.count}</td>
                    <td className="py-3 text-right text-sm">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
