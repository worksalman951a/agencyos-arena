/**
 * AgencyOS Finance Invoices List page.
 * Server component that lists invoices for the current organization.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listInvoices } from '@/lib/services/crm/invoice-service';

export default async function InvoicesListPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16: searchParams is a Promise; filters/pagination must be read after awaiting it.
  const searchParams = await searchParamsPromise;
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const page = Math.max(1, parseInt(String(searchParams.page ?? '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(searchParams.pageSize ?? '20'), 10)));
  const search = String(searchParams.search ?? '');
  const status = String(searchParams.status ?? '');
  const sortBy = String(searchParams.sortBy ?? 'createdAt');
  const sortOrder = String(searchParams.sortOrder ?? 'desc');

  const { invoices, total, totalPages } = await listInvoices({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    sortBy: sortBy as 'title' | 'status' | 'total' | 'createdAt' | 'updatedAt' | 'dueDate',
    sortOrder: sortOrder as 'asc' | 'desc',
    includeDeleted: false,
  });

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

      <form className="flex flex-col sm:flex-row gap-2 max-w-2xl" action="">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search invoices by number, title, client..."
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
        {(search || status) && (
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
              <th className="pb-3 font-medium">Number</th>
              <th className="pb-3 font-medium">Title</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Client</th>
              <th className="pb-3 font-medium text-right">Total</th>
              <th className="pb-3 font-medium w-24">Due Date</th>
              <th className="pb-3 font-medium w-24">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  No invoices found. Create an invoice to get started.
                </td>
              </tr>
            ) : (
              invoices.map(
                (invoice: {
                  id: string;
                  number: string;
                  title: string;
                  status: string;
                  total: string;
                  currency: string;
                  dueDate: Date | null;
                  client: { id: string; firstName: string | null; lastName: string } | null;
                  createdAt: Date;
                }) => (
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
                    <td className="py-4 text-right text-sm font-medium">
                      {invoice.total
                        ? `${invoice.currency} ${Number(invoice.total).toLocaleString()}`
                        : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(invoice.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 text-right">
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
                )
              )
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
