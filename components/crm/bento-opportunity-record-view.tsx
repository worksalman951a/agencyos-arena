'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  User,
  Building2,
  AlertTriangle,
  DollarSign,
  Plus,
  ArrowUpRight,
  FileText,
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

interface LinkedDoc {
  id: string;
  number: string;
  title: string;
  status: string;
  total: number | string;
  currency: string;
}

export interface OpportunityDetailRecord {
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
  proposals?: LinkedDoc[];
  quotations?: LinkedDoc[];
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoOpportunityRecordViewProps {
  opportunity: OpportunityDetailRecord;
  onDeleteRequest: () => void;
  deleting: boolean;
}

export function BentoOpportunityRecordView({
  opportunity,
  onDeleteRequest,
  deleting,
}: BentoOpportunityRecordViewProps) {
  const isDeleted = Boolean(opportunity.deletedAt);
  const proposals = opportunity.proposals ?? [];
  const quotations = opportunity.quotations ?? [];

  return (
    <div className="bento-crm">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href="/crm/opportunities" title="Back to Opportunities">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/opportunities" className="hover:underline">
                Opportunities
              </Link>
              <span>/</span>
              <span>Deal</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {opportunity.title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isDeleted && (
            <>
              <Button asChild variant="outline" size="sm" className="h-9">
                <Link href={`/crm/opportunities/${opportunity.id}/edit`}>
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
            <Link href="/crm/opportunities">All Opportunities</Link>
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
            <p className="text-sm font-semibold text-destructive">
              This opportunity has been deleted
            </p>
            <p className="text-xs text-muted-foreground">
              Deleted on{' '}
              {new Date(opportunity.deletedAt as Date).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              and excluded from active forecast metrics.
            </p>
          </div>
        </div>
      )}

      {/* ── Metric StatStrip ────────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Deal Value',
            value: opportunity.value
              ? `${opportunity.currency} ${Number(opportunity.value).toLocaleString()}`
              : '$0',
            note: 'Contract potential',
            tone: opportunity.value ? 'ok' : undefined,
          },
          {
            label: 'Stage',
            value: opportunity.stage?.name ?? 'Unassigned Stage',
            note: opportunity.pipeline?.name ?? 'Standard Pipeline',
          },
          {
            label: 'Win Probability',
            value: opportunity.probability ? `${Number(opportunity.probability).toFixed(0)}%` : '—',
            note: 'Weighted expectation',
          },
          {
            label: 'Expected Close',
            value: opportunity.closeDate
              ? new Date(opportunity.closeDate).toLocaleDateString()
              : 'Unscheduled',
            note: opportunity.status.toUpperCase(),
          },
        ]}
      />

      {/* ── Bento Detail Layout: Main vs Side ───────────────────────── */}
      <div className="bento-record-layout">
        {/* Left / Main Column */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Commercial Details">
            <div className="space-y-4">
              <div className="flex items-center gap-4 pb-3 border-border border-b">
                <div className="w-12 h-12 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-base shrink-0">
                  <DollarSign size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-foreground truncate">
                    {opportunity.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {opportunity.account?.name ?? 'No company affiliated'}
                  </p>
                </div>
                <StatusPill
                  tone={
                    opportunity.status === 'won'
                      ? 'ok'
                      : opportunity.status === 'lost'
                        ? 'idle'
                        : 'neutral'
                  }
                >
                  {opportunity.status}
                </StatusPill>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Contract Total</dt>
                  <dd className="font-semibold text-foreground flex items-center gap-1.5">
                    <DollarSign size={13} className="text-muted-foreground" />
                    <span>
                      {opportunity.value
                        ? `${opportunity.currency} ${Number(opportunity.value).toLocaleString()}`
                        : '—'}
                    </span>
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Pipeline & Stage</dt>
                  <dd className="font-medium text-foreground">
                    <Chip tone="accent">
                      {opportunity.pipeline?.name ?? 'Pipeline'} /{' '}
                      {opportunity.stage?.name ?? 'Stage'}
                    </Chip>
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Target Close Date</dt>
                  <dd className="font-medium text-foreground">
                    {opportunity.closeDate
                      ? new Date(opportunity.closeDate).toLocaleDateString()
                      : 'Not scheduled'}
                  </dd>
                </div>

                <div>
                  <dt className="text-muted-foreground font-medium mb-1">Owner Assignment</dt>
                  <dd className="font-medium text-foreground">
                    {opportunity.ownerId ? `Assigned (${opportunity.ownerId})` : 'Unassigned'}
                  </dd>
                </div>
              </div>

              {opportunity.lossReason && (
                <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-xs">
                  <span className="font-semibold text-destructive block mb-1">Loss Reason</span>
                  <p className="text-foreground">{opportunity.lossReason}</p>
                </div>
              )}
            </div>
          </Panel>

          {/* Affiliated Relationship Records */}
          <Panel title="Affiliated Entities">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Primary Contact"
                value={
                  opportunity.contact ? (
                    <Link
                      href={`/crm/contacts/${opportunity.contact.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <User size={13} />
                      <span>
                        {[opportunity.contact.firstName, opportunity.contact.lastName]
                          .filter(Boolean)
                          .join(' ')}
                      </span>
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    'No contact linked'
                  )
                }
              />
              <KeyValueRow
                label="Client Account"
                value={
                  opportunity.account ? (
                    <Link
                      href={`/crm/accounts/${opportunity.account.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Building2 size={13} />
                      <span>{opportunity.account.name}</span>
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    'No account linked'
                  )
                }
              />
              {opportunity.lead && (
                <KeyValueRow
                  label="Originating Lead"
                  value={
                    <Link
                      href={`/crm/leads/${opportunity.lead.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <span>
                        Lead #{opportunity.lead.id.slice(-6)} ({opportunity.lead.source})
                      </span>
                      <ArrowUpRight size={11} />
                    </Link>
                  }
                />
              )}
            </div>
          </Panel>

          {/* Linked Commercial Proposals & Quotations */}
          <Panel
            title={`Proposals & Quotations (${proposals.length + quotations.length})`}
            action={
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                  <Link
                    href={`/sales/proposals/builder?opportunityId=${encodeURIComponent(opportunity.id)}${opportunity.contact ? `&contactId=${encodeURIComponent(opportunity.contact.id)}` : ''}`}
                  >
                    <Plus size={11} className="mr-1" /> Proposal
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                  <Link
                    href={`/sales/quotations/builder?opportunityId=${encodeURIComponent(opportunity.id)}${opportunity.contact ? `&contactId=${encodeURIComponent(opportunity.contact.id)}` : ''}`}
                  >
                    <Plus size={11} className="mr-1" /> Quotation
                  </Link>
                </Button>
              </div>
            }
          >
            {proposals.length === 0 && quotations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                No proposals or quotations linked to this opportunity yet.
              </p>
            ) : (
              <div className="divide-y divide-border text-xs">
                {proposals.map((p) => (
                  <div key={`prop-${p.id}`} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-muted-foreground" />
                      <Link
                        href={`/sales/proposals/${p.id}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        #{p.number} — {p.title}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="capitalize text-muted-foreground">{p.status}</span>
                      <span className="font-semibold text-foreground">
                        {p.currency} {Number(p.total).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
                {quotations.map((q) => (
                  <div key={`quot-${q.id}`} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-muted-foreground" />
                      <Link
                        href={`/sales/quotations/${q.id}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        #{q.number} — {q.title}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="capitalize text-muted-foreground">{q.status}</span>
                      <span className="font-semibold text-foreground">
                        {q.currency} {Number(q.total).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Description Panel */}
          {opportunity.description && (
            <Panel title="Description">
              <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                {opportunity.description}
              </p>
            </Panel>
          )}
        </div>

        {/* Right / Side Rail */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Commercial Actions">
            <div className="flex flex-col gap-2 p-1 text-xs">
              <Link
                href={`/sales/proposals/builder?opportunityId=${encodeURIComponent(opportunity.id)}${opportunity.contact ? `&contactId=${encodeURIComponent(opportunity.contact.id)}` : ''}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>Create Proposal</span>
                <ArrowUpRight size={13} className="text-muted-foreground" />
              </Link>
              <Link
                href={`/sales/quotations/builder?opportunityId=${encodeURIComponent(opportunity.id)}${opportunity.contact ? `&contactId=${encodeURIComponent(opportunity.contact.id)}` : ''}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>Create Quotation</span>
                <ArrowUpRight size={13} className="text-muted-foreground" />
              </Link>
              {opportunity.contact && (
                <Link
                  href={`/finance/estimates/new?clientId=${encodeURIComponent(opportunity.contact.id)}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
                >
                  <span>Create Estimate</span>
                  <ArrowUpRight size={13} className="text-muted-foreground" />
                </Link>
              )}
            </div>
          </Panel>

          <Panel title="Audit & Governance">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Created At"
                value={new Date(opportunity.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Last Updated"
                value={new Date(opportunity.updatedAt).toLocaleDateString()}
              />
              {opportunity.deletedAt && (
                <KeyValueRow
                  label="Deleted At"
                  value={new Date(opportunity.deletedAt).toLocaleDateString()}
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
