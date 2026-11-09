/**
 * AgencyOS CRM Opportunities page.
 * Server component that lists opportunities for the current organization.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listOpportunities } from '@/lib/services/crm/opportunity-service';

export default async function OpportunitiesPage({
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
  const pipelineId = String(searchParams.pipelineId ?? '');
  const stageId = String(searchParams.stageId ?? '');

  const { opportunities, total, totalPages } = await listOpportunities({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    pipelineId: pipelineId || undefined,
    stageId: stageId || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    includeDeleted: false,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Opportunities</h1>
        <Link
          href="/crm/opportunities/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Opportunity
        </Link>
      </div>

      <form className="flex flex-col sm:flex-row gap-2 max-w-2xl" action="">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search opportunities by title, description, status..."
          className="flex-1 border border-input rounded-md px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="archived">Archived</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {(search || status || pipelineId || stageId) && (
          <Link
            href="/crm/opportunities"
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
              <th className="pb-3 font-medium">Title</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Pipeline / Stage</th>
              <th className="pb-3 font-medium">Contact</th>
              <th className="pb-3 font-medium">Account</th>
              <th className="pb-3 font-medium">Owner</th>
              <th className="pb-3 font-medium text-right">Value</th>
              <th className="pb-3 font-medium w-24">Close Date</th>
              <th className="pb-3 font-medium w-24">Created</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-muted-foreground">
                  No opportunities found. Create an opportunity to get started.
                </td>
              </tr>
            ) : (
              opportunities.map(
                (opp: {
                  id: string;
                  title: string;
                  status: string;
                  value: string | null;
                  currency: string;
                  closeDate: Date | null;
                  contactId: string | null;
                  accountId: string | null;
                  ownerId: string | null;
                  pipelineId: string | null;
                  stageId: string | null;
                  contact: { id: string; firstName: string | null; lastName: string } | null;
                  account: { id: string; name: string } | null;
                  pipeline: { id: string; name: string } | null;
                  stage: { id: string; name: string; isWon: boolean; isLost: boolean } | null;
                  createdAt: Date;
                }) => (
                  <tr key={opp.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">
                      <Link
                        href={`/crm/opportunities/${opp.id}`}
                        className="text-accent hover:underline"
                      >
                        {opp.title}
                      </Link>
                    </td>
                    <td className="py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                          opp.status === 'won'
                            ? 'bg-green-100 text-green-800'
                            : opp.status === 'lost'
                              ? 'bg-red-100 text-red-800'
                              : opp.status === 'open'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {opp.status}
                      </span>
                    </td>
                    <td className="py-4 text-sm">
                      {opp.pipeline ? (
                        <Link
                          href={`/crm/pipelines/${opp.pipeline.id}`}
                          className="text-accent hover:underline"
                        >
                          {opp.pipeline.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {opp.stage ? (
                        <span className="block text-xs text-muted-foreground mt-1">
                          {opp.stage.name}
                          {opp.stage.isWon ? ' (Won)' : opp.stage.isLost ? ' (Lost)' : ''}
                        </span>
                      ) : (
                        <span className="block text-xs text-muted-foreground mt-1">—</span>
                      )}
                    </td>
                    <td className="py-4">
                      {opp.contact ? (
                        <Link
                          href={`/crm/contacts/${opp.contact.id}`}
                          className="text-accent hover:underline text-sm"
                        >
                          {`${opp.contact.firstName ?? ''} ${opp.contact.lastName}`.trim() ||
                            'Unnamed Contact'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="py-4">
                      {opp.account ? (
                        <Link
                          href={`/crm/accounts/${opp.account.id}`}
                          className="text-accent hover:underline text-sm"
                        >
                          {opp.account.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="py-4">
                      {opp.ownerId ? (
                        <span className="text-sm">Assigned</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Unassigned</span>
                      )}
                    </td>
                    <td className="py-4 text-right text-sm font-medium">
                      {opp.value ? `${opp.currency} ${Number(opp.value).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {opp.closeDate ? new Date(opp.closeDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(opp.createdAt).toLocaleDateString()}
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
