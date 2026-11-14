'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoInvoicesView } from '@/components/finance/bento-invoices-view';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';

export interface InvoiceProjectFilterOption {
  id: string;
  name: string;
  archived: boolean;
}

interface InvoicesClientProps {
  invoices: InvoiceResponse[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  projectIdFilter?: string;
  /** Project filter options, already authorized and tenant-scoped by the server. */
  projectOptions?: InvoiceProjectFilterOption[];
  sortBy: string;
  sortOrder: string;
}

export function InvoicesClient(props: InvoicesClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBento = useBentoShell();
  const [searchInput, setSearchInput] = React.useState(props.searchVal);

  // Keep the input in sync when the server sends a different `search` back
  // (back/forward navigation, or a request that changes the filters).
  const [prevSearchVal, setPrevSearchVal] = React.useState(props.searchVal);
  if (prevSearchVal !== props.searchVal) {
    setPrevSearchVal(props.searchVal);
    setSearchInput(props.searchVal);
  }

  /**
   * Filter changes are navigations, not client state.
   *
   * The invoice list is loaded, authorized and tenant-scoped on the server
   * (see `page.tsx`; `listInvoices` validates the session, requires
   * `invoice.read` and scopes to the caller's organization). The client therefore
   * only rewrites the query string: `router.push` re-runs the Server Component,
   * which re-queries with the new filters. Nothing is filtered in the browser, so
   * a filter can never widen the set of invoices the server returned.
   *
   * Every other query parameter (`projectId`, `clientId`, `pageSize`, `sortBy`,
   * `sortOrder`, ...) is carried over, so changing the search or status never
   * silently drops a narrower context the user navigated in with. Pagination is
   * reset because the current page belongs to the previous result set.
   */
  const updateFilters = (changes: { search?: string; status?: string; projectId?: string }) => {
    const query = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }

    // The current page belongs to the previous result set.
    query.set('page', '1');

    // Clearing the last filter leaves the bare list URL, not a stray `?page=1`.
    const queryString = query.toString();
    router.push(
      queryString === 'page=1' ? '/finance/invoices' : `/finance/invoices?${queryString}`
    );
  };

  const onSearchChange = (search: string) => updateFilters({ search });
  const onStatusFilterChange = (status: string) => updateFilters({ status });
  const onProjectFilterChange = (projectId: string) => updateFilters({ projectId });

  if (isBento) {
    return (
      <BentoInvoicesView
        {...props}
        onSearchChange={onSearchChange}
        onStatusFilterChange={onStatusFilterChange}
        onProjectFilterChange={onProjectFilterChange}
      />
    );
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

      {/* Filters navigate (see updateFilters); the server still decides what is loaded. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearchChange(searchInput);
        }}
        className="flex flex-col sm:flex-row gap-2 max-w-2xl"
      >
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search invoices by number, title, or client..."
          aria-label="Search invoices"
          className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          aria-label="Filter invoices by status"
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="voided">Voided</option>
        </select>
        <select
          value={props.projectIdFilter ?? ''}
          onChange={(e) => onProjectFilterChange(e.target.value)}
          aria-label="Filter by project"
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All Projects</option>
          {(props.projectOptions ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.archived ? `${project.name} (archived)` : project.name}
            </option>
          ))}
          {/* Keep a URL-only project visible instead of silently showing no filter. */}
          {props.projectIdFilter &&
            !(props.projectOptions ?? []).some((p) => p.id === props.projectIdFilter) && (
              <option value={props.projectIdFilter}>Unavailable project</option>
            )}
        </select>
        <button
          type="submit"
          className="px-4 py-2 rounded-md text-sm font-medium bg-muted hover:bg-muted/80"
        >
          Filter
        </button>
        {(searchVal || statusFilter || props.projectIdFilter) && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              updateFilters({ search: '', status: '', projectId: '' });
            }}
            className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </form>

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
