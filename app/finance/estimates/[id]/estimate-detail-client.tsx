'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoEstimateRecordView } from '@/components/finance/bento-estimate-record-view';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import { Button } from '@/components/ui/button';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';

interface EstimateDetailClientProps {
  estimate: EstimateResponse;
  clientName: string | null;
}

/**
 * Historical estimate record: read-only in both shells.
 *
 * Only the two access-preserving actions remain (PDF export and share link).
 * Edit, status changes, delete and convert-to-invoice are gone from the UI and
 * are refused by the API, so the screen cannot even offer a dead button.
 */
export function EstimateDetailClient({ estimate, clientName }: EstimateDetailClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoEstimateRecordView estimate={estimate} clientName={clientName} />;
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Estimate #{estimate.number}</h1>
          <p className="text-muted-foreground">
            Client: {clientName ?? estimate.clientId} &bull; Status: {estimate.status}
          </p>
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
          <Button asChild variant="outline">
            <Link href="/finance/estimates">Back</Link>
          </Button>
        </div>
      </div>

      <div className="bg-card p-4 rounded-lg border border-border">
        <p className="text-sm text-muted-foreground">
          This estimate is a historical record and is read-only. New billing starts from an accepted
          quotation, which can create an invoice (or an agreement first).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Estimate Details</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Number</dt>
              <dd className="font-mono font-medium">{estimate.number}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium capitalize">{estimate.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="font-medium">
                {estimate.currency} {Number(estimate.total).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Client Contact</h2>
          <p className="text-sm">{clientName ?? estimate.clientId}</p>
        </div>
      </div>
    </div>
  );
}
