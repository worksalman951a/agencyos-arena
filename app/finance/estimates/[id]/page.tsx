/**
 * AgencyOS Estimate Detail page.
 * Displays a single estimate with convert-to-invoice action.
 */

import Link from 'next/link';
import { getEstimate } from '@/lib/services/crm/estimate-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';

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

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Estimate #{estimate.number}</h1>
          <p className="text-muted-foreground">
            Client: {estimate.clientId} • Status: {estimate.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/finance/estimates"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Estimates
          </Link>
          {estimate.status === 'accepted' && (
            <Link
              href={`/finance/estimates/${id}/edit`}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Convert to Invoice
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="col-span-1 md:col-span-2">
          <div className="rounded-md border bg-background p-4">
            <h2 className="text-lg font-semibold mb-2">Details</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Estimate Number</dt>
                <dd className="font-medium">{estimate.number}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Client ID</dt>
                <dd className="font-medium">{estimate.clientId}</dd>
              </div>
              <div className="flex justify-between pt-2 border-t border-border">
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-medium text-right">
                  {estimate.currency} {Number(estimate.total).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Currency</dt>
                <dd className="font-medium">{estimate.currency}</dd>
              </div>
              <div className="flex justify-between pt-2 border-t border-border">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                      estimate.status === 'accepted'
                        ? 'bg-green-100 text-green-800'
                        : estimate.status === 'rejected'
                          ? 'bg-red-100 text-red-800'
                          : estimate.status === 'sent'
                            ? 'bg-blue-100 text-blue-800'
                            : estimate.status === 'expired'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {estimate.status}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Valid Until</dt>
                <dd className="font-medium">
                  {estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="col-span-1 md:col-span-1">
          <div className="rounded-md border bg-background p-4">
            <h2 className="text-lg font-semibold mb-2">Actions</h2>
            <div className="space-y-2">
              {estimate.status === 'draft' || estimate.status === 'sent' ? (
                <Link
                  href={`/finance/estimates/${id}/edit`}
                  className="w-full px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium text-center hover:bg-accent/90"
                >
                  Edit Estimate
                </Link>
              ) : (
                <span className="w-full px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm text-center">
                  Cannot edit — status is {estimate.status}
                </span>
              )}
              {estimate.status === 'accepted' && (
                <Link
                  href={`/finance/estimates/${id}/convert`}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium text-center hover:bg-green-700"
                >
                  Convert to Invoice
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {estimate.notes && (
        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Notes</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{estimate.notes}</p>
        </div>
      )}
    </div>
  );
}
