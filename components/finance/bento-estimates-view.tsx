'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Eye, Sparkles } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { sumDecimalAmounts, formatDecimalMoney } from '@/lib/finance/decimal-utils';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';
import '@/components/crm/bento-contacts.css';

interface BentoEstimatesViewProps {
  estimates: EstimateResponse[];
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

export function BentoEstimatesView({ estimates }: BentoEstimatesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchVal, setSearchVal] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');

  const filteredEstimates = React.useMemo(() => {
    return estimates.filter((e) => {
      if (statusFilter !== 'all' && e.status.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }
      if (!searchVal.trim()) return true;
      const q = searchVal.trim().toLowerCase();
      const clientName = e.client
        ? `${e.client.firstName ?? ''} ${e.client.lastName ?? ''}`.trim()
        : '';
      return (
        e.number.toLowerCase().includes(q) ||
        clientName.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q))
      );
    });
  }, [estimates, searchVal, statusFilter]);

  const activeEst =
    filteredEstimates[Math.min(selectedIdx, Math.max(0, filteredEstimates.length - 1))] ?? null;

  const draftCount = estimates.filter((e) => e.status === 'draft').length;
  const sentCount = estimates.filter((e) => e.status === 'sent').length;
  const acceptedCount = estimates.filter((e) => e.status === 'accepted').length;

  // Currency breakdown — check for mixed currencies before single-currency aggregation
  const currencies = Array.from(new Set(estimates.map((e) => e.currency).filter(Boolean)));
  const hasMixedCurrencies = currencies.length > 1;
  const primaryCurrency = currencies[0] ?? 'USD';

  const totalRegisterStr = sumDecimalAmounts(estimates.map((e) => e.total));
  const acceptedRegisterStr = sumDecimalAmounts(
    estimates.filter((e) => e.status === 'accepted').map((e) => e.total)
  );

  const formattedTotal = hasMixedCurrencies
    ? `${currencies.length} currencies`
    : `${primaryCurrency} ${formatDecimalMoney(totalRegisterStr)}`;

  const formattedAccepted = hasMixedCurrencies
    ? `${currencies.length} currencies`
    : `${primaryCurrency} ${formatDecimalMoney(acceptedRegisterStr)}`;

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | 'idle' | 'neutral' => {
    switch (status.toLowerCase()) {
      case 'accepted':
        return 'ok';
      case 'sent':
        return 'warn';
      case 'rejected':
      case 'expired':
        return 'idle';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Finance</span>
            <span>/</span>
            <span>Commercial Estimates</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Estimates</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {estimates.length} {estimates.length === 1 ? 'estimate' : 'estimates'} registered for
            preliminary pricing and quotes
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/invoices">Invoices</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/finance/estimates/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Estimate
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Pipeline',
            value: formattedTotal,
            note: `${estimates.length} quotes prepared`,
          },
          {
            label: 'Awaiting Acceptance',
            value: String(sentCount),
            note: 'pending client review',
            tone: sentCount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Accepted Volume',
            value: formattedAccepted,
            note: `${acceptedCount} quotes converted or accepted`,
            tone: acceptedCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Draft Stage',
            value: String(draftCount),
            note: 'unissued quotes',
          },
        ]}
      />

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <div className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            placeholder="Search estimates by number, client, or notes..."
            aria-label="Search estimates"
          />
          {searchVal && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSearchVal('')}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>

        <div className="bento-status-pills" role="tablist" aria-label="Filter estimates by status">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setStatusFilter(f.value);
                  setSelectedIdx(0);
                }}
                className={`bento-filter-pill ${isActive ? 'bento-filter-pill--active' : ''}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bento 3-Column Estimates Grid ─────────────────────────────── */}
      {filteredEstimates.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || statusFilter !== 'all'
                ? 'No estimates match those filters'
                : 'No estimates found'
            }
            sub="Create your first priced estimate for client review and conversion to invoice."
            action={{
              label: 'Create Estimate',
              onClick: () => {
                const link = document.createElement('a');
                link.href = '/finance/estimates/new';
                link.click();
              },
            }}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main Estimates Table (2 Cols) */}
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Estimates Register (${filteredEstimates.length})`}>
              <div className="bento-sales-table-head">
                <span>Number & Notes</span>
                <span>Client Contact</span>
                <span>Valid Until</span>
                <span className="text-right">Estimate Total</span>
                <span className="text-right">Status</span>
              </div>

              <div className="divide-y divide-border/60">
                {filteredEstimates.map((est, idx) => {
                  const isSelected = activeEst?.id === est.id;
                  const clientFullName = est.client
                    ? `${est.client.firstName ?? ''} ${est.client.lastName ?? ''}`.trim() ||
                      est.client.email ||
                      'Unnamed Contact'
                    : 'No client linked';

                  return (
                    <button
                      key={est.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/* Number & Notes */}
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          #{est.number}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {est.notes || `Created ${new Date(est.createdAt).toLocaleDateString()}`}
                        </div>
                      </div>

                      {/* Client */}
                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {clientFullName}
                      </div>

                      {/* Valid Until */}
                      <div className="text-xs text-muted-foreground truncate">
                        {est.validUntil ? new Date(est.validUntil).toLocaleDateString() : '—'}
                      </div>

                      {/* Total */}
                      <div className="text-xs font-semibold text-foreground text-right font-mono">
                        {est.currency} {formatDecimalMoney(est.total)}
                      </div>

                      {/* Status */}
                      <div className="text-right">
                        <StatusPill tone={getStatusTone(est.status)}>{est.status}</StatusPill>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* Quick Preview Rail (1 Col) */}
          <div className="min-w-0">
            {activeEst ? (
              <Panel
                title="Estimate Inspector"
                action={
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href={`/finance/estimates/${activeEst.id}`}>
                      Open Detail <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Estimate Reference
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      #{activeEst.number}
                    </h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Status"
                      value={
                        <StatusPill tone={getStatusTone(activeEst.status)}>
                          {activeEst.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Client Contact"
                      value={
                        activeEst.client ? (
                          <Link
                            href={`/crm/contacts/${activeEst.clientId}`}
                            className="text-accent hover:underline font-semibold"
                          >
                            {`${activeEst.client.firstName ?? ''} ${activeEst.client.lastName ?? ''}`.trim() ||
                              'Client'}
                          </Link>
                        ) : (
                          'No client linked'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Valid Until"
                      value={
                        activeEst.validUntil
                          ? new Date(activeEst.validUntil).toLocaleDateString()
                          : 'No expiry set'
                      }
                    />
                    <KeyValueRow
                      label="Total Value"
                      value={
                        <span className="font-bold text-foreground font-mono">
                          {activeEst.currency} {formatDecimalMoney(activeEst.total)}
                        </span>
                      }
                    />
                  </div>

                  <div className="border-t border-border pt-3">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/finance/estimates/${activeEst.id}`}>
                        Inspect Details & Convert
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel pad>
                <div className="text-center py-8 text-muted-foreground text-xs">
                  <Sparkles size={18} className="mx-auto mb-2 opacity-50" />
                  Select an estimate from the register to preview details.
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
