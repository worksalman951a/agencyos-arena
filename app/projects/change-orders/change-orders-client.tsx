'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoChangeOrdersView } from '@/components/projects/bento-change-orders-view';
import type { ChangeOrderResponse } from '@/lib/services/projects/change-order-service';

interface ChangeOrdersClientProps {
  changeOrders: ChangeOrderResponse[];
  projectId?: string;
  totalApprovedAmount: number;
}

export function ChangeOrdersClient({
  changeOrders,
  projectId,
  totalApprovedAmount,
}: ChangeOrdersClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoChangeOrdersView changeOrders={changeOrders} projectId={projectId} />;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Change Orders</h1>
          <p className="text-sm text-muted-foreground">
            Approved scope additions total: $
            {totalApprovedAmount.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {projectId && (
            <Link
              href={`/projects/${projectId}`}
              className="px-4 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Back to Project
            </Link>
          )}
          <Link
            href={
              projectId
                ? `/projects/change-orders/new?projectId=${encodeURIComponent(projectId)}`
                : '/projects/change-orders/new'
            }
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Change Order
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Project</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium text-right">Amount</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Approved By</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-24 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {changeOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No change orders found.
                </td>
              </tr>
            ) : (
              changeOrders.map((co) => (
                <tr key={co.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 text-sm font-medium">
                    <Link
                      href={`/projects/${co.projectId}`}
                      className="text-accent hover:underline"
                    >
                      {co.project?.name ?? co.projectId}
                    </Link>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground max-w-xs truncate">
                    {co.description}
                  </td>
                  <td className="py-4 text-right text-sm font-mono">
                    ${Number(co.amount).toFixed(2)}
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
                  <td className="py-4 text-sm text-muted-foreground">
                    {co.approver?.name ?? co.approver?.email ?? co.approvedBy ?? '—'}
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
