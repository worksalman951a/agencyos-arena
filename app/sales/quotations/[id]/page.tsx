/**
 * AgencyOS Sales Quotation Detail page.
 * Server component that shows quotation details, CRM links, line items,
 * PDF export, shareable links, and cross-module conversions.
 */

import Link from 'next/link';
import { getQuotation } from '@/lib/services/crm/quotation-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import { QuotationActions } from './QuotationActions';

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getQuotation(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/sales/quotations"
        backLabel="Back to quotations"
      />
    );
  }

  const quotation = result.data;
  const EDITABLE_STATUSES = ['draft', 'sent'];
  const contactName = quotation.contact
    ? `${quotation.contact.firstName ?? ''} ${quotation.contact.lastName ?? ''}`.trim() ||
      'Unnamed Contact'
    : null;

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{quotation.title}</h1>
          <p className="text-muted-foreground">
            #{quotation.number} &bull; {quotation.status} &bull; {quotation.currency}{' '}
            {Number(quotation.total).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            &bull;{' '}
            {quotation.validUntil
              ? new Date(quotation.validUntil).toLocaleDateString()
              : 'No expiry'}
          </p>
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
            clientName={contactName}
            opportunityTitle={quotation.opportunity?.title ?? null}
            subtotal={quotation.subtotal}
            tax={quotation.tax}
            total={quotation.total}
            notes={quotation.notes}
            items={quotation.items}
          />
          <ShareDocumentButton entityType="quotation" entityId={quotation.id} />
          {EDITABLE_STATUSES.includes(quotation.status) && (
            <Link
              href={`/sales/quotations/${quotation.id}/edit`}
              className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Edit
            </Link>
          )}
          <Link
            href="/sales/quotations/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Quotation
          </Link>
          <Link
            href="/sales/quotations"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Quotations
          </Link>
        </div>
      </div>

      {/* Status & Cross-Module Workflow Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-card p-4 rounded-lg border border-border">
        <QuotationActions quotationId={quotation.id} status={quotation.status} />
        <div className="flex flex-wrap items-center gap-2">
          {quotation.contactId && (
            <Link
              href={`/finance/estimates/new?fromQuotationId=${quotation.id}`}
              className="px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Create Estimate
            </Link>
          )}
          <Link
            href={`/documents/contracts/new?title=${encodeURIComponent(quotation.title)}`}
            className="px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Create Contract
          </Link>
          <Link
            href="/finance/invoices/new"
            className="px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            New Invoice
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Quotation Details</h2>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                    quotation.status === 'accepted'
                      ? 'bg-green-100 text-green-800'
                      : quotation.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : quotation.status === 'sent'
                          ? 'bg-blue-100 text-blue-800'
                          : quotation.status === 'expired'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {quotation.status}
                </span>
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Document Number</dt>
              <dd className="font-medium">{quotation.number}</dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Client Contact</dt>
              <dd className="font-medium text-right">
                {quotation.contact ? (
                  <Link
                    href={`/crm/contacts/${quotation.contact.id}`}
                    className="text-accent hover:underline"
                  >
                    {contactName}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Opportunity</dt>
              <dd className="font-medium text-right">
                {quotation.opportunity ? (
                  <Link
                    href={`/crm/opportunities/${quotation.opportunity.id}`}
                    className="text-accent hover:underline"
                  >
                    {quotation.opportunity.title}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Currency</dt>
              <dd className="font-medium">{quotation.currency}</dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Valid Until</dt>
              <dd className="font-medium">
                {quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Created By</dt>
              <dd className="font-medium">
                {quotation.creator?.name ?? quotation.creator?.email ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Updated At</dt>
              <dd className="font-medium">{new Date(quotation.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Amounts</h2>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium text-right">
                {quotation.currency}{' '}
                {Number(quotation.subtotal).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="font-medium text-right">
                {quotation.currency}{' '}
                {Number(quotation.tax).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div className="flex justify-between border-b border-b-2 font-bold pb-2">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="font-bold text-right text-accent">
                {quotation.currency}{' '}
                {Number(quotation.total).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
          </dl>
        </div>

        {quotation.notes && (
          <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">Notes</h2>
            <p className="text-sm whitespace-pre-wrap">{quotation.notes}</p>
          </div>
        )}
      </div>

      <div className="bg-card p-6 rounded-lg border border-border">
        <h2 className="text-sm font-semibold text-muted-foreground mb-4">Line Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="pb-3 font-medium">Description</th>
                <th className="pb-3 font-medium text-right">Qty</th>
                <th className="pb-3 font-medium text-right">Unit Price</th>
                <th className="pb-3 font-medium text-right">Tax %</th>
                <th className="pb-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    No line items.
                  </td>
                </tr>
              ) : (
                quotation.items.map((item) => (
                  <tr key={item.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4">{item.description}</td>
                    <td className="py-4 text-right">{Number(item.quantity).toLocaleString()}</td>
                    <td className="py-4 text-right">
                      {quotation.currency}{' '}
                      {Number(item.unitPrice).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-4 text-right">{Number(item.taxRate).toFixed(2)}%</td>
                    <td className="py-4 text-right font-medium">
                      {quotation.currency}{' '}
                      {Number(item.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
