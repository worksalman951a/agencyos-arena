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
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';
import '@/components/crm/bento-contacts.css';

interface BentoInvoiceProjectOption {
  id: string;
  name: string;
  archived: boolean;
}

interface BentoInvoicesViewProps {
  invoices: InvoiceResponse[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  projectIdFilter?: string;
  projectOptions?: BentoInvoiceProjectOption[];
  sortBy: string;
  sortOrder: string;
  onSearchChange: (search: string) => void;
  onStatusFilterChange: (status: string) => void;
  onProjectFilterChange: (projectId: string) => void;
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'voided', label: 'Voided' },
];

export function BentoInvoicesView({
  invoices,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
  projectIdFilter = '',
  projectOptions = [],
  onSearchChange,
  onStatusFilterChange,
  onProjectFilterChange,
}: BentoInvoicesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activeInv = invoices[Math.min(selectedIdx, Math.max(0, invoices.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  // Status Counts
  const draftCount = invoices.filter((i) => i.status === 'draft').length;
  const paidCount = invoices.filter((i) => i.status === 'paid').length;
  const overdueCount = invoices.filter((i) => i.status === 'overdue').length;

  // Currency breakdown — check for mixed currencies before single-currency aggregation
  const currencies = Array.from(new Set(invoices.map((i) => i.currency).filter(Boolean)));
  const hasMixedCurrencies = currencies.length > 1;
  const primaryCurrency = currencies[0] ?? 'USD';

  // Outstanding sum (sent + overdue) and collected sum (paid)
  const outstandingInvoices = invoices.filter((i) => ['sent', 'overdue'].includes(i.status));
  const paidInvoices = invoices.filter((i) => i.status === 'paid');

  const totalOutstandingStr = sumDecimalAmounts(outstandingInvoices.map((i) => i.total));
  const totalPaidStr = sumDecimalAmounts(paidInvoices.map((i) => i.total));

  const formattedOutstanding = hasMixedCurrencies
    ? `${currencies.length} currencies`
    : `${primaryCurrency} ${formatDecimalMoney(totalOutstandingStr)}`;

  const formattedPaid = hasMixedCurrencies
    ? `${currencies.length} currencies`
    : `${primaryCurrency} ${formatDecimalMoney(totalPaidStr)}`;

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | 'idle' | 'neutral' => {
    switch (status.toLowerCase()) {
      case 'paid':
        return 'ok';
      case 'sent':
        return 'warn';
      case 'overdue':
        return 'danger';
      case 'voided':
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
            <span>Billing & Invoices</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Invoices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'invoice' : 'invoices'} tracked in accounting register
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/estimates">Estimates</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/finance/invoices/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Invoice
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Outstanding Debt',
            value: formattedOutstanding,
            note: `${outstandingInvoices.length} invoices awaiting payment`,
            tone: outstandingInvoices.length > 0 ? 'warn' : undefined,
          },
          {
            label: 'Past Due',
            value: String(overdueCount),
            note: overdueCount > 0 ? 'requires collection follow-up' : 'all accounts current',
            tone: overdueCount > 0 ? 'danger' : undefined,
          },
          {
            label: 'Collected Volume',
            value: formattedPaid,
            note: `${paidCount} settled invoices`,
            tone: paidCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'In Preparation',
            value: String(draftCount),
            note: 'unbilled draft records',
          },
        ]}
      />

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <form onSubmit={handleSearchSubmit} className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoices by number, title, or client..."
            aria-label="Search invoices"
          />
          {searchInput && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchInput('');
                onSearchChange('');
              }}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </form>

        {/*
          Project filter. The options are authorized and tenant-scoped on the
          server (`listProjectOptions` requires `project.read`, filters by
          organizationId and excludes soft-deleted projects), so this control can
          only ever offer the caller's own projects. Selecting or clearing is a
          navigation to a new query string - the server re-queries with it.
        */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="invoice-project-filter"
            className="text-xs font-medium text-muted-foreground whitespace-nowrap"
          >
            Filter by project
          </label>
          <select
            id="invoice-project-filter"
            aria-label="Filter by project"
            value={projectIdFilter}
            onChange={(e) => onProjectFilterChange(e.target.value)}
            className="h-9 border border-input rounded-md px-3 text-xs bg-background max-w-[220px]"
          >
            <option value="">All Projects</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.archived ? `${project.name} (archived)` : project.name}
              </option>
            ))}
            {/*
              The URL can name a project this caller is not offered (deleted,
              another tenant's, or one beyond the option limit). The list is
              still filtered by it, so the control must say so - otherwise a
              filtered result would appear to have no filter applied.
            */}
            {projectIdFilter && !projectOptions.some((p) => p.id === projectIdFilter) && (
              <option value={projectIdFilter}>Unavailable project</option>
            )}
          </select>
        </div>

        <div className="bento-status-pills" role="tablist" aria-label="Filter invoices by status">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onStatusFilterChange(f.value)}
                className={`bento-filter-pill ${isActive ? 'bento-filter-pill--active' : ''}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bento 3-Column Invoices Grid ──────────────────────────────── */}
      {invoices.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || statusFilter || projectIdFilter
                ? 'No invoices match those filters'
                : 'No invoices found'
            }
            sub={
              projectIdFilter
                ? 'This project has no invoices matching the current filters. Clear the project filter to see all invoices.'
                : 'Create your first client invoice using the billing builder.'
            }
            action={{
              label: 'Create Invoice',
              onClick: () => {
                const link = document.createElement('a');
                link.href = '/finance/invoices/new';
                link.click();
              },
            }}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main Invoices Table (2 Cols) */}
          <div className="lg:col-span-2 min-w-0">
            <Panel
              title={`Invoices Register (${invoices.length})`}
              action={
                totalPages > 1 ? (
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                ) : null
              }
            >
              <div className="bento-sales-table-head">
                <span>Invoice & Title</span>
                <span>Client Contact</span>
                <span>Due Date</span>
                <span className="text-right">Total Amount</span>
                <span className="text-right">Status</span>
              </div>

              <div className="divide-y divide-border/60">
                {invoices.map((inv, idx) => {
                  const isSelected = activeInv?.id === inv.id;
                  const clientFullName = inv.client
                    ? `${inv.client.firstName ?? ''} ${inv.client.lastName ?? ''}`.trim() ||
                      'Unnamed Client'
                    : 'No client linked';

                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/* Number & Title */}
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          #{inv.number}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {inv.title}
                        </div>
                      </div>

                      {/* Client */}
                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {clientFullName}
                      </div>

                      {/* Due Date */}
                      <div className="text-xs text-muted-foreground truncate">
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                      </div>

                      {/* Total Amount */}
                      <div className="text-xs font-semibold text-foreground text-right font-mono">
                        {inv.currency} {formatDecimalMoney(inv.total)}
                      </div>

                      {/* Status */}
                      <div className="text-right">
                        <StatusPill tone={getStatusTone(inv.status)}>{inv.status}</StatusPill>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* Quick Preview Rail (1 Col) */}
          <div className="min-w-0">
            {activeInv ? (
              <Panel
                title="Invoice Inspector"
                action={
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href={`/finance/invoices/${activeInv.id}`}>
                      Open Detail <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      #{activeInv.number}
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">{activeInv.title}</h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Status"
                      value={
                        <StatusPill tone={getStatusTone(activeInv.status)}>
                          {activeInv.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Client Contact"
                      value={
                        activeInv.client ? (
                          <Link
                            href={`/crm/contacts/${activeInv.clientId}`}
                            className="text-accent hover:underline font-semibold"
                          >
                            {`${activeInv.client.firstName ?? ''} ${activeInv.client.lastName ?? ''}`.trim() ||
                              'Client'}
                          </Link>
                        ) : (
                          'No client linked'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Due Date"
                      value={
                        activeInv.dueDate
                          ? new Date(activeInv.dueDate).toLocaleDateString()
                          : 'No due date set'
                      }
                    />
                    <KeyValueRow
                      label="Subtotal"
                      value={`${activeInv.currency} ${formatDecimalMoney(activeInv.subtotal)}`}
                    />
                    <KeyValueRow
                      label="Tax Amount"
                      value={`${activeInv.currency} ${formatDecimalMoney(activeInv.tax)}`}
                    />
                    <KeyValueRow
                      label="Gross Total"
                      value={
                        <span className="font-bold text-foreground font-mono">
                          {activeInv.currency} {formatDecimalMoney(activeInv.total)}
                        </span>
                      }
                    />
                    <KeyValueRow
                      label="Payments Recorded"
                      value={
                        activeInv.payments?.length ? (
                          <span className="text-emerald-700 font-semibold font-mono">
                            {activeInv.payments.length} ({activeInv.currency}{' '}
                            {formatDecimalMoney(
                              sumDecimalAmounts(activeInv.payments.map((p) => p.amount))
                            )}
                            )
                          </span>
                        ) : (
                          'None'
                        )
                      }
                    />
                  </div>

                  <div className="border-t border-border pt-3">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/finance/invoices/${activeInv.id}`}>
                        Inspect Full Ledger & PDF
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel pad>
                <div className="text-center py-8 text-muted-foreground text-xs">
                  <Sparkles size={18} className="mx-auto mb-2 opacity-50" />
                  Select an invoice from the register to preview financial details.
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
