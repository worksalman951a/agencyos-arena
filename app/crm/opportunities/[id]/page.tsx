/**
 * AgencyOS CRM Opportunity Detail page.
 * Server component that shows opportunity details with related Contact/Account/Lead/Pipeline info.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOpportunity } from '@/lib/services/crm/opportunity-service';
import { listProposals } from '@/lib/services/crm/proposal-service';
import { listQuotations } from '@/lib/services/crm/quotation-service';
import { proposalQuerySchema } from '@/lib/schemas/crm/proposal.schema';
import { quotationQuerySchema } from '@/lib/schemas/crm/quotation.schema';

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const opportunity = await getOpportunity(id);
  interface LinkedSalesDoc {
    id: string;
    number: string;
    title: string;
    status: string;
    currency: string;
    total: string | number;
  }
  const [proposalsData, quotationsData] = await Promise.all([
    listProposals(proposalQuerySchema.parse({ opportunityId: id })).catch(() => ({
      proposals: [],
      total: 0,
    })),
    listQuotations(quotationQuerySchema.parse({ opportunityId: id })).catch(() => ({
      quotations: [],
      total: 0,
    })),
  ]);
  const linkedProposals = proposalsData.proposals as LinkedSalesDoc[];
  const linkedQuotations = quotationsData.quotations as LinkedSalesDoc[];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{opportunity.title}</h1>
          <p className="text-muted-foreground">
            {opportunity.status} &bull; {opportunity.currency}{' '}
            {opportunity.value ? Number(opportunity.value).toLocaleString() : '—'} &bull; Pipeline:{' '}
            {opportunity.pipeline?.name ?? '—'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/crm/opportunities/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Opportunity
          </Link>
          <Link
            href={`/crm/opportunities/${opportunity.id}/edit`}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Edit
          </Link>
          <Link
            href="/crm/opportunities"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Opportunities
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Opportunity Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd
                className={`font-medium ${opportunity.status === 'won' ? 'text-green-800' : opportunity.status === 'lost' ? 'text-red-800' : opportunity.status === 'open' ? 'text-blue-800' : 'text-muted-foreground'}`}
              >
                {opportunity.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Probability</dt>
              <dd className="font-medium">
                {opportunity.probability ? `${Number(opportunity.probability).toFixed(0)}%` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Value</dt>
              <dd className="font-medium">
                {opportunity.value
                  ? `${opportunity.currency} ${Number(opportunity.value).toLocaleString()}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd className="font-medium">{opportunity.currency}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected Close Date</dt>
              <dd className="font-medium">
                {opportunity.closeDate ? new Date(opportunity.closeDate).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Owner</dt>
              <dd className="font-medium">{opportunity.ownerId ? 'Assigned' : 'Unassigned'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pipeline</dt>
              <dd className="font-medium">
                {opportunity.pipeline ? (
                  <Link
                    href={`/crm/pipelines/${opportunity.pipeline.id}`}
                    className="text-accent hover:underline"
                  >
                    {opportunity.pipeline.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stage</dt>
              <dd className="font-medium">
                {opportunity.stage ? (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${opportunity.stage.isWon ? 'bg-green-100 text-green-800' : opportunity.stage.isLost ? 'bg-red-100 text-red-800' : 'bg-muted text-muted-foreground'}`}
                  >
                    {opportunity.stage.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            {opportunity.lossReason && (
              <div>
                <dt className="text-xs text-muted-foreground">Loss Reason</dt>
                <dd className="font-medium text-destructive whitespace-pre-wrap">
                  {opportunity.lossReason}
                </dd>
              </div>
            )}
            {opportunity.deletedAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Deleted At</dt>
                <dd className="font-medium text-destructive">
                  {new Date(opportunity.deletedAt).toLocaleDateString()}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="col-span-2 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Related Records</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Contact</dt>
              <dd className="font-medium">
                {opportunity.contact ? (
                  <Link
                    href={`/crm/contacts/${opportunity.contact.id}`}
                    className="text-accent hover:underline"
                  >
                    {`${opportunity.contact.firstName ?? ''} ${opportunity.contact.lastName}`.trim() ||
                      'Unnamed Contact'}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No contact linked</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Account</dt>
              <dd className="font-medium">
                {opportunity.account ? (
                  <Link
                    href={`/crm/accounts/${opportunity.account.id}`}
                    className="text-accent hover:underline"
                  >
                    {opportunity.account.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No account linked</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lead</dt>
              <dd className="font-medium">
                {opportunity.lead ? (
                  <span className="text-accent hover:underline text-sm">
                    Lead #{opportunity.lead.id.slice(-6)} ({opportunity.lead.source},{' '}
                    {opportunity.lead.status})
                  </span>
                ) : (
                  <span className="text-muted-foreground">No lead linked</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {opportunity.description && (
          <div className="col-span-3 bg-card p-6 rounded-lg border border-border">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">Description</h2>
            <p className="text-muted-foreground whitespace-pre-wrap">{opportunity.description}</p>
          </div>
        )}

        <div className="col-span-3 bg-card p-6 rounded-lg border border-border space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Proposals &amp; Quotations
            </h2>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/sales/proposals/builder?opportunityId=${encodeURIComponent(opportunity.id)}${opportunity.contact ? `&contactId=${encodeURIComponent(opportunity.contact.id)}` : ''}`}
                className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90"
              >
                + Create Proposal
              </Link>
              <Link
                href={`/sales/quotations/builder?opportunityId=${encodeURIComponent(opportunity.id)}${opportunity.contact ? `&contactId=${encodeURIComponent(opportunity.contact.id)}` : ''}`}
                className="px-3 py-1.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted"
              >
                + Create Quotation
              </Link>
              {opportunity.contact && (
                <Link
                  href={`/finance/estimates/new?clientId=${encodeURIComponent(opportunity.contact.id)}`}
                  className="px-3 py-1.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted"
                >
                  + Create Estimate
                </Link>
              )}
            </div>
          </div>

          {linkedProposals.length === 0 && linkedQuotations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No proposals or quotations linked to this opportunity yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Number</th>
                    <th className="pb-2 font-medium">Title</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedProposals.map((p) => (
                    <tr key={`prop-${p.id}`} className="border-b border-border last:border-b-0">
                      <td className="py-2.5 text-xs text-muted-foreground">Proposal</td>
                      <td className="py-2.5 font-mono text-xs">
                        <Link
                          href={`/sales/proposals/${p.id}`}
                          className="text-accent hover:underline"
                        >
                          #{p.number}
                        </Link>
                      </td>
                      <td className="py-2.5">{p.title}</td>
                      <td className="py-2.5 capitalize">{p.status}</td>
                      <td className="py-2.5 text-right">
                        {p.currency} {Number(p.total).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {linkedQuotations.map((q) => (
                    <tr key={`quot-${q.id}`} className="border-b border-border last:border-b-0">
                      <td className="py-2.5 text-xs text-muted-foreground">Quotation</td>
                      <td className="py-2.5 font-mono text-xs">
                        <Link
                          href={`/sales/quotations/${q.id}`}
                          className="text-accent hover:underline"
                        >
                          #{q.number}
                        </Link>
                      </td>
                      <td className="py-2.5">{q.title}</td>
                      <td className="py-2.5 capitalize">{q.status}</td>
                      <td className="py-2.5 text-right">
                        {q.currency} {Number(q.total).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
