'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  User,
  ArrowUpRight,
  Sparkles,
  Clock,
  ExternalLink,
} from 'lucide-react';
import {
  Panel,
  KeyValueRow,
  StatusPill,
  Chip,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import type { ProposalVersionResponse } from '@/lib/services/documents/version-service';
import '@/components/crm/bento-contacts.css';

export interface ProposalDetailData {
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
    email?: string | null;
    phone?: string | null;
  } | null;
  creator: { id: string; name: string | null; email?: string | null } | null;
  updater: { id: string; name: string | null; email?: string | null } | null;
  items: Array<{
    id: string;
    description: string;
    quantity: string | number;
    unitPrice: string | number;
    taxRate: string | number;
    amount: string | number;
    sortOrder: number;
  }>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface BentoProposalRecordViewProps {
  proposal: ProposalDetailData;
  versions: ProposalVersionResponse[];
  actionsNode?: React.ReactNode;
}

export function BentoProposalRecordView({
  proposal,
  versions,
  actionsNode,
}: BentoProposalRecordViewProps) {
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

  const contactFullName = proposal.contact
    ? [proposal.contact.firstName, proposal.contact.lastName].filter(Boolean).join(' ') ||
      proposal.contact.email ||
      'Unnamed Contact'
    : null;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href="/sales/proposals" title="Back to Proposals">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/sales/proposals" className="hover:underline">
                Proposals
              </Link>
              <span>/</span>
              <span>#{proposal.number}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {proposal.title}
              </h1>
              <StatusPill tone={getStatusTone(proposal.status)}>{proposal.status}</StatusPill>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportDocumentPdfButton
            documentKind="PROPOSAL"
            number={proposal.number}
            title={proposal.title}
            status={proposal.status}
            currency={proposal.currency}
            createdAt={proposal.createdAt}
            validUntil={proposal.validUntil}
            clientName={contactFullName}
            opportunityTitle={proposal.opportunity?.title}
            subtotal={String(proposal.subtotal)}
            tax={String(proposal.tax)}
            total={String(proposal.total)}
            notes={proposal.notes}
            items={proposal.items.map((it) => ({
              description: it.description,
              quantity: String(it.quantity),
              unitPrice: String(it.unitPrice),
              taxRate: String(it.taxRate),
              amount: String(it.amount),
            }))}
          />
          <ShareDocumentButton entityType="proposal" entityId={proposal.id} />
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link href={`/sales/proposals/builder/${proposal.id}`}>
              <Sparkles size={13} className="mr-1.5" /> Edit in Builder
            </Link>
          </Button>
          {actionsNode}
        </div>
      </div>

      {/* ── StatStrip High-Level Summary ────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Grand Total',
            value: `${proposal.currency} ${Number(proposal.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            note: 'persisted contract value',
            tone: proposal.status === 'accepted' ? 'ok' : undefined,
          },
          {
            label: 'Line Items',
            value: String(proposal.items.length),
            note: 'billable line units',
          },
          {
            label: 'Valid Until',
            value: proposal.validUntil
              ? new Date(proposal.validUntil).toLocaleDateString()
              : 'No expiry',
            note: proposal.validUntil ? 'expiration deadline' : 'evergreen scope',
          },
          {
            label: 'Snapshots',
            value: String(versions.length),
            note: 'immutable versions',
          },
        ]}
      />

      {/* ── Bento Master Content Layout ─────────────────────────────── */}
      <div className="bento-record-layout">
        {/* Left Column: Line Items, Notes, Audit */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Line Items Table */}
          <Panel title={`Line Items (${proposal.items.length})`}>
            {proposal.items.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No items added to this proposal yet. Open in the builder to add services or
                products.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="pb-2.5">Description</th>
                      <th className="pb-2.5 text-right w-16">Qty</th>
                      <th className="pb-2.5 text-right w-24">Unit Price</th>
                      <th className="pb-2.5 text-right w-16">Tax</th>
                      <th className="pb-2.5 text-right w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {proposal.items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-medium text-foreground pr-2">
                          {item.description}
                        </td>
                        <td className="py-2.5 text-right font-mono text-muted-foreground">
                          {Number(item.quantity)}
                        </td>
                        <td className="py-2.5 text-right font-mono text-muted-foreground">
                          {proposal.currency}{' '}
                          {Number(item.unitPrice).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-2.5 text-right font-mono text-muted-foreground">
                          {Number(item.taxRate)}%
                        </td>
                        <td className="py-2.5 text-right font-mono font-semibold text-foreground">
                          {proposal.currency}{' '}
                          {Number(item.amount).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td colSpan={4} className="pt-3 text-right text-muted-foreground">
                        Subtotal
                      </td>
                      <td className="pt-3 text-right font-mono">
                        {proposal.currency}{' '}
                        {Number(proposal.subtotal).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="py-1 text-right text-muted-foreground">
                        Tax
                      </td>
                      <td className="py-1 text-right font-mono">
                        {proposal.currency}{' '}
                        {Number(proposal.tax).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                    <tr className="text-sm font-bold text-foreground">
                      <td colSpan={4} className="pt-1 text-right">
                        Total
                      </td>
                      <td className="pt-1 text-right font-mono">
                        {proposal.currency}{' '}
                        {Number(proposal.total).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>

          {/* Proposal Notes */}
          {proposal.notes && (
            <Panel title="Document Notes">
              <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                {proposal.notes}
              </p>
            </Panel>
          )}

          {/* Version Snapshots (Read-Only Immutable Audit History) */}
          <Panel
            title={`Version History (${versions.length})`}
            action={
              <span className="text-[11px] font-normal text-muted-foreground uppercase tracking-wider">
                Immutable Snapshots
              </span>
            }
          >
            {versions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                Initial draft version. Formal snapshots are recorded when proposals are updated,
                sent, or saved via the snapshot action.
              </p>
            ) : (
              <div className="divide-y divide-border text-xs">
                {versions.map((v) => (
                  <div key={v.id} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock size={13} className="text-muted-foreground" />
                      <span className="font-semibold text-foreground">Version {v.version}</span>
                      <span className="text-muted-foreground font-mono">
                        {new Date(v.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip>
                        {v.currency}{' '}
                        {Number(v.total).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Chip>
                      <StatusPill tone={getStatusTone(v.status)}>{v.status}</StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Right / Side Rail: Metadata & Connected Context */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Commercial Context">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Opportunity"
                value={
                  proposal.opportunity ? (
                    <Link
                      href={`/crm/opportunities/${proposal.opportunity.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Building2 size={13} />
                      <span>{proposal.opportunity.title}</span>
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    'No opportunity linked'
                  )
                }
              />
              <KeyValueRow
                label="Client Contact"
                value={
                  proposal.contact ? (
                    <Link
                      href={`/crm/contacts/${proposal.contact.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <User size={13} />
                      <span>{contactFullName}</span>
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    'No contact linked'
                  )
                }
              />
              <KeyValueRow
                label="Document ID"
                value={<span className="font-mono text-muted-foreground">{proposal.id}</span>}
              />
              <KeyValueRow
                label="Created"
                value={new Date(proposal.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Last Updated"
                value={new Date(proposal.updatedAt).toLocaleDateString()}
              />
              {proposal.creator && (
                <KeyValueRow
                  label="Author"
                  value={proposal.creator.name ?? proposal.creator.email ?? 'Staff'}
                />
              )}
            </div>
          </Panel>

          <Panel title="Document Operations">
            <div className="flex flex-col gap-2 p-1 text-xs">
              <Link
                href={`/sales/proposals/builder/${proposal.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>Edit Document in Builder</span>
                <Sparkles size={13} className="text-muted-foreground" />
              </Link>
              <Link
                href="/sales/quotations/builder"
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>Generate Parallel Quotation</span>
                <ExternalLink size={13} className="text-muted-foreground" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
