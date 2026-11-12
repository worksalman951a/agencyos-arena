'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Mail,
  Phone,
  ArrowUpRight,
  Trash2,
  Edit2,
  ArrowLeft,
  Building2,
  AlertTriangle,
} from 'lucide-react';
import {
  Avatar,
  Panel,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import './bento-contacts.css';

interface ContactAuditUser {
  id: string;
  name: string;
}

import { ClientPortalAccessWidget } from '@/components/crm/client-portal-access-widget';

export interface ContactDetailRecord {
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
  createdByUser: ContactAuditUser | null;
  updatedByUser: ContactAuditUser | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoContactRecordViewProps {
  contact: ContactDetailRecord;
  onDeleteRequest: () => void;
  deleting: boolean;
}

export function BentoContactRecordView({
  contact,
  onDeleteRequest,
  deleting,
}: BentoContactRecordViewProps) {
  const isDeleted = Boolean(contact.deletedAt);
  const displayName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unnamed Contact';

  return (
    <div className="bento-crm">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href="/crm/contacts" title="Back to Contacts">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/contacts" className="hover:underline">
                Contacts
              </Link>
              <span>/</span>
              <span>Record</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {displayName}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isDeleted && (
            <>
              <Button asChild variant="outline" size="sm" className="h-9">
                <Link href={`/crm/contacts/${contact.id}/edit`}>
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
            <Link href="/crm/contacts">All Contacts</Link>
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
            <p className="text-sm font-semibold text-destructive">This contact has been deleted</p>
            <p className="text-xs text-muted-foreground">
              Deleted on{' '}
              {new Date(contact.deletedAt as Date).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              and removed from active listings. Kept for audit history and cannot be edited.
            </p>
          </div>
        </div>
      )}

      {/* ── High-Level Metric Strip ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Record Status',
            value: isDeleted ? 'Deleted' : contact.status,
            tone: isDeleted ? undefined : contact.status === 'active' ? 'ok' : undefined,
          },
          {
            label: 'Account Affiliation',
            value: contact.account?.name ?? 'Individual',
            note: contact.accountId ? 'Organization client' : 'No account linked',
          },
          {
            label: 'Lead Source',
            value: contact.source ?? 'Direct',
            note: 'Channel origin',
          },
          {
            label: 'Privacy Protection',
            value: contact.isMasked ? 'PII Masked' : 'Standard',
            tone: contact.isMasked ? 'warn' : undefined,
          },
        ]}
      />

      {/* ── Bento Detail Layout: Main vs Side ───────────────────────── */}
      <div className="bento-record-layout">
        {/* Left / Main Column */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Contact Identity & Channels">
            <div className="space-y-4">
              <div className="flex items-center gap-4 pb-3 border-b border-border">
                <Avatar name={displayName} size="lg" tone="accent" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-foreground truncate">{displayName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {contact.account?.name
                      ? `Affiliated with ${contact.account.name}`
                      : 'No company linked'}
                  </p>
                </div>
                <StatusPill
                  tone={isDeleted ? 'idle' : contact.status === 'active' ? 'ok' : 'neutral'}
                >
                  {isDeleted ? 'Deleted' : contact.status}
                </StatusPill>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Email Address</dt>
                  <dd className="font-semibold text-foreground flex items-center gap-1.5">
                    <Mail size={13} className="text-muted-foreground" />
                    {contact.email ? (
                      contact.isMasked ? (
                        <span className="font-mono text-muted-foreground" title="Protected PII">
                          {contact.email}
                        </span>
                      ) : (
                        <a href={`mailto:${contact.email}`} className="text-accent hover:underline">
                          {contact.email}
                        </a>
                      )
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Phone Number</dt>
                  <dd className="font-semibold text-foreground flex items-center gap-1.5">
                    <Phone size={13} className="text-muted-foreground" />
                    <span
                      className={contact.isMasked ? 'font-mono text-muted-foreground' : undefined}
                    >
                      {contact.phone ?? '—'}
                    </span>
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">First Name</dt>
                  <dd className="font-medium text-foreground">{contact.firstName ?? '—'}</dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Last Name</dt>
                  <dd className="font-medium text-foreground">{contact.lastName}</dd>
                </div>
              </div>
            </div>
          </Panel>

          {!isDeleted && (
            <Panel title="Sales & Commercial Operations">
              <div className="space-y-3 text-xs">
                <p className="text-muted-foreground">
                  Generate sales and financial contracts linked directly to this contact:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <Link
                    href={`/sales/proposals/builder?contactId=${encodeURIComponent(contact.id)}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
                  >
                    <span>+ New Proposal</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href={`/sales/quotations/builder?contactId=${encodeURIComponent(contact.id)}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
                  >
                    <span>+ New Quotation</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href={`/finance/estimates/new?clientId=${encodeURIComponent(contact.id)}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
                  >
                    <span>+ New Estimate</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                </div>
              </div>
            </Panel>
          )}
        </div>

        {/* Right / Side Rail */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Account Context">
            <div className="space-y-3 text-xs">
              {contact.accountId ? (
                <div>
                  <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-accent" />
                      <span className="font-bold text-foreground">
                        {contact.account?.name ?? 'Affiliated Account'}
                      </span>
                    </div>
                    <Button asChild variant="outline" size="sm" className="h-7 text-[11px]">
                      <Link href={`/crm/accounts/${contact.accountId}`}>
                        View <ArrowUpRight size={11} className="ml-1" />
                      </Link>
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    This contact is linked to an account within your organization workspace.
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No account linked to this individual record.
                </p>
              )}
            </div>
          </Panel>

          {/* Client Portal Access Management (Phase 12B) */}
          <ClientPortalAccessWidget contactId={contact.id} contactEmail={contact.email} />

          <Panel title="Audit & Governance">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Created By"
                value={
                  contact.createdByUser?.name ? (
                    <span className="font-medium text-foreground">
                      {contact.createdByUser.name}
                    </span>
                  ) : contact.createdBy ? (
                    <span className="text-muted-foreground">User unavailable</span>
                  ) : (
                    '—'
                  )
                }
              />
              <KeyValueRow
                label="Updated By"
                value={
                  contact.updatedByUser?.name ? (
                    <span className="font-medium text-foreground">
                      {contact.updatedByUser.name}
                    </span>
                  ) : contact.updatedBy ? (
                    <span className="text-muted-foreground">User unavailable</span>
                  ) : (
                    '—'
                  )
                }
              />
              <KeyValueRow
                label="Created At"
                value={new Date(contact.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Last Updated"
                value={new Date(contact.updatedAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="PII Masked"
                value={contact.isMasked ? 'Active (Restricted)' : 'Inactive'}
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
