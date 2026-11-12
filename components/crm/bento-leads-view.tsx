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
  ArrowRight,
  AlertTriangle,
  DollarSign,
  Briefcase,
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

export interface LeadItem {
  id: string;
  organizationId: string;
  source: string;
  status: string;
  priority: string | null;
  expectedValue: string | null;
  contactId: string | null;
  accountId: string | null;
  ownerId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  notes: string | null;
  isDuplicate?: boolean;
  duplicateId?: string | null;
  contact: { id: string; firstName: string | null; lastName: string } | null;
  account: { id: string; name: string } | null;
  convertedOpportunity: {
    id: string;
    title: string;
    status: string;
    value: string | null;
    currency: string;
    createdAt: Date | string;
  } | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoLeadsViewProps {
  leads: LeadItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  priorityFilter: string;
  onSearchChange: (val: string) => void;
  onStatusFilterChange: (status: string) => void;
  onPriorityFilterChange: (priority: string) => void;
  onDeleteRequest: (lead: LeadItem) => void;
  deletingId: string | null;
}

export function BentoLeadsView({
  leads,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
  priorityFilter,
  onSearchChange,
  onStatusFilterChange,
  onPriorityFilterChange,
  onDeleteRequest,
  deletingId,
}: BentoLeadsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activeLead = leads[Math.min(selectedIdx, Math.max(0, leads.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  // Metrics derived strictly from existing backend leads
  const freshCount = leads.filter((l) => l.status === 'new').length;
  const qualifiedCount = leads.filter((l) => l.status === 'qualified').length;
  const convertedCount = leads.filter(
    (l) => l.status === 'converted' || !!l.convertedOpportunity
  ).length;
  const totalExpectedValue = leads.reduce(
    (sum, l) => sum + (l.expectedValue ? Number(l.expectedValue) : 0),
    0
  );

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>CRM</span>
            <span>/</span>
            <span>Inbound Pipeline</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Leads</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'lead' : 'leads'} in your organization workspace
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/crm/leads/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New lead
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          { label: 'Total Inbound', value: String(total), note: 'all records' },
          {
            label: 'New / Fresh',
            value: String(freshCount),
            note: 'awaiting action',
            tone: freshCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Qualified',
            value: String(qualifiedCount),
            note: 'ready to convert',
            tone: 'ok',
          },
          {
            label: 'Expected Value',
            value: totalExpectedValue > 0 ? `$${totalExpectedValue.toLocaleString()}` : '$0',
            note: `${convertedCount} converted`,
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
            placeholder="Search leads by source, status, notes..."
            aria-label="Search leads"
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
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="proposal">Proposal Sent</option>
            <option value="negotiation">Negotiation</option>
            <option value="converted">Converted</option>
            <option value="closed-won">Closed Won</option>
            <option value="closed-lost">Closed Lost</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by priority"
          >
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          {(searchVal || statusFilter || priorityFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setSearchInput('');
                onSearchChange('');
                onStatusFilterChange('');
                onPriorityFilterChange('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="ml-auto text-xs font-medium text-muted-foreground">
          Showing {leads.length} of {total}
        </div>
      </div>

      {/* ── Bento 3-Column CRM Grid ───────────────────────────────────── */}
      {leads.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || statusFilter || priorityFilter
                ? 'No leads match those filters'
                : 'No leads found'
            }
            sub="Get started by creating your first sales lead in this workspace."
          />
        </Panel>
      ) : (
        <div className="bento-crm-grid">
          {/* Column 1: Leads Master List */}
          <Panel title="All Leads" pad={false}>
            <div className="bento-table" role="table" aria-label="Leads list">
              <div className="bento-lead-table-head" role="row">
                <span role="columnheader">Lead / Contact</span>
                <span role="columnheader">Company</span>
                <span role="columnheader">Value</span>
                <span role="columnheader">Priority</span>
                <span role="columnheader" className="text-right">
                  Status
                </span>
              </div>

              {leads.map((l, i) => {
                const isSelected = activeLead?.id === l.id;
                const contactName = l.contact
                  ? [l.contact.firstName, l.contact.lastName].filter(Boolean).join(' ')
                  : 'Unassigned Person';
                const companyName = l.account?.name ?? 'No company attached';
                const initials = (l.source || 'L').slice(0, 2).toUpperCase();
                const isConverted = l.status === 'converted' || !!l.convertedOpportunity;

                return (
                  <button
                    key={l.id}
                    type="button"
                    role="row"
                    className="bento-lead-table-row"
                    data-active={isSelected}
                    onClick={() => setSelectedIdx(i)}
                    aria-label={`${l.source} lead, ${contactName}, ${companyName}`}
                  >
                    <div className="bento-person" role="cell">
                      <span className="bento-lead-mark" aria-hidden="true">
                        {initials}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="bento-person-name truncate">
                          {contactName}
                          {l.isDuplicate && (
                            <span
                              className="ml-1.5 inline-flex items-center text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded"
                              title="Possible duplicate enquiry"
                            >
                              <AlertTriangle size={9} className="mr-0.5" /> Duplicate
                            </span>
                          )}
                        </span>
                        <span className="bento-person-sub truncate">Source: {l.source}</span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground truncate" role="cell">
                      {companyName}
                    </div>

                    <div className="text-xs font-medium text-foreground truncate" role="cell">
                      {l.expectedValue ? `$${Number(l.expectedValue).toLocaleString()}` : '—'}
                    </div>

                    <div className="text-xs" role="cell">
                      {l.priority ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            l.priority === 'high'
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              : l.priority === 'medium'
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {l.priority}
                        </span>
                      ) : (
                        '—'
                      )}
                    </div>

                    <div className="text-right" role="cell">
                      <StatusPill
                        tone={
                          isConverted
                            ? 'info'
                            : l.status === 'qualified'
                              ? 'ok'
                              : l.status === 'closed-lost'
                                ? 'idle'
                                : 'neutral'
                        }
                      >
                        {l.status}
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
                      href={`/crm/leads?page=${page - 1}&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusFilter)}&priority=${encodeURIComponent(priorityFilter)}`}
                      className="hover:underline"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/crm/leads?page=${page + 1}&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusFilter)}&priority=${encodeURIComponent(priorityFilter)}`}
                      className="hover:underline"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Column 2: Selected Lead Detail Rail */}
          {activeLead && (
            <Panel
              title="Lead Overview"
              action={
                <Link
                  href={`/crm/leads/${activeLead.id}`}
                  className="text-xs text-accent hover:underline flex items-center gap-1 font-medium"
                >
                  Full Record <ArrowUpRight size={12} />
                </Link>
              }
            >
              <div className="bento-crm-detail">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-sm shrink-0">
                    {(activeLead.source || 'L').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground truncate">
                      {activeLead.contact
                        ? [activeLead.contact.firstName, activeLead.contact.lastName]
                            .filter(Boolean)
                            .join(' ')
                        : `Lead #${activeLead.id.slice(-6)}`}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Source:{' '}
                      <span className="font-semibold text-foreground">{activeLead.source}</span>
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      activeLead.status === 'converted' || !!activeLead.convertedOpportunity
                        ? 'info'
                        : activeLead.status === 'qualified'
                          ? 'ok'
                          : 'neutral'
                    }
                  >
                    {activeLead.status}
                  </StatusPill>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/leads/${activeLead.id}`}>
                      <Eye size={12} className="mr-1.5" /> View
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/leads/${activeLead.id}/edit`}>
                      <Edit2 size={12} className="mr-1.5" /> Edit
                    </Link>
                  </Button>
                  {activeLead.status !== 'converted' && !activeLead.convertedOpportunity && (
                    <Button
                      asChild
                      className="bg-accent text-accent-foreground hover:bg-accent/90 h-8 text-xs"
                      size="sm"
                    >
                      <Link href={`/crm/leads/${activeLead.id}/convert`}>
                        <ArrowRight size={12} className="mr-1.5" /> Convert
                      </Link>
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => onDeleteRequest(activeLead)}
                    disabled={deletingId === activeLead.id}
                  >
                    <Trash2 size={12} className="mr-1.5" />
                    {deletingId === activeLead.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>

                <div className="space-y-3 pt-2 border-t border-border text-xs">
                  <KeyValueRow
                    label="Contact"
                    value={
                      activeLead.contact ? (
                        <Link
                          href={`/crm/contacts/${activeLead.contact.id}`}
                          className="text-accent hover:underline flex items-center gap-1 font-medium"
                        >
                          <User size={12} />
                          <span>
                            {[activeLead.contact.firstName, activeLead.contact.lastName]
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
                    label="Account"
                    value={
                      activeLead.account ? (
                        <Link
                          href={`/crm/accounts/${activeLead.account.id}`}
                          className="text-accent hover:underline flex items-center gap-1 font-medium"
                        >
                          <Building2 size={12} />
                          <span>{activeLead.account.name}</span>
                        </Link>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Expected Value"
                    value={
                      activeLead.expectedValue ? (
                        <span className="flex items-center gap-1 font-bold text-foreground">
                          <DollarSign size={12} className="text-muted-foreground" />
                          <span>${Number(activeLead.expectedValue).toLocaleString()}</span>
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Priority"
                    value={
                      activeLead.priority ? (
                        <Chip tone={activeLead.priority === 'high' ? 'warn' : 'idle'}>
                          {activeLead.priority}
                        </Chip>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Arrived On"
                    value={new Date(activeLead.createdAt).toLocaleDateString()}
                  />
                  {activeLead.convertedOpportunity && (
                    <KeyValueRow
                      label="Opportunity"
                      value={
                        <Link
                          href={`/crm/opportunities/${activeLead.convertedOpportunity.id}`}
                          className="text-accent hover:underline flex items-center gap-1 font-medium"
                        >
                          <Briefcase size={12} />
                          <span>{activeLead.convertedOpportunity.title}</span>
                        </Link>
                      }
                    />
                  )}
                </div>

                {activeLead.notes && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                      Notes
                    </span>
                    <p className="text-xs text-foreground bg-muted/40 p-2 rounded border border-border whitespace-pre-wrap">
                      {activeLead.notes}
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* Column 3: Context & Quick Operational Actions */}
          {activeLead && (
            <div className="bento-crm-side">
              <Panel title="Operational Actions">
                <div className="flex flex-col gap-2 p-1">
                  {activeLead.status !== 'converted' && !activeLead.convertedOpportunity ? (
                    <Link
                      href={`/crm/leads/${activeLead.id}/convert`}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-accent/40 bg-accent/5 hover:bg-accent/10 text-xs font-semibold text-accent transition"
                    >
                      <span>Convert to Opportunity</span>
                      <ArrowRight size={13} />
                    </Link>
                  ) : (
                    activeLead.convertedOpportunity && (
                      <Link
                        href={`/crm/opportunities/${activeLead.convertedOpportunity.id}`}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                      >
                        <span>View Opportunity</span>
                        <ArrowUpRight size={13} className="text-muted-foreground" />
                      </Link>
                    )
                  )}
                  {activeLead.contactId && (
                    <Link
                      href={`/sales/proposals/builder?contactId=${encodeURIComponent(activeLead.contactId)}`}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                    >
                      <span>New Proposal for Contact</span>
                      <ArrowUpRight size={13} className="text-muted-foreground" />
                    </Link>
                  )}
                  <Link
                    href="/crm/leads/new"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Create Another Lead</span>
                    <Plus size={13} className="text-muted-foreground" />
                  </Link>
                </div>
              </Panel>

              <Panel title="Workspace Governance">
                <div className="space-y-3 p-1 text-xs">
                  <div className="flex items-start gap-2">
                    <Shield size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-foreground">Isolated Pipeline</span>
                      <p className="text-muted-foreground text-[11px] mt-0.5">
                        Leads, associated opportunities, and contacts are isolated to your
                        authenticated tenant.
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
