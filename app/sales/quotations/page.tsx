/**
 * AgencyOS Sales Quotations List page.
 * Server component that lists quotations for the current organization.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listQuotations } from '@/lib/services/crm/quotation-service';

export default async function QuotationsListPage({
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

  const { quotations, total, totalPages } = await listQuotations({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    sortBy: sortBy as 'title' | 'status' | 'total' | 'createdAt' | 'updatedAt',
    sortOrder: sortOrder as 'asc' | 'desc',
    includeDeleted: false,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Quotations</h1>
        <Link
          href="/sales/quotations/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Quotation
        </Link>
      </div>

      <form className="flex flex-col sm:flex-row gap-2 max-w-2xl" action="">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search quotations by title, number, notes..."
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
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {(search || status) && (
          <Link
            href="/sales/quotations"
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
              <th className="pb-3 font-medium">Contact</th>
              <th className="pb-3 font-medium text-right">Total</th>
              <th className="pb-3 font-medium w-24">Valid Until</th>
              <th className="pb-3 font-medium w-24">Created</th>
              <th className="pb-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {quotations.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  No quotations found. Create a quotation to get started.
                </td>
              </tr>
            ) : (
              quotations.map(
                (quotation: {
                  id: string;
                  number: string;
                  title: string;
                  status: string;
                  total: string;
                  currency: string;
                  contactId: string | null;
                  validUntil: Date | null;
                  contact: { id: string; firstName: string | null; lastName: string } | null;
                  createdAt: Date;
                }) => (
                  <tr key={quotation.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">
                      <Link
                        href={`/sales/quotations/${quotation.id}`}
                        className="text-accent hover:underline"
                      >
                        {quotation.number}
                      </Link>
                    </td>
                    <td className="py-4">{quotation.title}</td>
                    <td className="py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                          quotation.status === 'accepted'
                            ? 'bg-green-100 text-green-800'
                            : quotation.status === 'rejected'
                              ? 'bg-red-100 text-red-800'
                              : quotation.status === 'sent'
                                ? 'bg-blue-100 text-blue-800'
                                : quotation.status === 'expired'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {quotation.status}
                      </span>
                    </td>
                    <td className="py-4">
                      {quotation.contact ? (
                        <Link
                          href={`/crm/contacts/${quotation.contact.id}`}
                          className="text-accent hover:underline text-sm"
                        >
                          {`${quotation.contact.firstName ?? ''} ${quotation.contact.lastName ?? ''}`.trim() ||
                            'Unnamed Contact'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="py-4 text-right text-sm font-medium">
                      {quotation.total
                        ? `${quotation.currency} ${Number(quotation.total).toLocaleString()}`
                        : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {quotation.validUntil
                        ? new Date(quotation.validUntil).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(quotation.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 text-right">
                      <Link
                        href={`/sales/quotations/${quotation.id}`}
                        className="text-sm text-accent hover:underline mr-2"
                      >
                        View
                      </Link>
                      {quotation.status === 'draft' || quotation.status === 'sent' ? (
                        <Link
                          href={`/sales/quotations/${quotation.id}/edit`}
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
