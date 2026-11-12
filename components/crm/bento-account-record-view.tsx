'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Globe,
  ArrowUpRight,
  Trash2,
  Edit2,
  ArrowLeft,
  MapPin,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import {
  Avatar,
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
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

interface LinkedContact {
  id: string;
  firstName: string | null;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export interface AccountDetailRecord {
  id: string;
  organizationId: string;
  name: string;
  website: string | null;
  address: string | null;
  status: string;
  contactCount: number;
  contacts?: LinkedContact[];
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoAccountRecordViewProps {
  account: AccountDetailRecord;
  onDeleteRequest: () => void;
  deleting: boolean;
}

export function BentoAccountRecordView({
  account,
  onDeleteRequest,
  deleting,
}: BentoAccountRecordViewProps) {
  const isDeleted = Boolean(account.deletedAt);
  const contacts = account.contacts ?? [];

  return (
    <div className="bento-crm">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href="/crm/accounts" title="Back to Accounts">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/accounts" className="hover:underline">
                Accounts
              </Link>
              <span>/</span>
              <span>Record</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {account.name}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isDeleted && (
            <>
              <Button asChild variant="outline" size="sm" className="h-9">
                <Link href={`/crm/accounts/${account.id}/edit`}>
                  <Edit2 size={13} className="mr-1.5" /> Edit
                </Link>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-9"
                onClick={onDeleteRequest}
                disabled={deleting}
              >
                <Trash2 size={13} className="mr-1.5" />
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </>
          )}
          <Button asChild variant="secondary" size="sm" className="h-9">
            <Link href="/crm/accounts">All Accounts</Link>
          </Button>
        </div>
      </div>

      {/* ── Deleted Warning Banner ──────────────────────────────────── */}
      {isDeleted && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-destructive">This account has been deleted</p>
            <p className="text-xs text-muted-foreground">
              Deleted on{' '}
              {new Date(account.deletedAt as Date).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              and removed from active directory. Kept for historical reference.
            </p>
          </div>
        </div>
      )}

      {/* ── Metric StatStrip ────────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Account Status',
            value: isDeleted ? 'Deleted' : account.status,
            tone: isDeleted ? undefined : account.status === 'active' ? 'ok' : undefined,
          },
          {
            label: 'Linked Contacts',
            value: String(account.contactCount),
            note: `${contacts.length} active relationships`,
          },
          {
            label: 'Online Presence',
            value: account.website ? 'Website Verified' : 'None',
            note: account.website ?? 'No domain attached',
          },
          {
            label: 'Physical Location',
            value: account.address ? 'Registered' : 'Unspecified',
            note: account.address ? 'Address on file' : 'No street address',
          },
        ]}
      />

      {/* ── Bento Detail Layout: Main vs Side ───────────────────────── */}
      <div className="bento-record-layout">
        {/* Left / Main Column */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Company Identity & Web">
            <div className="space-y-4">
              <div className="flex items-center gap-4 pb-3 border-b border-border">
                <div className="w-12 h-12 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-base shrink-0">
                  {account.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-foreground truncate">{account.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {account.address ?? 'No physical address recorded'}
                  </p>
                </div>
                <StatusPill
                  tone={isDeleted ? 'idle' : account.status === 'active' ? 'ok' : 'neutral'}
                >
                  {isDeleted ? 'Deleted' : account.status}
                </StatusPill>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Website URL</dt>
                  <dd className="font-semibold text-foreground flex items-center gap-1.5">
                    <Globe size={13} className="text-muted-foreground" />
                    {(() => {
                      const safeUrl = getSafeExternalUrl(account.website);
                      return safeUrl ? (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline flex items-center gap-1"
                        >
                          {account.website} <ArrowUpRight size={11} />
                        </a>
                      ) : (
                        (account.website ?? '—')
                      );
                    })()}
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">HQ Address</dt>
                  <dd className="font-semibold text-foreground flex items-center gap-1.5">
                    <MapPin size={13} className="text-muted-foreground" />
                    {account.address ?? '—'}
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Company Status</dt>
                  <dd className="font-medium text-foreground capitalize">{account.status}</dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Total Contacts</dt>
                  <dd className="font-medium text-foreground">{account.contactCount} associated</dd>
                </div>
              </div>
            </div>
          </Panel>

          {/* Linked People Panel */}
          <Panel
            title={`People at ${account.name} (${contacts.length})`}
            action={
              !isDeleted ? (
                <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                  <Link href={`/crm/contacts/new?accountId=${encodeURIComponent(account.id)}`}>
                    <Plus size={12} className="mr-1" /> Add Person
                  </Link>
                </Button>
              ) : undefined
            }
          >
            {contacts.length === 0 ? (
              <EmptyState
                title="No contacts affiliated with this account"
                sub="Add a contact to establish individuals you know at this company."
              />
            ) : (
              <div className="divide-y divide-border">
                {contacts.map((c) => {
                  const fullName =
                    [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed Contact';
                  return (
                    <div
                      key={c.id}
                      className="py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={fullName} size="sm" />
                        <div className="flex flex-col min-w-0">
                          <Link
                            href={`/crm/contacts/${c.id}`}
                            className="font-semibold text-foreground hover:underline truncate"
                          >
                            {fullName}
                          </Link>
                          <span className="text-muted-foreground text-[11px] truncate">
                            {c.email ?? 'No email'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                          <Link href={`/crm/contacts/${c.id}`}>View Record</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* Right / Side Rail */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Commercial Triggers">
            <div className="flex flex-col gap-2 p-1 text-xs">
              <Link
                href={`/crm/contacts/new?accountId=${encodeURIComponent(account.id)}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>Add Contact</span>
                <Plus size={13} className="text-muted-foreground" />
              </Link>
              <Link
                href="/sales/proposals/builder"
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>New Proposal</span>
                <ArrowUpRight size={13} className="text-muted-foreground" />
              </Link>
              <Link
                href="/finance/invoices/new"
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>New Invoice</span>
                <ArrowUpRight size={13} className="text-muted-foreground" />
              </Link>
            </div>
          </Panel>

          <Panel title="Governance & Audit">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Created At"
                value={new Date(account.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Last Updated"
                value={new Date(account.updatedAt).toLocaleDateString()}
              />
              {account.deletedAt && (
                <KeyValueRow
                  label="Deleted At"
                  value={new Date(account.deletedAt).toLocaleDateString()}
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
