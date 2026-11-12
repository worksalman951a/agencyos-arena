'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoEstimatesView } from '@/components/finance/bento-estimates-view';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';

interface EstimatesClientProps {
  estimates: EstimateResponse[];
}

export function EstimatesClient({ estimates }: EstimatesClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoEstimatesView estimates={estimates} />;
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
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
              <th className="pb-3 font-medium w-28">Valid Until</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium text-right w-40">Actions</th>
            </tr>
          </thead>
          <tbody>
            {estimates.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No estimates found. Create an estimate to get started.
                </td>
              </tr>
            ) : (
              estimates.map((estimate) => {
                const clientName = estimate.client
                  ? `${estimate.client.firstName ?? ''} ${estimate.client.lastName ?? ''}`.trim() ||
                    estimate.client.email ||
                    'Unnamed Contact'
                  : null;
                return (
                  <tr key={estimate.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">
                      <Link
                        href={`/finance/estimates/${estimate.id}`}
                        className="text-accent hover:underline"
                      >
                        {estimate.number}
                      </Link>
                    </td>
                    <td className="py-4">
                      {estimate.clientId ? (
                        <Link
                          href={`/crm/contacts/${estimate.clientId}`}
                          className="text-accent hover:underline"
                        >
                          {clientName ?? estimate.clientId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
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
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {estimate.status}
                      </span>
                    </td>
                    <td className="py-4 text-right font-medium">
                      {estimate.currency} {Number(estimate.total).toLocaleString()}
                    </td>
                    <td className="py-4">
                      {estimate.validUntil
                        ? new Date(estimate.validUntil).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="py-4 text-right text-muted-foreground">
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
                          className="text-sm text-muted-foreground hover:text-accent transition-colors mr-2"
                        >
                          Edit
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
