/**
 * AgencyOS Sales Proposal Detail page.
 * Server component that shows proposal details with line items.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getProposal } from '@/lib/services/crm/proposal-service';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const proposal = await getProposal(id);

  const EDITABLE_STATUSES = ['draft', 'sent'];

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{proposal.title}</h1>
          <p className="text-muted-foreground">
            #{proposal.number} &bull; {proposal.status} &bull; {proposal.currency}{' '}
            {Number(proposal.total).toLocaleString()} &bull;
            {proposal.validUntil ? new Date(proposal.validUntil).toLocaleDateString() : 'No expiry'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/sales/proposals/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Proposal
          </Link>
          {EDITABLE_STATUSES.includes(proposal.status) && (
            <Link
              href={`/sales/proposals/${proposal.id}/edit`}
              className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Edit
            </Link>
          )}
          <Link
            href="/sales/proposals"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Proposals
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Proposal Details</h2>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                    proposal.status === 'accepted'
                      ? 'bg-green-100 text-green-800'
                      : proposal.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : proposal.status === 'sent'
                          ? 'bg-blue-100 text-blue-800'
                          : proposal.status === 'expired'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {proposal.status}
                </span>
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Document Number</dt>
              <dd className="font-medium">{proposal.number}</dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Currency</dt>
              <dd className="font-medium">{proposal.currency}</dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Valid Until</dt>
              <dd className="font-medium">
                {proposal.validUntil ? new Date(proposal.validUntil).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Created By</dt>
              <dd className="font-medium">
                {proposal.creator?.name ?? proposal.creator?.email ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Updated At</dt>
              <dd className="font-medium">{new Date(proposal.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Amounts</h2>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium text-right">
                {proposal.currency}{' '}
                {Number(proposal.subtotal).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="font-medium text-right">
                {proposal.currency}{' '}
                {Number(proposal.tax).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div className="flex justify-between border-b border-b-2 font-bold pb-2">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="font-bold text-right text-accent">
                {proposal.currency}{' '}
                {Number(proposal.total).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
          </dl>
        </div>

        {proposal.notes && (
          <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">Notes</h2>
            <p className="text-sm whitespace-pre-wrap">{proposal.notes}</p>
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
              {proposal.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    No line items.
                  </td>
                </tr>
              ) : (
                proposal.items.map(
                  (item: {
                    id: string;
                    description: string;
                    quantity: string;
                    unitPrice: string;
                    taxRate: string;
                    amount: string;
                    sortOrder: number;
                  }) => (
                    <tr key={item.id} className="border-b border-border hover:bg-muted/50">
                      <td className="py-4">{item.description}</td>
                      <td className="py-4 text-right">{Number(item.quantity).toLocaleString()}</td>
                      <td className="py-4 text-right">
                        {proposal.currency}{' '}
                        {Number(item.unitPrice).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="py-4 text-right">{Number(item.taxRate).toFixed(2)}%</td>
                      <td className="py-4 text-right font-medium">
                        {proposal.currency}{' '}
                        {Number(item.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
