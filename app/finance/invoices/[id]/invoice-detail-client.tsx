'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoInvoiceRecordView } from '@/components/finance/bento-invoice-record-view';
import { ExportPdfButton } from '@/components/invoices/export-pdf-button';
import { Button } from '@/components/ui/button';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';

interface InvoiceDetailClientProps {
  invoice: InvoiceResponse;
  canUpdate: boolean;
  isEditable: boolean;
}

export function InvoiceDetailClient({ invoice, canUpdate, isEditable }: InvoiceDetailClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <BentoInvoiceRecordView invoice={invoice} canUpdate={canUpdate} isEditable={isEditable} />
    );
  }

  // Legacy Presentation
  const clientName = invoice.client
    ? `${invoice.client.firstName ?? ''} ${invoice.client.lastName ?? ''}`.trim() ||
      'Unnamed Client'
    : 'Unnamed Client';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invoice {invoice.number}</h1>
          <p className="text-muted-foreground">{invoice.title}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/finance/invoices">Back to Invoices</Link>
          </Button>
          {isEditable && (
            <Button asChild variant="outline">
              <Link href={`/finance/invoices/${invoice.id}/edit`}>Edit</Link>
            </Button>
          )}
          <ExportPdfButton invoiceId={invoice.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="col-span-1 md:col-span-2">
          <div className="rounded-md border bg-background p-4">
            <h2 className="text-lg font-semibold mb-2">Client</h2>
            <p className="text-sm text-muted-foreground">{clientName}</p>
            {invoice.clientId && (
              <Link
                href={`/crm/contacts/${invoice.clientId}`}
                className="text-accent hover:underline text-sm mt-1 inline-block"
              >
                Open client record
              </Link>
            )}
          </div>
        </div>
        <div className="col-span-1 md:col-span-1">
          <div className="rounded-md border bg-background p-4">
            <h2 className="text-lg font-semibold mb-2">Summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium capitalize">{invoice.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Currency</dt>
                <dd className="font-medium">{invoice.currency}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Due date</dt>
                <dd className="font-medium">
                  {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}
                </dd>
              </div>
              <div className="flex justify-between pt-2 border-t border-border">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-medium text-right">{invoice.subtotal}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="font-medium text-right">{invoice.tax}</dd>
              </div>
              <div className="flex justify-between font-bold">
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-bold text-right">{invoice.total}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold mb-2">Line Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th className="pb-3 font-medium">Description</th>
                <th className="pb-3 font-medium text-right">Qty</th>
                <th className="pb-3 font-medium text-right">Unit Price</th>
                <th className="pb-3 font-medium text-right">Tax Rate</th>
                <th className="pb-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4">{item.description}</td>
                  <td className="py-4 text-right">{item.quantity}</td>
                  <td className="py-4 text-right">{item.unitPrice}</td>
                  <td className="py-4 text-right">{item.taxRate}%</td>
                  <td className="py-4 text-right font-medium">{item.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <span>Payments</span>
          {invoice.payments.length === 0 ? (
            <span className="text-xs text-muted-foreground">No payments recorded</span>
          ) : null}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Method</th>
                <th className="pb-3 font-medium text-right">Amount</th>
                <th className="pb-3 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((p, idx) => (
                <tr key={idx} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4">
                    {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-4">{p.method}</td>
                  <td className="py-4 text-right">{p.amount}</td>
                  <td className="py-4">{p.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
