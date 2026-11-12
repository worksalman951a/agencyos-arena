'use client';

import * as React from 'react';
import Link from 'next/link';
import { Panel, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import type { CurrencyTotals, DashboardMetrics } from '@/lib/services/dashboard/dashboard-service';
import '@/components/crm/bento-contacts.css';

interface BentoFinancialReportsViewProps {
  metrics: DashboardMetrics;
  statuses: Array<{ status: string; currency: string; count: number; totalMinor: number }>;
  estimates: Array<{ status: string; total: string; currency: string }>;
  expenses: Array<{ amount: string; billable: boolean }>;
}

export function BentoFinancialReportsView({
  metrics,
  statuses,
  estimates,
  expenses,
}: BentoFinancialReportsViewProps) {
  const currencyRows = [metrics.headline, ...metrics.otherCurrencies];
  const defaultCurrency = metrics.defaultCurrency;

  const money = (totals: CurrencyTotals, field: keyof CurrencyTotals) =>
    formatMinorUnitsAsCurrency(totals[field] as number, totals.currency);

  // Estimates: totals per currency, never combined.
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

  // Expenses recorded in default workspace currency
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const billableExpenses = expenses
    .filter((e) => e.billable)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const internalExpenses = Math.max(0, totalExpenses - billableExpenses);

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

  const headlineInvoiced = money(metrics.headline, 'invoicedMinor');
  const headlineCollected = money(metrics.headline, 'collectedMinor');
  const headlineOutstanding = money(metrics.headline, 'outstandingMinor');
  const headlineOverdue = money(metrics.headline, 'overdueMinor');

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (status.toLowerCase()) {
      case 'paid':
        return 'ok';
      case 'sent':
        return 'warn';
      case 'overdue':
        return 'danger';
      default:
        return undefined;
    }
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Finance</span>
            <span>/</span>
            <span>Financial Intelligence</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Financial Reports
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organization-scoped revenue reconciliation, estimate conversion pipeline, and
            expenditure
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/invoices">Invoices Register</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/expenses">Expenses Register</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Executive Summary (Headline Currency) ───────────── */}
      <StatStrip
        stats={[
          {
            label: `Billed Volume (${metrics.headline.currency})`,
            value: headlineInvoiced,
            note: `${metrics.issuedInvoiceCount} issued invoices`,
          },
          {
            label: `Collected Revenue (${metrics.headline.currency})`,
            value: headlineCollected,
            note: 'realized payment receipts',
            tone: 'ok',
          },
          {
            label: `Outstanding Debt (${metrics.headline.currency})`,
            value: headlineOutstanding,
            note: 'awaiting payment settlement',
            tone: metrics.headline.outstandingMinor > 0 ? 'warn' : undefined,
          },
          {
            label: `Overdue Arrears (${metrics.headline.currency})`,
            value: headlineOverdue,
            note: metrics.headline.overdueMinor > 0 ? 'requires collection' : 'no past-due debt',
            tone: metrics.headline.overdueMinor > 0 ? 'danger' : undefined,
          },
        ]}
      />

      {/* ── Currency Rollup Matrix ────────────────────────────────────── */}
      <Panel
        title="Multi-Currency Revenue Matrix"
        action={
          <span className="text-xs text-muted-foreground">
            {metrics.invoiceCount} total records &bull; {currencyRows.length} active currencies
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="py-2.5 px-3">Currency</th>
                <th className="py-2.5 px-3 text-right">Invoiced Total</th>
                <th className="py-2.5 px-3 text-right">Collected Revenue</th>
                <th className="py-2.5 px-3 text-right">Outstanding Balance</th>
                <th className="py-2.5 px-3 text-right">Overdue Past Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {currencyRows.map((totals) => (
                <tr key={totals.currency} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 px-3 font-semibold text-foreground font-mono">
                    {totals.currency}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-medium">
                    {money(totals, 'invoicedMinor')}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-700">
                    {money(totals, 'collectedMinor')}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-semibold text-amber-700">
                    {money(totals, 'outstandingMinor')}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-semibold text-rose-700">
                    {money(totals, 'overdueMinor')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── 2-Column Split: Estimate Pipeline vs Expense Allocation ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Estimates Pipeline */}
        <Panel title="Commercial Estimates Pipeline">
          {estimateTotals.size === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No estimates recorded in this workspace.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {[...estimateTotals.entries()].map(([currency, bucket]) => {
                const convRate =
                  bucket.total > 0 ? Math.round((bucket.accepted / bucket.total) * 100) : 0;
                return (
                  <div key={currency} className="p-4 rounded-lg border bg-muted/10 space-y-3">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="font-semibold text-foreground font-mono">{currency}</span>
                      <StatusPill tone="ok">{convRate}% Accepted</StatusPill>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[11px] text-muted-foreground block">
                          Total Quoted
                        </span>
                        <span className="font-mono font-medium text-foreground">
                          {formatMinorUnitsAsCurrency(Math.round(bucket.total * 100), currency)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-muted-foreground block">
                          Accepted Volume
                        </span>
                        <span className="font-mono font-semibold text-emerald-700">
                          {formatMinorUnitsAsCurrency(Math.round(bucket.accepted * 100), currency)}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {bucket.count} estimates registered
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Expense Allocation */}
        <Panel title="Expense Allocation & Operating Costs">
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-lg border bg-muted/10 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-semibold text-foreground">
                  Workspace Currency ({defaultCurrency})
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {expenses.length} expense items
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] text-muted-foreground block">Gross Expenses</span>
                  <span className="font-mono font-medium text-foreground">
                    {formatMinorUnitsAsCurrency(Math.round(totalExpenses * 100), defaultCurrency)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    Client Billable Charges
                  </span>
                  <span className="font-mono font-semibold text-emerald-700">
                    {formatMinorUnitsAsCurrency(
                      Math.round(billableExpenses * 100),
                      defaultCurrency
                    )}
                  </span>
                </div>
              </div>
              <div className="border-t pt-2 flex justify-between text-[11px]">
                <span className="text-muted-foreground">Internal Operating Overhead:</span>
                <span className="font-mono font-medium text-foreground">
                  {formatMinorUnitsAsCurrency(Math.round(internalExpenses * 100), defaultCurrency)}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Expenses are recorded in {defaultCurrency}. Billable amounts indicate expenses marked
              eligible for client pass-through charging.
            </p>
          </div>
        </Panel>
      </div>

      {/* ── Status Breakdown Table ────────────────────────────────────── */}
      <Panel title="Invoice Document Status Breakdown">
        {statusRows.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No invoices recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Currency</th>
                  <th className="py-2.5 px-3 text-right">Invoices</th>
                  <th className="py-2.5 px-3 text-right">Aggregate Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {statusRows.map((row) => (
                  <tr
                    key={`${row.status}-${row.currency}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <StatusPill tone={getStatusTone(row.status)}>{row.status}</StatusPill>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium">{row.currency}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{row.count}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-foreground">
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
