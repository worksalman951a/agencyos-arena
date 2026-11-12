'use client';

import * as React from 'react';
import Link from 'next/link';
import { Mail, Phone, Plus, Search, ArrowUpRight, Shield, Trash2, Edit2, Eye } from 'lucide-react';
import {
  Avatar,
  Chip,
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import './bento-contacts.css';

export interface ContactItem {
  id: string;
  organizationId: string;
  accountId: string | null;
  account?: { id: string; name: string } | null;
  firstName: string | null;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  isMasked: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoContactsViewProps {
  contacts: ContactItem[];
  total: number;
  totalPages: number;
  page: number;
  isLoading: boolean;
  searchVal: string;
  includeDeleted: boolean;
  onSearchChange: (val: string) => void;
  onDeleteRequest: (contact: ContactItem) => void;
  deletingId: string | null;
}

export function BentoContactsView({
  contacts,
  total,
  totalPages,
  page,
  isLoading,
  searchVal,
  includeDeleted,
  onSearchChange,
  onDeleteRequest,
  deletingId,
}: BentoContactsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activeContact = contacts[Math.min(selectedIdx, Math.max(0, contacts.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>CRM</span>
            <span>/</span>
            <span>Directory</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Contacts</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'contact' : 'contacts'} in your organization workspace
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/crm/contacts/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New contact
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <form onSubmit={handleSearchSubmit} className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or email..."
            aria-label="Search contacts"
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

        <Button asChild variant={includeDeleted ? 'secondary' : 'outline'} size="sm">
          <Link
            href={includeDeleted ? '/crm/contacts' : '/crm/contacts?includeDeleted=true'}
            aria-pressed={includeDeleted}
          >
            {includeDeleted ? 'Hide deleted' : 'Show deleted'}
          </Link>
        </Button>

        <div className="ml-auto text-xs font-medium text-muted-foreground">
          Showing {contacts.length} of {total}
        </div>
      </div>

      {includeDeleted && (
        <p className="text-xs text-muted-foreground">
          Deleted contacts are included. They are kept for reference and cannot be edited.
        </p>
      )}

      {/* ── Bento 3-Column CRM Grid ───────────────────────────────────── */}
      {isLoading ? (
        <Panel pad>
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Loading contacts…
          </div>
        </Panel>
      ) : contacts.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={searchVal ? `No contacts match “${searchVal}”` : 'No contacts found'}
            sub="Get started by creating your first contact in this workspace."
          />
        </Panel>
      ) : (
        <div className="bento-crm-grid">
          {/* Column 1: Contacts Master List */}
          <Panel title="All Contacts" pad={false}>
            <div className="bento-table" role="table" aria-label="Contacts list">
              <div className="bento-table-head" role="row">
                <span role="columnheader">Person</span>
                <span role="columnheader">Account / Company</span>
                <span role="columnheader" className="text-right">
                  Status
                </span>
              </div>

              {contacts.map((c, i) => {
                const fullName =
                  [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed Contact';
                const isSelected = activeContact?.id === c.id;
                const isDeleted = Boolean(c.deletedAt);

                return (
                  <button
                    key={c.id}
                    type="button"
                    role="row"
                    className="bento-table-row"
                    data-active={isSelected}
                    onClick={() => setSelectedIdx(i)}
                    aria-label={`${fullName}, ${c.email ?? 'no email'}`}
                  >
                    <div className="bento-person" role="cell">
                      <Avatar name={fullName} size="sm" tone={isSelected ? 'accent' : undefined} />
                      <div className="flex flex-col min-width-0">
                        <span className="bento-person-name">{fullName}</span>
                        <span className="bento-person-sub">{c.email ?? 'No email'}</span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground truncate" role="cell">
                      {c.account?.name ?? '—'}
                    </div>

                    <div className="text-right" role="cell">
                      {isDeleted ? (
                        <StatusPill tone="idle">Deleted</StatusPill>
                      ) : (
                        <StatusPill tone={c.status === 'active' ? 'ok' : 'neutral'}>
                          {c.status}
                        </StatusPill>
                      )}
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
                      href={`/crm/contacts?page=${page - 1}&search=${encodeURIComponent(searchVal)}&includeDeleted=${includeDeleted}`}
                      className="hover:underline"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/crm/contacts?page=${page + 1}&search=${encodeURIComponent(searchVal)}&includeDeleted=${includeDeleted}`}
                      className="hover:underline"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Column 2: Selected Contact Detail Rail */}
          {activeContact && (
            <Panel
              title="Contact Overview"
              action={
                <Link
                  href={`/crm/contacts/${activeContact.id}`}
                  className="text-xs text-accent hover:underline flex items-center gap-1 font-medium"
                >
                  Full Profile <ArrowUpRight size={12} />
                </Link>
              }
            >
              <div className="bento-crm-detail">
                <div className="flex items-start gap-3">
                  <Avatar
                    name={[activeContact.firstName, activeContact.lastName]
                      .filter(Boolean)
                      .join(' ')}
                    size="md"
                    tone="accent"
                  />
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground truncate">
                      {[activeContact.firstName, activeContact.lastName]
                        .filter(Boolean)
                        .join(' ') || 'Unnamed Contact'}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activeContact.account?.name ?? 'No affiliated account'}
                    </p>
                  </div>
                  <Chip tone={activeContact.status === 'active' ? 'accent' : undefined}>
                    {activeContact.status}
                  </Chip>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/contacts/${activeContact.id}`}>
                      <Eye size={12} className="mr-1.5" /> View
                    </Link>
                  </Button>
                  {!activeContact.deletedAt && (
                    <>
                      <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                        <Link href={`/crm/contacts/${activeContact.id}/edit`}>
                          <Edit2 size={12} className="mr-1.5" /> Edit
                        </Link>
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => onDeleteRequest(activeContact)}
                        disabled={deletingId === activeContact.id}
                      >
                        <Trash2 size={12} className="mr-1.5" />
                        {deletingId === activeContact.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </>
                  )}
                </div>

                <div className="space-y-3 pt-2 border-t border-border text-xs">
                  <KeyValueRow
                    label="Email"
                    value={
                      activeContact.email ? (
                        <span className="flex items-center gap-1.5">
                          <Mail size={12} className="text-muted-foreground" />
                          {activeContact.isMasked ? (
                            <span className="font-mono text-muted-foreground" title="Protected PII">
                              {activeContact.email}
                            </span>
                          ) : (
                            <a
                              href={`mailto:${activeContact.email}`}
                              className="text-accent hover:underline"
                            >
                              {activeContact.email}
                            </a>
                          )}
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Phone"
                    value={
                      activeContact.phone ? (
                        <span className="flex items-center gap-1.5">
                          <Phone size={12} className="text-muted-foreground" />
                          <span
                            className={
                              activeContact.isMasked ? 'font-mono text-muted-foreground' : undefined
                            }
                          >
                            {activeContact.phone}
                          </span>
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Account"
                    value={
                      activeContact.accountId ? (
                        <Link
                          href={`/crm/accounts/${activeContact.accountId}`}
                          className="text-accent hover:underline"
                        >
                          View Account
                        </Link>
                      ) : (
                        'None'
                      )
                    }
                  />
                  <KeyValueRow label="Source" value={activeContact.source ?? '—'} />
                  <KeyValueRow
                    label="Created"
                    value={new Date(activeContact.createdAt).toLocaleDateString()}
                  />
                </div>
              </div>
            </Panel>
          )}

          {/* Column 3: Context & Quick Sales Triggers */}
          {activeContact && (
            <div className="bento-crm-side">
              <Panel title="Related Actions">
                <div className="flex flex-col gap-2 p-1">
                  <Link
                    href={`/sales/proposals/builder?contactId=${encodeURIComponent(activeContact.id)}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Create Proposal</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href={`/sales/quotations/builder?contactId=${encodeURIComponent(activeContact.id)}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Create Quotation</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href={`/finance/estimates/new?clientId=${encodeURIComponent(activeContact.id)}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Create Estimate</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                </div>
              </Panel>

              <Panel title="Security & Compliance">
                <div className="space-y-3 p-1 text-xs">
                  <div className="flex items-start gap-2">
                    <Shield size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-foreground">Organization Isolation</span>
                      <p className="text-muted-foreground text-[11px] mt-0.5">
                        Tenant-isolated record guarded by server-side permissions.
                      </p>
                    </div>
                  </div>
                  {activeContact.isMasked && (
                    <div className="p-2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px]">
                      PII masking active for protected sensitive fields.
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
