'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoInvoicesView } from '@/components/finance/bento-invoices-view';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';

interface InvoicesClientProps {
  invoices: InvoiceResponse[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  projectIdFilter?: string;
  sortBy: string;
  sortOrder: string;
  onSearchChange: (search: string) => void;
  onStatusFilterChange: (status: string) => void;
}

export function InvoicesClient(props: InvoicesClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoInvoicesView {...props} />;
  }

  // Legacy Presentation
  const { invoices, total, totalPages, page, searchVal, statusFilter } = props;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-muted-foreground">
            Manage billing, track paid and overdue invoices, and record incoming payments.
          </p>
        </div>
        <Link
          href="/finance/invoices/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Invoice
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Number</th>
              <th className="pb-3 font-medium">Title</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Total</th>
              <th className="pb-3 font-medium">Due Date</th>
              <th className="pb-3 font-medium">Client</th>
              <th className="pb-3 font-medium">Created</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  {searchVal || statusFilter
                    ? 'No invoices match your search filters.'
                    : 'No invoices found. Create your first invoice to get started.'}
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    <Link
                      href={`/finance/invoices/${inv.id}`}
                      className="text-accent hover:underline"
                    >
                      {inv.number}
                    </Link>
                  </td>
                  <td className="py-4">{inv.title}</td>
                  <td className="py-4 capitalize">{inv.status}</td>
                  <td className="py-4 text-right font-medium">
                    {inv.currency} {inv.total}
                  </td>
                  <td className="py-4">
                    {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-4">
                    {inv.client
                      ? `${inv.client.firstName ?? ''} ${inv.client.lastName ?? ''}`.trim() ||
                        'Client'
                      : '—'}
                  </td>
                  <td className="py-4">{new Date(inv.createdAt).toLocaleDateString()}</td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/finance/invoices/${inv.id}`}
                      className="text-sm text-accent hover:underline mr-2"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages} ({total} total)
        </div>
      )}
    </div>
  );
}
