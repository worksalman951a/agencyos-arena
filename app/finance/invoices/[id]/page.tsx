/**
 * AgencyOS Finance Invoice Detail page.
 * Displays a single invoice with line items, payments, and PDF export.
 */

import Link from 'next/link';
import { getInvoice } from '@/lib/services/crm/invoice-service';
import { getCurrentPermissions } from '@/lib/current-user';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ExportPdfButton } from '@/components/invoices/export-pdf-button';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await loadPageData(() => getInvoice(id));

  if (!result.ok) {
    return (
      <div className="space-y-6 p-6">
        <DocumentBrandHeader />
        <h1 className="text-2xl font-bold">Invoice</h1>
        <PageStateNotice
          reason={result.reason}
          backHref="/finance/invoices"
          backLabel="Back to invoices"
        />
      </div>
    );
  }

  const invoice = result.data;

  // Permission-aware actions: never offer an edit the service would reject.
  const permissions = await getCurrentPermissions();
  const canUpdate = permissions.has('invoice.update');
  const isEditable = canUpdate && (invoice.status === 'draft' || invoice.status === 'sent');

  const clientName = invoice.client
    ? `${invoice.client.firstName ?? ''} ${invoice.client.lastName ?? ''}`.trim() ||
      'Unnamed Client'
    : 'Unnamed Client';

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invoice {invoice.number}</h1>
          <p className="text-muted-foreground">{invoice.title}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/finance/invoices"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Invoices
          </Link>
          {isEditable ? (
            <Link
              href={`/finance/invoices/${invoice.id}/edit`}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/80"
            >
              Edit
            </Link>
          ) : null}
          <ExportPdfButton invoiceId={id} />
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
                <dd className="font-medium">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                      invoice.status === 'paid'
                        ? 'bg-green-100 text-green-800'
                        : invoice.status === 'voided'
                          ? 'bg-red-100 text-red-800'
                          : invoice.status === 'sent'
                            ? 'bg-blue-100 text-blue-800'
                            : invoice.status === 'overdue'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {invoice.status}
                  </span>
                </dd>
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

      {invoice.notes && (
        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Notes</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
        </div>
      )}

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
              {invoice.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    No line items.
                  </td>
                </tr>
              ) : (
                invoice.items.map((item) => (
                  <tr key={item.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4">{item.description}</td>
                    <td className="py-4 text-right">{item.quantity}</td>
                    <td className="py-4 text-right">{item.unitPrice}</td>
                    <td className="py-4 text-right">{item.taxRate}%</td>
                    <td className="py-4 text-right font-medium">{item.amount}</td>
                  </tr>
                ))
              )}
              <tr className="border-t border-border font-bold">
                <td colSpan={4} className="py-4 text-right">
                  Total
                </td>
                <td className="py-4 text-right">{invoice.total}</td>
              </tr>
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
                <th className="pb-3 font-medium text-right">Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    No payments recorded yet.
                  </td>
                </tr>
              ) : (
                invoice.payments.map((p) => (
                  <tr
                    key={p.createdAt.toISOString()}
                    className="border-b border-border hover:bg-muted/50"
                  >
                    <td className="py-4">
                      {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-4">{p.method}</td>
                    <td className="py-4 text-right">{p.amount}</td>
                    <td className="py-4">{p.reference ?? '—'}</td>
                    <td className="py-4 text-right text-sm text-muted-foreground">
                      {p.recordedBy ?? '—'}
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
