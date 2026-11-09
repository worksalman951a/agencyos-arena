/**
 * AgencyOS CRM Opportunity Detail page.
 * Server component that shows opportunity details with related Contact/Account/Lead/Pipeline info.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOpportunity } from '@/lib/services/crm/opportunity-service';

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
      </div>
    </div>
  );
}
