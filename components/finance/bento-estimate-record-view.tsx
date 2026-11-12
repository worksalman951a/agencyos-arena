'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Lock, ArrowRight } from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import { formatDecimalMoney } from '@/lib/finance/decimal-utils';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';
import '@/components/crm/bento-contacts.css';

interface BentoEstimateRecordViewProps {
  estimate: EstimateResponse;
  clientName: string | null;
  actionsNode: React.ReactNode;
}

export function BentoEstimateRecordView({
  estimate,
  clientName,
  actionsNode,
}: BentoEstimateRecordViewProps) {
  const isEditable = estimate.status === 'draft' || estimate.status === 'sent';

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (status.toLowerCase()) {
      case 'accepted':
      case 'converted':
        return 'ok';
      case 'sent':
        return 'warn';
      case 'rejected':
      case 'expired':
        return 'danger';
      default:
        return undefined;
    }
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href="/finance/estimates" aria-label="Back to estimates">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Estimates</span>
              <span>/</span>
              <span>#{estimate.number}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Estimate #{estimate.number}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportDocumentPdfButton
            documentKind="ESTIMATE"
            documentId={estimate.id}
            number={estimate.number}
            title={`Estimate ${estimate.number}`}
            status={estimate.status}
            currency={estimate.currency}
            createdAt={estimate.createdAt}
            validUntil={estimate.validUntil}
            clientName={clientName ?? estimate.clientId}
            subtotal={estimate.total}
            tax="0.00"
            total={estimate.total}
            notes={estimate.notes}
          />
          <ShareDocumentButton entityType="estimate" entityId={estimate.id} />
          {isEditable && (
            <Button asChild variant="outline" size="sm" className="h-9 text-xs">
              <Link href={`/finance/estimates/${estimate.id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link href="/finance/estimates">Back</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Quoted Total',
            value: `${estimate.currency} ${formatDecimalMoney(estimate.total)}`,
            note: 'preliminary commercial price',
          },
          {
            label: 'Estimate Status',
            value: estimate.status.toUpperCase(),
            tone: getStatusTone(estimate.status),
          },
          {
            label: 'Created Date',
            value: new Date(estimate.createdAt).toLocaleDateString(),
            note: 'registered in system',
          },
          {
            label: 'Validity Expiration',
            value: estimate.validUntil
              ? new Date(estimate.validUntil).toLocaleDateString()
              : 'No expiry',
            note: estimate.validUntil ? 'pricing valid until date' : 'perpetual validity',
          },
        ]}
      />

      {/* ── Status & Conversion Bar ──────────────────────────────────── */}
      <div className="bg-card p-4 rounded-lg border border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2">
            Status Actions:
          </span>
          {actionsNode}
        </div>
        <div>
          {estimate.status === 'accepted' ? (
            <Button asChild className="bg-accent text-accent-foreground shadow-sm" size="sm">
              <Link
                href={`/finance/estimates/${estimate.id}/convert`}
                className="flex items-center gap-1.5"
              >
                Convert to Invoice <ArrowRight size={13} />
              </Link>
            </Button>
          ) : (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock size={12} className="opacity-60" />
              <span>Accept estimate to unlock invoice conversion.</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Bento 2-Column Content Layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Scope & Terms (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Panel title="Estimate Valuation & Pricing">
            <div className="p-6 bg-muted/10 border rounded-lg space-y-4">
              <div className="flex items-baseline justify-between border-b pb-4">
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                    Document Valuation
                  </span>
                  <div className="text-2xl font-bold font-mono text-foreground mt-1">
                    {estimate.currency} {formatDecimalMoney(estimate.total)}
                  </div>
                </div>
                <div>
                  <StatusPill tone={getStatusTone(estimate.status)}>{estimate.status}</StatusPill>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                This estimate represents a binding commercial quote when accepted. Once marked
                accepted, it can be converted directly into an active billing invoice with identical
                terms and line-item integrity.
              </p>
            </div>
          </Panel>

          {/* Notes & Terms */}
          {estimate.notes && (
            <Panel title="Commercial Notes & Scope">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {estimate.notes}
              </p>
            </Panel>
          )}
        </div>

        {/* Right Column: Commercial Relationship (1 col) */}
        <div className="space-y-6 min-w-0">
          <Panel title="Client Relationship">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Client Contact"
                value={
                  estimate.clientId ? (
                    <Link
                      href={`/crm/contacts/${estimate.clientId}`}
                      className="text-accent hover:underline font-semibold"
                    >
                      {clientName ?? estimate.clientId}
                    </Link>
                  ) : (
                    'No client linked'
                  )
                }
              />
              <KeyValueRow
                label="Currency"
                value={<span className="font-mono font-semibold">{estimate.currency}</span>}
              />
              <KeyValueRow
                label="Created Date"
                value={new Date(estimate.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Valid Until"
                value={
                  estimate.validUntil
                    ? new Date(estimate.validUntil).toLocaleDateString()
                    : 'No expiry date set'
                }
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
