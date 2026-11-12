'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BentoQuotationsView, type QuotationItem } from '@/components/sales/bento-quotations-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface QuotationsClientProps {
  quotations: QuotationItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
}

export function QuotationsClient({
  quotations,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
}: QuotationsClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [searchInput, setSearchInput] = React.useState(searchVal);

  const updateFilters = (newSearch: string, newStatus: string) => {
    const query = new URLSearchParams();
    if (newSearch) query.set('search', newSearch);
    if (newStatus) query.set('status', newStatus);
    query.set('page', '1');
    router.push(`/sales/quotations?${query.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters(searchInput, statusFilter);
  };

  if (isBento) {
    return (
      <BentoQuotationsView
        quotations={quotations}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={searchVal}
        statusFilter={statusFilter}
        onSearchChange={(val) => updateFilters(val, statusFilter)}
        onStatusFilterChange={(st) => updateFilters(searchVal, st)}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Quotations</h1>
        <Button asChild>
          <Link href="/sales/quotations/new">New Quotation</Link>
        </Button>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search quotations by title or notes..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search quotations"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => updateFilters(searchVal, e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {(searchVal || statusFilter) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => updateFilters('', '')}>
            Clear
          </Button>
        )}
      </form>

      <div className="overflow-x-auto border rounded-lg bg-card">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="p-3 font-medium">Number</th>
              <th className="p-3 font-medium">Title</th>
              <th className="p-3 font-medium">Contact</th>
              <th className="p-3 font-medium">Opportunity</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Total</th>
              <th className="p-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {quotations.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No quotations found.
                </td>
              </tr>
            ) : (
              quotations.map((quotation) => (
                <tr key={quotation.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-mono text-xs">{quotation.number}</td>
                  <td className="p-3 font-medium">{quotation.title}</td>
                  <td className="p-3 text-muted-foreground">
                    {quotation.contact
                      ? `${quotation.contact.firstName ?? ''} ${quotation.contact.lastName ?? ''}`.trim() ||
                        '—'
                      : '—'}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {quotation.opportunity?.title ?? '—'}
                  </td>
                  <td className="p-3 capitalize">{quotation.status}</td>
                  <td className="p-3 text-right font-medium">
                    {quotation.currency} {Number(quotation.total).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/sales/quotations/${quotation.id}`}
                      className="text-accent hover:underline text-sm font-medium"
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
