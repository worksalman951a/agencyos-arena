'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, User, ArrowUpRight, Sparkles, ExternalLink } from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import '@/components/crm/bento-contacts.css';

export interface QuotationDetailData {
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

interface BentoQuotationRecordViewProps {
  quotation: QuotationDetailData;
  actionsNode?: React.ReactNode;
}

export function BentoQuotationRecordView({
  quotation,
  actionsNode,
}: BentoQuotationRecordViewProps) {
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

  const contactFullName = quotation.contact
    ? [quotation.contact.firstName, quotation.contact.lastName].filter(Boolean).join(' ') ||
      quotation.contact.email ||
      'Unnamed Contact'
    : null;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href="/sales/quotations" title="Back to Quotations">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/sales/quotations" className="hover:underline">
                Quotations
              </Link>
              <span>/</span>
              <span>#{quotation.number}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {quotation.title}
              </h1>
              <StatusPill tone={getStatusTone(quotation.status)}>{quotation.status}</StatusPill>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportDocumentPdfButton
            documentKind="QUOTATION"
            number={quotation.number}
            title={quotation.title}
            status={quotation.status}
            currency={quotation.currency}
            createdAt={quotation.createdAt}
            validUntil={quotation.validUntil}
            clientName={contactFullName}
            opportunityTitle={quotation.opportunity?.title}
            subtotal={String(quotation.subtotal)}
            tax={String(quotation.tax)}
            total={String(quotation.total)}
            notes={quotation.notes}
            items={quotation.items.map((it) => ({
              description: it.description,
              quantity: String(it.quantity),
              unitPrice: String(it.unitPrice),
              taxRate: String(it.taxRate),
              amount: String(it.amount),
            }))}
          />
          <ShareDocumentButton entityType="quotation" entityId={quotation.id} />
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link href={`/sales/quotations/builder/${quotation.id}`}>
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
            label: 'Quotation Total',
            value: `${quotation.currency} ${Number(quotation.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            note: 'approved pricing scope',
            tone: quotation.status === 'accepted' ? 'ok' : undefined,
          },
          {
            label: 'Line Items',
            value: String(quotation.items.length),
            note: 'billable product/service units',
          },
          {
            label: 'Valid Until',
            value: quotation.validUntil
              ? new Date(quotation.validUntil).toLocaleDateString()
              : 'No expiry',
            note: quotation.validUntil ? 'pricing valid until date' : 'open pricing quote',
          },
          {
            label: 'Status',
            value: quotation.status.toUpperCase(),
            note: 'lifecycle state',
          },
        ]}
      />

      {/* ── Bento Master Content Layout ─────────────────────────────── */}
      <div className="bento-record-layout">
        {/* Left Column: Line Items & Notes */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Line Items Table */}
          <Panel title={`Quoted Line Items (${quotation.items.length})`}>
            {quotation.items.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No items added to this quotation yet. Open in the builder to add services or
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
                    {quotation.items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-medium text-foreground pr-2">
                          {item.description}
                        </td>
                        <td className="py-2.5 text-right font-mono text-muted-foreground">
                          {Number(item.quantity)}
                        </td>
                        <td className="py-2.5 text-right font-mono text-muted-foreground">
                          {quotation.currency}{' '}
                          {Number(item.unitPrice).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-2.5 text-right font-mono text-muted-foreground">
                          {Number(item.taxRate)}%
                        </td>
                        <td className="py-2.5 text-right font-mono font-semibold text-foreground">
                          {quotation.currency}{' '}
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
                        {quotation.currency}{' '}
                        {Number(quotation.subtotal).toLocaleString(undefined, {
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
                        {quotation.currency}{' '}
                        {Number(quotation.tax).toLocaleString(undefined, {
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
                        {quotation.currency}{' '}
                        {Number(quotation.total).toLocaleString(undefined, {
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

          {/* Quotation Notes */}
          {quotation.notes && (
            <Panel title="Quotation Notes">
              <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                {quotation.notes}
              </p>
            </Panel>
          )}
        </div>

        {/* Right / Side Rail: Metadata & Connected Context */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Commercial Context">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Opportunity"
                value={
                  quotation.opportunity ? (
                    <Link
                      href={`/crm/opportunities/${quotation.opportunity.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Building2 size={13} />
                      <span>{quotation.opportunity.title}</span>
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
                  quotation.contact ? (
                    <Link
                      href={`/crm/contacts/${quotation.contact.id}`}
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
                value={<span className="font-mono text-muted-foreground">{quotation.id}</span>}
              />
              <KeyValueRow
                label="Created"
                value={new Date(quotation.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Last Updated"
                value={new Date(quotation.updatedAt).toLocaleDateString()}
              />
              {quotation.creator && (
                <KeyValueRow
                  label="Author"
                  value={quotation.creator.name ?? quotation.creator.email ?? 'Staff'}
                />
              )}
            </div>
          </Panel>

          <Panel title="Quotation Operations">
            <div className="flex flex-col gap-2 p-1 text-xs">
              <Link
                href={`/sales/quotations/builder/${quotation.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>Edit Document in Builder</span>
                <Sparkles size={13} className="text-muted-foreground" />
              </Link>
              <Link
                href="/sales/proposals/builder"
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
              >
                <span>Generate Full Scope Proposal</span>
                <ExternalLink size={13} className="text-muted-foreground" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
