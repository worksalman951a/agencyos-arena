'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Globe,
  Plus,
  Search,
  ArrowUpRight,
  Shield,
  Trash2,
  Edit2,
  Eye,
  Users,
  MapPin,
} from 'lucide-react';
import { Panel, EmptyState, KeyValueRow, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import './bento-contacts.css';

function getSafeExternalUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`
    );
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export interface AccountItem {
  id: string;
  organizationId: string;
  name: string;
  website: string | null;
  address: string | null;
  status: string;
  contactCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoAccountsViewProps {
  accounts: AccountItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  onSearchChange: (val: string) => void;
  onDeleteRequest: (account: AccountItem) => void;
  deletingId: string | null;
}

export function BentoAccountsView({
  accounts,
  total,
  totalPages,
  page,
  searchVal,
  onSearchChange,
  onDeleteRequest,
  deletingId,
}: BentoAccountsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activeAccount = accounts[Math.min(selectedIdx, Math.max(0, accounts.length - 1))] ?? null;

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
            <span>Companies</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Accounts</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'account' : 'accounts'} in your organization workspace
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/crm/accounts/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New account
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
            placeholder="Search account name or address..."
            aria-label="Search accounts"
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

        <div className="ml-auto text-xs font-medium text-muted-foreground">
          Showing {accounts.length} of {total}
        </div>
      </div>

      {/* ── Bento 3-Column CRM Grid ───────────────────────────────────── */}
      {accounts.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={searchVal ? `No accounts match “${searchVal}”` : 'No accounts found'}
            sub="Get started by creating your first client account in this workspace."
          />
        </Panel>
      ) : (
        <div className="bento-crm-grid">
          {/* Column 1: Accounts Master List */}
          <Panel title="All Accounts" pad={false}>
            <div className="bento-table" role="table" aria-label="Accounts list">
              <div className="bento-acc-table-head" role="row">
                <span role="columnheader">Company</span>
                <span role="columnheader">Website</span>
                <span role="columnheader" className="text-right">
                  Contacts
                </span>
                <span role="columnheader" className="text-right">
                  Status
                </span>
              </div>

              {accounts.map((a, i) => {
                const isSelected = activeAccount?.id === a.id;
                const initials =
                  a.name
                    .split(' ')
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join('')
                    .toUpperCase() || 'A';

                return (
                  <button
                    key={a.id}
                    type="button"
                    role="row"
                    className="bento-acc-table-row"
                    data-active={isSelected}
                    onClick={() => setSelectedIdx(i)}
                    aria-label={`${a.name}, ${a.website ?? 'no website'}`}
                  >
                    <div className="bento-person" role="cell">
                      <span className="bento-acc-mark" aria-hidden="true">
                        {initials}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="bento-person-name">{a.name}</span>
                        <span className="bento-person-sub">{a.address ?? 'No address'}</span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground truncate" role="cell">
                      {a.website ?? '—'}
                    </div>

                    <div className="text-right text-xs text-muted-foreground" role="cell">
                      {a.contactCount}
                    </div>

                    <div className="text-right" role="cell">
                      <StatusPill tone={a.status === 'active' ? 'ok' : 'neutral'}>
                        {a.status}
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
                      href={`/crm/accounts?page=${page - 1}&search=${encodeURIComponent(searchVal)}`}
                      className="hover:underline"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/crm/accounts?page=${page + 1}&search=${encodeURIComponent(searchVal)}`}
                      className="hover:underline"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Column 2: Selected Account Detail Rail */}
          {activeAccount && (
            <Panel
              title="Account Overview"
              action={
                <Link
                  href={`/crm/accounts/${activeAccount.id}`}
                  className="text-xs text-accent hover:underline flex items-center gap-1 font-medium"
                >
                  Full Record <ArrowUpRight size={12} />
                </Link>
              }
            >
              <div className="bento-crm-detail">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-sm shrink-0">
                    {activeAccount.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground truncate">
                      {activeAccount.name}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(() => {
                        const safeUrl = getSafeExternalUrl(activeAccount.website);
                        return safeUrl ? (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline flex items-center gap-1"
                          >
                            <Globe size={11} /> {activeAccount.website}
                          </a>
                        ) : (
                          (activeAccount.website ?? 'No website listed')
                        );
                      })()}
                    </p>
                  </div>
                  <StatusPill tone={activeAccount.status === 'active' ? 'ok' : 'neutral'}>
                    {activeAccount.status}
                  </StatusPill>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/accounts/${activeAccount.id}`}>
                      <Eye size={12} className="mr-1.5" /> View
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/accounts/${activeAccount.id}/edit`}>
                      <Edit2 size={12} className="mr-1.5" /> Edit
                    </Link>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => onDeleteRequest(activeAccount)}
                    disabled={deletingId === activeAccount.id}
                  >
                    <Trash2 size={12} className="mr-1.5" />
                    {deletingId === activeAccount.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>

                <div className="space-y-3 pt-2 border-t border-border text-xs">
                  <KeyValueRow
                    label="Website"
                    value={(() => {
                      const safeUrl = getSafeExternalUrl(activeAccount.website);
                      return safeUrl ? (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline flex items-center gap-1"
                        >
                          {activeAccount.website} <ArrowUpRight size={11} />
                        </a>
                      ) : (
                        (activeAccount.website ?? '—')
                      );
                    })()}
                  />
                  <KeyValueRow
                    label="Address"
                    value={
                      activeAccount.address ? (
                        <span className="flex items-center gap-1.5">
                          <MapPin size={12} className="text-muted-foreground shrink-0" />
                          <span>{activeAccount.address}</span>
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KeyValueRow
                    label="Active Contacts"
                    value={
                      <span className="flex items-center gap-1.5 font-semibold text-foreground">
                        <Users size={12} className="text-muted-foreground" />
                        <span>{activeAccount.contactCount} linked</span>
                      </span>
                    }
                  />
                  <KeyValueRow
                    label="Client Since"
                    value={new Date(activeAccount.createdAt).toLocaleDateString()}
                  />
                </div>
              </div>
            </Panel>
          )}

          {/* Column 3: Context & Quick Commercial Actions */}
          {activeAccount && (
            <div className="bento-crm-side">
              <Panel title="Commercial Triggers">
                <div className="flex flex-col gap-2 p-1">
                  <Link
                    href={`/crm/contacts/new?accountId=${encodeURIComponent(activeAccount.id)}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>Add Contact to Account</span>
                    <Plus size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href="/sales/proposals/builder"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>New Proposal</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href="/finance/invoices/new"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 text-xs font-medium transition"
                  >
                    <span>New Invoice</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                </div>
              </Panel>

              <Panel title="Workspace Isolation">
                <div className="space-y-3 p-1 text-xs">
                  <div className="flex items-start gap-2">
                    <Shield size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-foreground">Tenant-Guarded</span>
                      <p className="text-muted-foreground text-[11px] mt-0.5">
                        Account and linked contacts strictly isolated to your organization.
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
