/**
 * AgencyOS Finance Estimates List page.
 * Server component that lists estimates for the current organization.
 */

import Link from 'next/link';
import { listEstimates } from '@/lib/services/crm/estimate-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function EstimatesListPage() {
  const result = await loadPageData(() => listEstimates());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const estimates = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Estimates</h1>
        <Link
          href="/finance/estimates/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Estimate
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Number</th>
              <th className="pb-3 font-medium">Client</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Total</th>
              <th className="pb-3 font-medium w-24">Valid Until</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(
              estimates as Array<{
                id: string;
                number: string;
                clientId: string;
                status: string;
                total: string;
                currency: string;
                validUntil: Date | null;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No estimates found. Create an estimate to get started.
                </td>
              </tr>
            ) : (
              (
                estimates as Array<{
                  id: string;
                  number: string;
                  clientId: string;
                  status: string;
                  total: string;
                  currency: string;
                  validUntil: Date | null;
                  createdAt: Date;
                }>
              ).map((estimate) => (
                <tr key={estimate.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    <Link
                      href={`/finance/estimates/${estimate.id}`}
                      className="text-accent hover:underline"
                    >
                      {estimate.number}
                    </Link>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">{estimate.clientId}</td>
                  <td className="py-4">
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
                  </td>
                  <td className="py-4 text-right text-sm font-medium">
                    {estimate.currency} {Number(estimate.total).toLocaleString()}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(estimate.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/finance/estimates/${estimate.id}`}
                      className="text-sm text-accent hover:underline mr-2"
                    >
                      View
                    </Link>
                    {estimate.status === 'draft' || estimate.status === 'sent' ? (
                      <Link
                        href={`/finance/estimates/${estimate.id}/edit`}
                        className="text-sm text-muted-foreground hover:text-accent transition-colors"
                      >
                        Edit
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
