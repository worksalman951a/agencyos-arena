'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  ArrowRight,
  User,
  Building2,
  AlertTriangle,
  Briefcase,
  DollarSign,
  Plus,
  ArrowUpRight,
} from 'lucide-react';
import {
  Panel,
  KeyValueRow,
  StatusPill,
  Chip,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import './bento-contacts.css';

export interface LeadDetailRecord {
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

interface BentoLeadRecordViewProps {
  lead: LeadDetailRecord;
  onDeleteRequest: () => void;
  deleting: boolean;
}

export function BentoLeadRecordView({ lead, onDeleteRequest, deleting }: BentoLeadRecordViewProps) {
  const isDeleted = Boolean(lead.deletedAt);
  const isConverted = lead.status === 'converted' || !!lead.convertedOpportunity;
  const contactName = lead.contact
    ? [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(' ')
    : 'Unassigned Person';

  return (
    <div className="bento-crm">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href="/crm/leads" title="Back to Leads">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/leads" className="hover:underline">
                Leads
              </Link>
              <span>/</span>
              <span>Enquiry</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {contactName !== 'Unassigned Person' ? contactName : `Lead #${lead.id.slice(-6)}`}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isDeleted && (
            <>
              <Button asChild variant="outline" size="sm" className="h-9">
                <Link href={`/crm/leads/${lead.id}/edit`}>
                  <Edit2 size={13} className="mr-1.5" /> Edit
                </Link>
              </Button>
              {!isConverted && (
                <Button
                  asChild
                  className="bg-accent text-accent-foreground hover:bg-accent/90 h-9"
                  size="sm"
                >
                  <Link href={`/crm/leads/${lead.id}/convert`}>
                    <ArrowRight size={13} className="mr-1.5" /> Convert to Opportunity
                  </Link>
                </Button>
              )}
              {isConverted && lead.convertedOpportunity && (
                <Button asChild variant="outline" size="sm" className="h-9">
                  <Link href={`/crm/opportunities/${lead.convertedOpportunity.id}`}>
                    <Briefcase size={13} className="mr-1.5" /> View Opportunity
                  </Link>
                </Button>
              )}
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
            <Link href="/crm/leads">All Leads</Link>
          </Button>
        </div>
      </div>

      {/* ── Soft-Deleted Warning Banner ─────────────────────────────── */}
      {isDeleted && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-destructive">This lead has been deleted</p>
            <p className="text-xs text-muted-foreground">
              Deleted on{' '}
              {new Date(lead.deletedAt as Date).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              and excluded from active queries.
            </p>
          </div>
        </div>
      )}

      {/* ── Converted Banner ────────────────────────────────────────── */}
      {isConverted && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4"
        >
          <Briefcase className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-accent">Lead successfully converted</p>
            <p className="text-xs text-muted-foreground">
              This lead was converted into an Opportunity.
              {lead.convertedOpportunity && (
                <>
                  {' '}
                  Linked deal:{' '}
                  <Link
                    href={`/crm/opportunities/${lead.convertedOpportunity.id}`}
                    className="font-semibold text-accent hover:underline"
                  >
                    {lead.convertedOpportunity.title}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Metric StatStrip ────────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Lead Status',
            value: isDeleted ? 'Deleted' : lead.status,
            tone: isDeleted
              ? undefined
              : isConverted
                ? 'ok'
                : lead.status === 'qualified'
                  ? 'ok'
                  : undefined,
          },
          {
            label: 'Priority',
            value: lead.priority ? lead.priority.toUpperCase() : 'MEDIUM',
            note: lead.priority ? `${lead.priority} urgency` : 'Standard urgency',
            tone: lead.priority === 'high' ? 'warn' : undefined,
          },
          {
            label: 'Expected Value',
            value: lead.expectedValue ? `$${Number(lead.expectedValue).toLocaleString()}` : '$0',
            note: lead.expectedValue ? 'Unweighted potential' : 'Not estimated',
          },
          {
            label: 'Inbound Source',
            value: lead.source,
            note: 'Channel origin',
          },
        ]}
      />

      {/* ── Bento Detail Layout: Main vs Side ───────────────────────── */}
      <div className="bento-record-layout">
        {/* Left / Main Column */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Triage & Classification">
            <div className="space-y-4">
              <div className="flex items-center gap-4 pb-3 border-border border-b">
                <div className="w-12 h-12 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-base shrink-0">
                  {(lead.source || 'L').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-foreground truncate">{contactName}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lead.account?.name ?? 'No company affiliation specified'}
                  </p>
                </div>
                <StatusPill
                  tone={
                    isDeleted
                      ? 'idle'
                      : isConverted
                        ? 'info'
                        : lead.status === 'qualified'
                          ? 'ok'
                          : 'neutral'
                  }
                >
                  {isDeleted ? 'Deleted' : lead.status}
                </StatusPill>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Inbound Channel</dt>
                  <dd className="font-semibold text-foreground capitalize flex items-center gap-1.5">
                    <Chip tone="accent">{lead.source}</Chip>
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">
                    Expected Pipeline Value
                  </dt>
                  <dd className="font-semibold text-foreground flex items-center gap-1.5">
                    <DollarSign size={13} className="text-muted-foreground" />
                    <span>
                      {lead.expectedValue ? `$${Number(lead.expectedValue).toLocaleString()}` : '—'}
                    </span>
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Priority Rank</dt>
                  <dd className="font-medium text-foreground capitalize">
                    {lead.priority ? (
                      <Chip tone={lead.priority === 'high' ? 'warn' : 'idle'}>{lead.priority}</Chip>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Lead ID</dt>
                  <dd className="font-mono text-xs text-muted-foreground">{lead.id}</dd>
                </div>
              </div>
            </div>
          </Panel>

          {/* Affiliated Relationship Records */}
          <Panel title="Associated Records">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Primary Contact"
                value={
                  lead.contact ? (
                    <Link
                      href={`/crm/contacts/${lead.contact.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <User size={13} />
                      <span>
                        {[lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(' ')}
                      </span>
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    'No contact affiliated'
                  )
                }
              />
              <KeyValueRow
                label="Client Account"
                value={
                  lead.account ? (
                    <Link
                      href={`/crm/accounts/${lead.account.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Building2 size={13} />
                      <span>{lead.account.name}</span>
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    'No account affiliated'
                  )
                }
              />
              <KeyValueRow
                label="Owner Assignment"
                value={lead.ownerId ? `Assigned (${lead.ownerId})` : 'Unassigned'}
              />
              {lead.convertedOpportunity && (
                <KeyValueRow
                  label="Opportunity"
                  value={
                    <Link
                      href={`/crm/opportunities/${lead.convertedOpportunity.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Briefcase size={13} />
                      <span>{lead.convertedOpportunity.title}</span>
                      <ArrowUpRight size={11} />
                    </Link>
                  }
                />
              )}
            </div>
          </Panel>

          {/* Notes Panel */}
          {lead.notes && (
            <Panel title="Enquiry Notes">
              <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                {lead.notes}
              </p>
            </Panel>
          )}
        </div>

        {/* Right / Side Rail */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Commercial Next Steps">
            <div className="flex flex-col gap-2 p-1 text-xs">
              {!isConverted && !isDeleted && (
                <Link
                  href={`/crm/leads/${lead.id}/convert`}
                  className="flex items-center justify-between p-3 rounded-lg border border-accent/40 bg-accent/5 hover:bg-accent/10 transition font-semibold text-accent"
                >
                  <span>Convert to Opportunity</span>
                  <ArrowRight size={13} />
                </Link>
              )}
              {lead.contactId && (
                <Link
                  href={`/sales/proposals/builder?contactId=${encodeURIComponent(lead.contactId)}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
                >
                  <span>Create Proposal</span>
                  <ArrowUpRight size={13} className="text-muted-foreground" />
                </Link>
              )}
              <Link
                href="/crm/leads/new"
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>New Lead</span>
                <Plus size={13} className="text-muted-foreground" />
              </Link>
            </div>
          </Panel>

          <Panel title="Audit & Traceability">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Created At"
                value={new Date(lead.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Last Updated"
                value={new Date(lead.updatedAt).toLocaleDateString()}
              />
              {lead.deletedAt && (
                <KeyValueRow
                  label="Deleted At"
                  value={new Date(lead.deletedAt).toLocaleDateString()}
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
