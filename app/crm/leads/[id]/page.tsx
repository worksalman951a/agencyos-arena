/**
 * AgencyOS CRM Lead Detail page.
 * Server component that shows lead details with related Contact/Account info
 * and conversion status/action.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getLead } from '@/lib/services/crm/lead-service';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const lead = await getLead(id);
  const isConverted = lead.status === 'converted' || !!lead.convertedOpportunity;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lead #{lead.id.slice(-6)}</h1>
          <p className="text-muted-foreground">
            Source: {lead.source} &bull; Created {new Date(lead.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/crm/leads/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Lead
          </Link>
          <Link
            href={`/crm/leads/${lead.id}/edit`}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Edit
          </Link>
          {!isConverted && (
            <Link
              href={`/crm/leads/${lead.id}/convert`}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Convert to Opportunity
            </Link>
          )}
          {isConverted && lead.convertedOpportunity && (
            <Link
              href={`/crm/opportunities/${lead.convertedOpportunity.id}`}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              View Opportunity
            </Link>
          )}
          <Link
            href="/crm/leads"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Leads
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Lead Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd className="font-medium">{lead.source}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd
                className={`font-medium ${
                  lead.status === 'converted'
                    ? 'text-blue-800'
                    : lead.status === 'closed-won'
                      ? 'text-green-800'
                      : lead.status === 'closed-lost'
                        ? 'text-red-800'
                        : 'text-foreground'
                }`}
              >
                {lead.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Priority</dt>
              <dd
                className={`font-medium ${
                  lead.priority === 'high'
                    ? 'text-red-800'
                    : lead.priority === 'medium'
                      ? 'text-amber-800'
                      : lead.priority
                        ? 'text-blue-800'
                        : 'text-muted-foreground'
                }`}
              >
                {lead.priority ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected Value</dt>
              <dd className="font-medium">
                {lead.expectedValue ? `$${Number(lead.expectedValue).toLocaleString()}` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Owner</dt>
              <dd className="font-medium">{lead.ownerId ? 'Assigned' : 'Unassigned'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pipeline</dt>
              <dd className="font-medium">{lead.pipelineId ? 'Set' : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stage</dt>
              <dd className="font-medium">{lead.stageId ? 'Set' : '—'}</dd>
            </div>
            {isConverted && (
              <div>
                <dt className="text-xs text-muted-foreground">Converted</dt>
                <dd className="font-medium text-blue-800">Yes</dd>
              </div>
            )}
            {lead.deletedAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Deleted At</dt>
                <dd className="font-medium text-destructive">
                  {new Date(lead.deletedAt).toLocaleDateString()}
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
                {lead.contact ? (
                  <Link
                    href={`/crm/contacts/${lead.contact.id}`}
                    className="text-accent hover:underline"
                  >
                    {`${lead.contact.firstName ?? ''} ${lead.contact.lastName}`.trim() ||
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
                {lead.account ? (
                  <Link
                    href={`/crm/accounts/${lead.account.id}`}
                    className="text-accent hover:underline"
                  >
                    {lead.account.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No account linked</span>
                )}
              </dd>
            </div>
            {isConverted && lead.convertedOpportunity && (
              <div>
                <dt className="text-xs text-muted-foreground">Converted Opportunity</dt>
                <dd className="font-medium">
                  <Link
                    href={`/crm/opportunities/${lead.convertedOpportunity.id}`}
                    className="text-accent hover:underline"
                  >
                    {lead.convertedOpportunity.title}
                  </Link>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    Status: {lead.convertedOpportunity.status} &bull; Value:{' '}
                    {lead.convertedOpportunity.value
                      ? `$${Number(lead.convertedOpportunity.value).toLocaleString()}`
                      : '—'}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </div>

        {lead.notes && (
          <div className="col-span-3 bg-card p-6 rounded-lg border border-border">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">Notes</h2>
            <p className="text-muted-foreground whitespace-pre-wrap">{lead.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
