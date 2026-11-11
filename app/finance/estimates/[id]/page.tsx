/**
 * AgencyOS Estimate Detail page.
 * Displays a single estimate with client relationship, status lifecycle actions,
 * PDF export, shareable link, and convert-to-invoice action.
 */

import Link from 'next/link';
import { getEstimate } from '@/lib/services/crm/estimate-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import { EstimateActions } from './EstimateActions';

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getEstimate(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/finance/estimates"
        backLabel="Back to estimates"
      />
    );
  }

  const estimate = result.data;
  const clientName = estimate.client
    ? `${estimate.client.firstName ?? ''} ${estimate.client.lastName ?? ''}`.trim() ||
      estimate.client.email ||
      'Unnamed Contact'
    : null;

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
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
          {estimate.status === 'accepted' && (
            <Link
              href={`/finance/estimates/${id}/convert`}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Convert to Invoice
            </Link>
          )}
          <Link
            href="/finance/estimates"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Estimates
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="col-span-1 md:col-span-2">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">Estimate Details</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Estimate Number</dt>
                <dd className="font-medium">{estimate.number}</dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Client Contact</dt>
                <dd className="font-medium text-right">
                  {clientName ? (
                    <Link
                      href={`/crm/contacts/${estimate.clientId}`}
                      className="text-accent hover:underline"
                    >
                      {clientName}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{estimate.clientId}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-bold text-right text-accent">
                  {estimate.currency}{' '}
                  {Number(estimate.total).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Currency</dt>
                <dd className="font-medium">{estimate.currency}</dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                      estimate.status === 'converted'
                        ? 'bg-purple-100 text-purple-800'
                        : estimate.status === 'accepted'
                          ? 'bg-green-100 text-green-800'
                          : estimate.status === 'rejected'
                            ? 'bg-red-100 text-red-800'
                            : estimate.status === 'sent'
                              ? 'bg-blue-100 text-blue-800'
                              : estimate.status === 'expired'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {estimate.status}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Valid Until</dt>
                <dd className="font-medium">
                  {estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created At</dt>
                <dd className="font-medium">{new Date(estimate.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="col-span-1">
          <div className="rounded-lg border bg-card p-6 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Actions</h2>
            {estimate.status === 'draft' || estimate.status === 'sent' ? (
              <Link
                href={`/finance/estimates/${id}/edit`}
                className="block w-full px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium text-center hover:bg-accent/90"
              >
                Edit Estimate
              </Link>
            ) : (
              <div className="w-full px-4 py-2 bg-muted text-muted-foreground rounded-md text-xs text-center">
                Locked — status is {estimate.status}
              </div>
            )}

            {estimate.status === 'accepted' && (
              <Link
                href={`/finance/estimates/${id}/convert`}
                className="block w-full px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium text-center hover:bg-green-700"
              >
                Convert to Invoice
              </Link>
            )}

            <EstimateActions estimateId={estimate.id} status={estimate.status} />
          </div>
        </div>
      </div>

      {estimate.notes && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Notes</h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{estimate.notes}</p>
        </div>
      )}
    </div>
  );
}
