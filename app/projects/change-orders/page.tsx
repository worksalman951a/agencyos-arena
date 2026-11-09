/**
 * AgencyOS Change Orders page.
 * Lists change orders across the organization's projects.
 */

import Link from 'next/link';
import { listChangeOrders } from '@/lib/services/projects/change-order-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function ChangeOrdersPage() {
  const result = await loadPageData(() => listChangeOrders());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const changeOrders = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Change Orders</h1>
        <Link
          href="/projects/change-orders/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Change Order
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium text-right">Amount</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(
              changeOrders as Array<{
                id: string;
                description: string;
                amount: string;
                status: string;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No change orders found.
                </td>
              </tr>
            ) : (
              (
                changeOrders as Array<{
                  id: string;
                  description: string;
                  amount: string;
                  status: string;
                  createdAt: Date;
                }>
              ).map((co) => (
                <tr key={co.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{co.description}</td>
                  <td className="py-4 text-right text-sm font-medium">
                    ${Number(co.amount).toLocaleString()}
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        co.status === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : co.status === 'rejected'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {co.status}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(co.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/projects/change-orders/${co.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      Edit
                    </Link>
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
