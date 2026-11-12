'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Plus,
  Search,
  ArrowUpRight,
  Shield,
  Trash2,
  Edit2,
  Eye,
  Building2,
  User,
  DollarSign,
  Briefcase,
  FileText,
} from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  Chip,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import './bento-contacts.css';

export interface OpportunityItem {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  value: string | null;
  currency: string;
  closeDate: Date | string | null;
  ownerId: string | null;
  status: string;
  probability: string | null;
  lossReason: string | null;
  pipelineId: string | null;
  stageId: string | null;
  contactId: string | null;
  accountId: string | null;
  leadId: string | null;
  contact: { id: string; firstName: string | null; lastName: string } | null;
  account: { id: string; name: string } | null;
  lead: { id: string; source: string; status: string } | null;
  pipeline: { id: string; name: string } | null;
  stage: { id: string; name: string; isWon: boolean; isLost: boolean } | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoOpportunitiesViewProps {
  opportunities: OpportunityItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  onSearchChange: (val: string) => void;
  onStatusFilterChange: (status: string) => void;
  onDeleteRequest: (opp: OpportunityItem) => void;
  deletingId: string | null;
}

export function BentoOpportunitiesView({
  opportunities,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onDeleteRequest,
  deletingId,
}: BentoOpportunitiesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activeOpp =
    opportunities[Math.min(selectedIdx, Math.max(0, opportunities.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  const openCount = opportunities.filter((o) => o.status === 'open').length;
  const wonCount = opportunities.filter((o) => o.status === 'won').length;

  // Currency breakdown — check for mixed currencies before single-currency aggregation
  const currencies = Array.from(new Set(opportunities.map((o) => o.currency).filter(Boolean)));
  const hasMixedCurrencies = currencies.length > 1;
  const primaryCurrency = currencies[0] ?? 'USD';
  const totalValue = opportunities.reduce((sum, o) => {
    if (!o.value) return sum;
    const num = Number(o.value);
    return sum + (Number.isFinite(num) ? num : 0);
  }, 0);

  const formattedPipelineValue = hasMixedCurrencies
    ? `${currencies.length} currencies`
    : totalValue > 0
      ? `${primaryCurrency} ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${primaryCurrency} 0.00`;

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>CRM</span>
            <span>/</span>
            <span>Commercial Deals</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Opportunities</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'deal' : 'deals'} in active pipeline
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/crm/pipelines">Pipelines</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/crm/opportunities/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Opportunity
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          { label: 'Active Pipeline', value: String(total), note: 'all records' },
          {
            label: 'Open Deals',
            value: String(openCount),
            note: 'in negotiation',
            tone: openCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Closed Won',
            value: String(wonCount),
            note: 'won revenue',
            tone: wonCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Pipeline Value',
            value: formattedPipelineValue,
            note: hasMixedCurrencies ? 'multiple currencies' : 'aggregate volume',
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
            placeholder="Search deals by title or description..."
            aria-label="Search opportunities"
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

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>

          {(searchVal || statusFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setSearchInput('');
                onSearchChange('');
                onStatusFilterChange('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="ml-auto text-xs font-medium text-muted-foreground">
          Showing {opportunities.length} of {total}
        </div>
      </div>

      {/* ── Bento 3-Column CRM Grid ───────────────────────────────────── */}
      {opportunities.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || statusFilter
                ? 'No opportunities match those filters'
                : 'No opportunities found'
            }
            sub="Get started by creating your first sales opportunity in this pipeline."
          />
        </Panel>
      ) : (
        <div className="bento-crm-grid">
          {/* Column 1: Opportunities Master List */}
          <Panel title="All Opportunities" pad={false}>
            <div className="bento-table" role="table" aria-label="Opportunities list">
              <div className="bento-opp-table-head" role="row">
                <span role="columnheader">Deal / Title</span>
                <span role="columnheader">Account / Contact</span>
                <span role="columnheader">Stage</span>
                <span role="columnheader" className="text-right">
                  Value
                </span>
                <span role="columnheader" className="text-right">
                  Status
                </span>
              </div>

              {opportunities.map((o, i) => {
                const isSelected = activeOpp?.id === o.id;
                const companyName = o.account?.name ?? 'No company';
                const initials = o.title.slice(0, 2).toUpperCase();

                return (
                  <button
                    key={o.id}
                    type="button"
                    role="row"
                    className="bento-opp-table-row"
                    data-active={isSelected}
                    onClick={() => setSelectedIdx(i)}
                    aria-label={`${o.title}, ${companyName}, ${o.status}`}
                  >
                    <div className="bento-person" role="cell">
                      <span className="bento-lead-mark" aria-hidden="true">
                        {initials}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="bento-person-name truncate">{o.title}</span>
                        <span className="bento-person-sub truncate">
                          {o.pipeline?.name ?? 'Default Pipeline'}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground truncate" role="cell">
                      {companyName}
                    </div>

                    <div className="text-xs" role="cell">
                      {o.stage ? (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">
                          {o.stage.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </div>

                    <div
                      className="text-right text-xs font-semibold text-foreground truncate"
                      role="cell"
                    >
                      {o.value ? `${o.currency} ${Number(o.value).toLocaleString()}` : '—'}
                    </div>

                    <div className="text-right" role="cell">
                      <StatusPill
                        tone={o.status === 'won' ? 'ok' : o.status === 'lost' ? 'idle' : 'neutral'}
                      >
                        {o.status}
                      </StatusPill>
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
                      href={`/crm/opportunities?page=${page - 1}&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusFilter)}`}
                      className="hover:underline"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/crm/opportunities?page=${page + 1}&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusFilter)}`}
                      className="hover:underline"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Column 2: Selected Opportunity Detail Rail */}
          {activeOpp && (
            <Panel
              title="Deal Overview"
              action={
                <Link
                  href={`/crm/opportunities/${activeOpp.id}`}
                  className="text-xs text-accent hover:underline flex items-center gap-1 font-medium"
                >
                  Full Record <ArrowUpRight size={12} />
                </Link>
              }
            >
              <div className="bento-crm-detail">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-sm shrink-0">
                    <Briefcase size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground truncate">
                      {activeOpp.title}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activeOpp.account?.name ? (
                        <span className="font-semibold text-foreground">
                          {activeOpp.account.name}
                        </span>
                      ) : (
                        'No company attached'
                      )}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      activeOpp.status === 'won'
                        ? 'ok'
                        : activeOpp.status === 'lost'
                          ? 'idle'
                          : 'neutral'
                    }
                  >
                    {activeOpp.status}
                  </StatusPill>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/opportunities/${activeOpp.id}`}>
                      <Eye size={12} className="mr-1.5" /> View
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/opportunities/${activeOpp.id}/edit`}>
                      <Edit2 size={12} className="mr-1.5" /> Edit
                    </Link>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => onDeleteRequest(activeOpp)}
                    disabled={deletingId === activeOpp.id}
                  >
                    <Trash2 size={12} className="mr-1.5" />
                    {deletingId === activeOpp.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>

                <div className="space-y-3 pt-2 border-t border-border text-xs">
                  <KeyValueRow
                    label="Value"
                    value={
                      activeOpp.value ? (
                        <span className="flex items-center gap-1 font-bold text-foreground">
                          <DollarSign size={12} className="text-muted-foreground" />
                          <span>
                            {activeOpp.currency} {Number(activeOpp.value).toLocaleString()}
                          </span>
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Pipeline Stage"
                    value={
                      activeOpp.stage ? (
                        <Chip tone={activeOpp.stage.isWon ? 'ok' : 'idle'}>
                          {activeOpp.stage.name}
                        </Chip>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Account"
                    value={
                      activeOpp.account ? (
                        <Link
                          href={`/crm/accounts/${activeOpp.account.id}`}
                          className="text-accent hover:underline flex items-center gap-1 font-medium"
                        >
                          <Building2 size={12} />
                          <span>{activeOpp.account.name}</span>
                        </Link>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Contact"
                    value={
                      activeOpp.contact ? (
                        <Link
                          href={`/crm/contacts/${activeOpp.contact.id}`}
                          className="text-accent hover:underline flex items-center gap-1 font-medium"
                        >
                          <User size={12} />
                          <span>
                            {[activeOpp.contact.firstName, activeOpp.contact.lastName]
                              .filter(Boolean)
                              .join(' ')}
                          </span>
                        </Link>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Close Date"
                    value={
                      activeOpp.closeDate ? new Date(activeOpp.closeDate).toLocaleDateString() : '—'
                    }
                  />
                  {activeOpp.probability && (
                    <KeyValueRow
                      label="Win Probability"
                      value={`${Number(activeOpp.probability).toFixed(0)}%`}
                    />
                  )}
                </div>

                {activeOpp.description && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                      Description
                    </span>
                    <p className="text-xs text-foreground bg-muted/40 p-2 rounded border border-border whitespace-pre-wrap">
                      {activeOpp.description}
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* Column 3: Commercial Triggers */}
          {activeOpp && (
            <div className="bento-crm-side">
              <Panel title="Commercial Triggers">
                <div className="flex flex-col gap-2 p-1">
                  <Link
                    href={`/sales/proposals/builder?opportunityId=${encodeURIComponent(activeOpp.id)}${activeOpp.contact ? `&contactId=${encodeURIComponent(activeOpp.contact.id)}` : ''}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Create Proposal</span>
                    <FileText size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href={`/sales/quotations/builder?opportunityId=${encodeURIComponent(activeOpp.id)}${activeOpp.contact ? `&contactId=${encodeURIComponent(activeOpp.contact.id)}` : ''}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Create Quotation</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href="/crm/opportunities/new"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>New Opportunity</span>
                    <Plus size={13} className="text-muted-foreground" />
                  </Link>
                </div>
              </Panel>

              <Panel title="Pipeline Governance">
                <div className="space-y-3 p-1 text-xs">
                  <div className="flex items-start gap-2">
                    <Shield size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-foreground">
                        Isolated Revenue Records
                      </span>
                      <p className="text-muted-foreground text-[11px] mt-0.5">
                        Deals, stages, and quotes are strictly scoped to your authenticated
                        organization.
                      </p>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
