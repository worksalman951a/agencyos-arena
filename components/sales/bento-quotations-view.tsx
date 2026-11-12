'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Plus,
  Search,
  FileCheck2,
  Building2,
  User,
  ArrowUpRight,
  Eye,
  Sparkles,
} from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import '@/components/crm/bento-contacts.css';

export interface QuotationItem {
  id: string;
  organizationId: string;
  number: string;
  title: string;
  status: string;
  subtotal: string | number;
  tax: string | number;
  total: string | number;
  currency: string;
  validUntil: Date | string | null;
  notes: string | null;
  opportunityId: string | null;
  contactId: string | null;
  opportunity: { id: string; title: string } | null;
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  creator: { id: string; name: string | null } | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface BentoQuotationsViewProps {
  quotations: QuotationItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  onSearchChange: (val: string) => void;
  onStatusFilterChange: (status: string) => void;
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

export function BentoQuotationsView({
  quotations,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
}: BentoQuotationsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activeQuot = quotations[Math.min(selectedIdx, Math.max(0, quotations.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  const draftCount = quotations.filter((q) => q.status === 'draft').length;
  const sentCount = quotations.filter((q) => q.status === 'sent').length;
  const acceptedCount = quotations.filter((q) => q.status === 'accepted').length;

  // Currency breakdown — check for mixed currencies before single-currency aggregation
  const currencies = Array.from(new Set(quotations.map((q) => q.currency).filter(Boolean)));
  const hasMixedCurrencies = currencies.length > 1;
  const primaryCurrency = currencies[0] ?? 'USD';
  const totalValue = quotations.reduce((sum, q) => {
    if (!q.total) return sum;
    const num = Number(q.total);
    return sum + (Number.isFinite(num) ? num : 0);
  }, 0);

  const formattedTotalValue = hasMixedCurrencies
    ? `${currencies.length} currencies`
    : totalValue > 0
      ? `${primaryCurrency} ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${primaryCurrency} 0.00`;

  const getStatusTone = (status: string): 'ok' | 'warn' | 'idle' | 'neutral' => {
    switch (status.toLowerCase()) {
      case 'accepted':
      case 'signed':
        return 'ok';
      case 'sent':
      case 'viewed':
        return 'warn';
      case 'rejected':
      case 'declined':
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
            <span>Sales</span>
            <span>/</span>
            <span>Priced Quotations</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Quotations</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'quotation' : 'quotations'} issued for client evaluation
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/sales/proposals">Proposals</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/sales/quotations/builder" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Quotation
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          { label: 'Total Quotes', value: String(total), note: 'issued register' },
          { label: 'Pending Quotes', value: String(draftCount), note: 'in preparation' },
          {
            label: 'Awaiting Acceptance',
            value: String(sentCount),
            note: 'sent to client',
            tone: sentCount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Quoted Volume',
            value: formattedTotalValue,
            note: hasMixedCurrencies ? 'multiple currencies' : 'aggregate volume',
            tone: acceptedCount > 0 ? 'ok' : undefined,
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
            placeholder="Search quotations by title, number, or notes..."
            aria-label="Search quotations"
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
              ✕
            </button>
          )}
        </form>

        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value || 'all'}
                type="button"
                className={`px-2.5 py-1 text-xs rounded-md transition font-medium ${
                  active
                    ? 'bg-accent text-accent-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                onClick={() => onStatusFilterChange(f.value)}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto text-xs font-medium text-muted-foreground">
          Showing {quotations.length} of {total}
        </div>
      </div>

      {/* ── Bento 3-Column Sales Grid ─────────────────────────────────── */}
      {quotations.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || statusFilter
                ? 'No quotations match those filters'
                : 'No quotations found'
            }
            sub="Create your first priced quotation using the interactive document builder."
            action={{
              label: 'Launch Builder',
              onClick: () => {
                const link = document.createElement('a');
                link.href = '/sales/quotations/builder';
                link.click();
              },
            }}
          />
        </Panel>
      ) : (
        <div className="bento-crm-grid">
          {/* Column 1: Quotations Master List */}
          <Panel title="Quotations Register" pad={false}>
            <div className="bento-sales-table-head" role="row">
              <span role="columnheader">Quotation</span>
              <span role="columnheader">Target Context</span>
              <span role="columnheader">Valid Until</span>
              <span role="columnheader" className="text-right">
                Total
              </span>
              <span role="columnheader" className="text-right">
                Status
              </span>
            </div>

            <div className="divide-y divide-border" role="table" aria-label="Quotations">
              {quotations.map((q, i) => {
                const isSelected = activeQuot?.id === q.id;
                const contactDisplay = q.contact
                  ? [q.contact.firstName, q.contact.lastName].filter(Boolean).join(' ') ||
                    q.contact.email ||
                    'Contact'
                  : '—';

                return (
                  <button
                    key={q.id}
                    type="button"
                    className="bento-sales-table-row"
                    data-active={isSelected ? 'true' : 'false'}
                    onClick={() => setSelectedIdx(i)}
                    aria-label={`Quotation ${q.number}: ${q.title}`}
                    role="row"
                  >
                    <div className="flex items-center gap-2.5 min-w-0" role="cell">
                      <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center font-bold text-xs shrink-0">
                        <FileCheck2 size={15} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-foreground text-xs truncate">
                          {q.title}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground truncate">
                          #{q.number}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground truncate" role="cell">
                      {q.opportunity?.title ?? contactDisplay}
                    </div>

                    <div className="text-xs text-muted-foreground" role="cell">
                      {q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}
                    </div>

                    <div
                      className="text-right text-xs font-semibold text-foreground truncate"
                      role="cell"
                    >
                      {q.currency}{' '}
                      {Number(q.total).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>

                    <div className="text-right" role="cell">
                      <StatusPill tone={getStatusTone(q.status)}>{q.status}</StatusPill>
                    </div>
                  </button>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={`/sales/quotations?page=${page - 1}&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusFilter)}`}
                      className="hover:underline"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/sales/quotations?page=${page + 1}&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusFilter)}`}
                      className="hover:underline"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Column 2: Selected Quotation Detail Rail */}
          {activeQuot && (
            <Panel
              title="Quotation Overview"
              action={
                <Link
                  href={`/sales/quotations/${activeQuot.id}`}
                  className="text-xs text-accent hover:underline flex items-center gap-1 font-medium"
                >
                  Full View <ArrowUpRight size={12} />
                </Link>
              }
            >
              <div className="bento-crm-detail space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-sm shrink-0">
                    <FileCheck2 size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground truncate">
                      {activeQuot.title}
                    </h2>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">
                      #{activeQuot.number}
                    </p>
                  </div>
                  <StatusPill tone={getStatusTone(activeQuot.status)}>
                    {activeQuot.status}
                  </StatusPill>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/sales/quotations/${activeQuot.id}`}>
                      <Eye size={12} className="mr-1.5" /> View
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/sales/quotations/builder/${activeQuot.id}`}>
                      <Sparkles size={12} className="mr-1.5" /> Edit in Builder
                    </Link>
                  </Button>
                </div>

                <div className="space-y-3 pt-2 border-t border-border text-xs">
                  <KeyValueRow
                    label="Grand Total"
                    value={
                      <span className="font-bold text-foreground">
                        {activeQuot.currency}{' '}
                        {Number(activeQuot.total).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    }
                  />
                  <KeyValueRow
                    label="Subtotal / Tax"
                    value={`${activeQuot.currency} ${Number(activeQuot.subtotal).toLocaleString()} / ${Number(activeQuot.tax).toLocaleString()}`}
                  />
                  <KeyValueRow
                    label="Valid Until"
                    value={
                      activeQuot.validUntil
                        ? new Date(activeQuot.validUntil).toLocaleDateString()
                        : 'No expiry'
                    }
                  />
                  <KeyValueRow
                    label="Opportunity"
                    value={
                      activeQuot.opportunity ? (
                        <Link
                          href={`/crm/opportunities/${activeQuot.opportunity.id}`}
                          className="text-accent hover:underline flex items-center gap-1 font-medium"
                        >
                          <Building2 size={12} />
                          <span>{activeQuot.opportunity.title}</span>
                        </Link>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Client Contact"
                    value={
                      activeQuot.contact ? (
                        <Link
                          href={`/crm/contacts/${activeQuot.contact.id}`}
                          className="text-accent hover:underline flex items-center gap-1 font-medium"
                        >
                          <User size={12} />
                          <span>
                            {[activeQuot.contact.firstName, activeQuot.contact.lastName]
                              .filter(Boolean)
                              .join(' ') || activeQuot.contact.email}
                          </span>
                        </Link>
                      ) : (
                        '—'
                      )
                    }
                  />
                </div>

                {activeQuot.notes && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                      Notes
                    </span>
                    <p className="text-xs text-foreground bg-muted/40 p-2 rounded border border-border whitespace-pre-wrap">
                      {activeQuot.notes}
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* Column 3: Quick Navigation */}
          {activeQuot && (
            <div className="bento-crm-side">
              <Panel title="Quotation Operations">
                <div className="flex flex-col gap-2 p-1">
                  <Link
                    href={`/sales/quotations/builder/${activeQuot.id}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Open in Document Builder</span>
                    <Sparkles size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href={`/sales/quotations/${activeQuot.id}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>View PDF & Share Link</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href="/sales/proposals/builder"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Create Full Proposal</span>
                    <Plus size={13} className="text-muted-foreground" />
                  </Link>
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
