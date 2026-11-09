/**
 * AgencyOS CRM Leads page.
 * Server component that lists leads for the current organization.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listLeads } from '@/lib/services/crm/lead-service';

export default async function LeadsPage({
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
  const priority = String(searchParams.priority ?? '');

  const { leads, total, totalPages } = await listLeads({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    priority: priority || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    includeDeleted: false,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Leads</h1>
        <Link
          href="/crm/leads/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Lead
        </Link>
      </div>

      <form className="flex flex-col sm:flex-row gap-2 max-w-2xl" action="">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search leads by source, status, priority, notes..."
          className="flex-1 border border-input rounded-md px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option>
          <option value="proposal">Proposal Sent</option>
          <option value="negotiation">Negotiation</option>
          <option value="closed-won">Closed Won</option>
          <option value="closed-lost">Closed Lost</option>
        </select>
        <select
          name="priority"
          defaultValue={priority}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {(search || status || priority) && (
          <Link
            href="/crm/leads"
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
              <th className="pb-3 font-medium">Source</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Priority</th>
              <th className="pb-3 font-medium">Contact</th>
              <th className="pb-3 font-medium">Account</th>
              <th className="pb-3 font-medium">Owner</th>
              <th className="pb-3 font-medium text-right">Expected Value</th>
              <th className="pb-3 font-medium">Converted</th>
              <th className="pb-3 font-medium w-24">Created</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-muted-foreground">
                  No leads found. Create a lead to get started.
                </td>
              </tr>
            ) : (
              leads.map(
                (lead: {
                  id: string;
                  source: string;
                  status: string;
                  priority: string | null;
                  expectedValue: string | null;
                  contactId: string | null;
                  accountId: string | null;
                  ownerId: string | null;
                  contact: { id: string; firstName: string | null; lastName: string } | null;
                  account: { id: string; name: string } | null;
                  convertedOpportunity: {
                    id: string;
                    title: string;
                    status: string;
                    value: string | null;
                    currency: string;
                    createdAt: Date;
                  } | null;
                  createdAt: Date;
                }) => (
                  <tr key={lead.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">{lead.source}</td>
                    <td className="py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                          lead.status === 'closed-won'
                            ? 'bg-green-100 text-green-800'
                            : lead.status === 'closed-lost'
                              ? 'bg-red-100 text-red-800'
                              : lead.status === 'qualified'
                                ? 'bg-blue-100 text-blue-800'
                                : lead.status === 'contacted'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="py-4">
                      {lead.priority ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                            lead.priority === 'high'
                              ? 'bg-red-100 text-red-800'
                              : lead.priority === 'medium'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {lead.priority}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-4">
                      {lead.contact ? (
                        <Link
                          href={`/crm/contacts/${lead.contact.id}`}
                          className="text-accent hover:underline text-sm"
                        >
                          {`${lead.contact.firstName ?? ''} ${lead.contact.lastName}`.trim() ||
                            'Unnamed Contact'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="py-4">
                      {lead.account ? (
                        <Link
                          href={`/crm/accounts/${lead.account.id}`}
                          className="text-accent hover:underline text-sm"
                        >
                          {lead.account.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="py-4">
                      {lead.ownerId ? (
                        <span className="text-sm">Assigned</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Unassigned</span>
                      )}
                    </td>
                    <td className="py-4 text-right text-sm font-medium">
                      {lead.expectedValue ? `$${Number(lead.expectedValue).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-4">
                      {lead.convertedOpportunity ? (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleDateString()}
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
