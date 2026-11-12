'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import { QuotationActions } from './QuotationActions';
import {
  BentoQuotationRecordView,
  type QuotationDetailData,
} from '@/components/sales/bento-quotation-record-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface QuotationDetailClientProps {
  quotation: QuotationDetailData;
}

export function QuotationDetailClient({ quotation }: QuotationDetailClientProps) {
  const isBento = useBentoShell();
  const EDITABLE_STATUSES = ['draft', 'sent'];
  const contactName = quotation.contact
    ? `${quotation.contact.firstName ?? ''} ${quotation.contact.lastName ?? ''}`.trim() ||
      'Unnamed Contact'
    : null;

  if (isBento) {
    return (
      <BentoQuotationRecordView
        quotation={quotation}
        actionsNode={<QuotationActions quotationId={quotation.id} status={quotation.status} />}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
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
            documentId={quotation.id}
            number={quotation.number}
            title={quotation.title}
            status={quotation.status}
            currency={quotation.currency}
            createdAt={quotation.createdAt}
            validUntil={quotation.validUntil}
            clientName={contactName}
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
          {EDITABLE_STATUSES.includes(quotation.status) && (
            <Button asChild variant="outline">
              <Link href={`/sales/quotations/builder/${quotation.id}`}>Edit</Link>
            </Button>
          )}
          <QuotationActions quotationId={quotation.id} status={quotation.status} />
          <Button asChild variant="outline">
            <Link href="/sales/quotations">Back</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Metadata</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Number</dt>
              <dd className="font-mono font-medium">{quotation.number}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium capitalize">{quotation.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd>{new Date(quotation.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valid Until</dt>
              <dd>
                {quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString() : '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Linked CRM</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Opportunity</dt>
              <dd>
                {quotation.opportunity ? (
                  <Link
                    href={`/crm/opportunities/${quotation.opportunity.id}`}
                    className="text-accent hover:underline font-medium"
                  >
                    {quotation.opportunity.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Contact</dt>
              <dd>
                {quotation.contact ? (
                  <Link
                    href={`/crm/contacts/${quotation.contact.id}`}
                    className="text-accent hover:underline font-medium"
                  >
                    {contactName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Financial Summary</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Subtotal</dt>
              <dd className="font-mono font-medium">
                {quotation.currency}{' '}
                {Number(quotation.subtotal).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tax</dt>
              <dd className="font-mono font-medium">
                {quotation.currency}{' '}
                {Number(quotation.tax).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div className="pt-2 border-t">
              <dt className="text-xs text-muted-foreground font-semibold">Total</dt>
              <dd className="font-mono text-lg font-bold">
                {quotation.currency}{' '}
                {Number(quotation.total).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="bg-card p-6 rounded-lg border border-border space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Line Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Description</th>
                <th className="pb-2 font-medium text-right">Qty</th>
                <th className="pb-2 font-medium text-right">Unit Price</th>
                <th className="pb-2 font-medium text-right">Tax Rate</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <td className="py-2.5 font-medium">{item.description}</td>
                  <td className="py-2.5 text-right font-mono">{Number(item.quantity)}</td>
                  <td className="py-2.5 text-right font-mono">
                    {quotation.currency} {Number(item.unitPrice).toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right font-mono">{Number(item.taxRate)}%</td>
                  <td className="py-2.5 text-right font-mono font-medium">
                    {quotation.currency} {Number(item.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {quotation.notes && (
        <div className="bg-card p-6 rounded-lg border border-border space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Notes</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quotation.notes}</p>
        </div>
      )}
    </div>
  );
}
