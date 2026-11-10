/**
 * AgencyOS Finance Invoices list page.
 *
 * Server component. Loads invoices in-process through the service layer (which
 * performs session validation, `invoice.read` authorization, organization
 * scoping and soft-delete filtering) rather than fetching its own HTTP API.
 *
 * Authorization outcomes are rendered as explicit notices, so a permission
 * failure or a database error can never be mistaken for "no invoices yet".
 */

import Link from 'next/link';

import { listInvoices, type InvoiceResponse } from '@/lib/services/crm/invoice-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

type SortField = 'title' | 'status' | 'total' | 'createdAt' | 'updatedAt' | 'dueDate';

/** Column definition; a `field` makes the column sortable. */
const COLUMNS: Array<{ label: string; field?: SortField; align?: 'right' }> = [
  { label: 'Number' },
  { label: 'Title', field: 'title' },
  { label: 'Status', field: 'status' },
  { label: 'Total', field: 'total', align: 'right' },
  { label: 'Due Date', field: 'dueDate' },
  { label: 'Client' },
  { label: 'Created', field: 'createdAt' },
  { label: 'Actions', align: 'right' },
];

const SORTABLE_FIELDS: SortField[] = [
  'title',
  'status',
  'total',
  'createdAt',
  'updatedAt',
  'dueDate',
];

function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function buildQuery(
  current: Record<string, string>,
  overrides: Record<string, string | number | undefined>
): string {
  const query = new URLSearchParams();
  const merged = { ...current, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === '' || value === null) continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `/finance/invoices?${qs}` : '/finance/invoices';
}

export default async function InvoicesListPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16: searchParams is a Promise; filters/pagination must be read after awaiting it.
  const searchParams = await searchParamsPromise;

  const page = Math.max(1, parseInt(firstString(searchParams.page) || '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(firstString(searchParams.pageSize) || '20', 10) || 20)
  );
  const search = firstString(searchParams.search).trim();
  const status = firstString(searchParams.status);
  const requestedSort = firstString(searchParams.sortBy) as SortField;
  const sortBy: SortField = SORTABLE_FIELDS.includes(requestedSort) ? requestedSort : 'createdAt';
  const sortOrder: 'asc' | 'desc' = firstString(searchParams.sortOrder) === 'asc' ? 'asc' : 'desc';

  const current: Record<string, string> = {
    search,
    status,
    sortBy,
    sortOrder,
    pageSize: String(pageSize),
  };

  const result = await loadPageData(() =>
    listInvoices({
      page,
      pageSize,
      search: search || undefined,
      status: status || undefined,
      sortBy,
      sortOrder,
      includeDeleted: false,
    })
  );

  if (!result.ok) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <PageStateNotice
          reason={result.reason}
          backHref="/dashboard"
          backLabel="Back to dashboard"
        />
      </div>
    );
  }

  const { invoices, total, totalPages } = result.data;
  const hasFilters = Boolean(search || status);
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <Link
          href="/finance/invoices/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Invoice
        </Link>
      </div>

      <form className="flex flex-col sm:flex-row gap-2 max-w-2xl" action="/finance/invoices">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search invoices by number, title, notes..."
          className="flex-1 border border-input rounded-md px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="voided">Voided</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/finance/invoices"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 ml-2"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              {COLUMNS.map((column) => {
                const className = `pb-3 font-medium${column.align === 'right' ? ' text-right' : ''}`;
                if (!column.field) {
                  return (
                    <th key={column.label} className={className}>
                      {column.label}
                    </th>
                  );
                }
                const field = column.field;
                const isActive = sortBy === field;
                const nextOrder = isActive && sortOrder === 'asc' ? 'desc' : 'asc';
                return (
                  <th
                    key={column.label}
                    className={className}
                    aria-sort={
                      isActive ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    <Link
                      href={buildQuery(current, { sortBy: field, sortOrder: nextOrder })}
                      className="hover:text-foreground hover:underline"
                    >
                      {column.label}
                      {isActive ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  {hasFilters
                    ? 'No invoices match these filters.'
                    : 'No invoices yet. Create your first invoice to get started.'}
                </td>
              </tr>
            ) : (
              invoices.map((invoice: InvoiceResponse) => (
                <tr key={invoice.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    <Link
                      href={`/finance/invoices/${invoice.id}`}
                      className="text-accent hover:underline"
                    >
                      {invoice.number}
                    </Link>
                  </td>
                  <td className="py-4">{invoice.title}</td>
                  <td className="py-4">
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
                  </td>
                  <td className="py-4 text-right text-sm font-medium">
                    {invoice.total
                      ? `${invoice.currency} ${Number(invoice.total).toLocaleString()}`
                      : '—'}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-4">
                    {invoice.client ? (
                      <Link
                        href={`/crm/contacts/${invoice.client.id}`}
                        className="text-accent hover:underline text-sm"
                      >
                        {`${invoice.client.firstName ?? ''} ${invoice.client.lastName ?? ''}`.trim() ||
                          'Unnamed Client'}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {new Date(invoice.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right whitespace-nowrap">
                    <Link
                      href={`/finance/invoices/${invoice.id}`}
                      className="text-sm text-accent hover:underline mr-2"
                    >
                      View
                    </Link>
                    {invoice.status === 'draft' || invoice.status === 'sent' ? (
                      <Link
                        href={`/finance/invoices/${invoice.id}/edit`}
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-muted-foreground">
        <span>{total === 0 ? 'No invoices' : `Showing ${firstRow}–${lastRow} of ${total}`}</span>
        {totalPages > 1 && (
          <span className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={buildQuery(current, { page: page - 1 })}
                className="px-3 py-1.5 rounded-md border border-input hover:bg-muted"
              >
                Previous
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-md border border-input opacity-50">
                Previous
              </span>
            )}
            <span>
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildQuery(current, { page: page + 1 })}
                className="px-3 py-1.5 rounded-md border border-input hover:bg-muted"
              >
                Next
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-md border border-input opacity-50">Next</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
