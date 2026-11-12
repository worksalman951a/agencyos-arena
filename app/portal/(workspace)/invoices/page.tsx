/**
 * Portal invoices — requires the `viewInvoices` capability, enforced by the
 * service. Payment status is read-only: no payment gateway is integrated, so the
 * portal never accepts money or mutates an invoice.
 */

import { listPortalInvoices } from '@/lib/services/portal/portal-workspace-service';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

export default async function PortalInvoicesPage() {
  const result = await loadPortalPageData(() => listPortalInvoices());

  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border p-4 text-sm">
        Invoice access is not enabled for this account.
      </div>
    );
  }

  const invoices = result.data;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Invoices</h2>
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices have been shared with you.</p>
      ) : (
        <ul className="space-y-3">
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="rounded-lg border bg-background p-4"
              data-testid={`invoice-${invoice.number}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {invoice.number}
                  </p>
                  <h3 className="text-lg font-semibold">{invoice.title}</h3>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs uppercase text-muted-foreground">
                  {invoice.status}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd>{`${invoice.currency} ${invoice.total}`}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Outstanding</dt>
                  <dd>{`${invoice.currency} ${invoice.outstanding}`}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Due</dt>
                  <dd>{invoice.dueDate ? invoice.dueDate.toLocaleDateString() : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Payments</dt>
                  <dd>{invoice.payments.length}</dd>
                </div>
              </dl>
              {invoice.payments.length > 0 ? (
                <ul className="mt-2 text-xs text-muted-foreground">
                  {invoice.payments.map((payment, index) => (
                    <li key={`${invoice.id}-payment-${index}`}>
                      {payment.amount} on {payment.paidAt.toLocaleDateString()} ({payment.method})
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Online payment is not enabled. Please settle invoices using the method agreed with your
        agency.
      </p>
    </div>
  );
}
