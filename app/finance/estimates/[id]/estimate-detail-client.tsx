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
  actionsNode: React.ReactNode;
}

export function EstimateDetailClient({
  estimate,
  clientName,
  actionsNode,
}: EstimateDetailClientProps) {
  const isBento = useBentoShell();
  const EDITABLE_STATUSES = ['draft', 'sent'];

  if (isBento) {
    return (
      <BentoEstimateRecordView
        estimate={estimate}
        clientName={clientName}
        actionsNode={actionsNode}
      />
    );
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
          {EDITABLE_STATUSES.includes(estimate.status) && (
            <Button asChild variant="outline">
              <Link href={`/finance/estimates/${estimate.id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/finance/estimates">Back</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-card p-4 rounded-lg border border-border">
        {actionsNode}
        {estimate.status === 'accepted' && (
          <Button asChild>
            <Link href={`/finance/estimates/${estimate.id}/convert`}>Convert to Invoice</Link>
          </Button>
        )}
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
