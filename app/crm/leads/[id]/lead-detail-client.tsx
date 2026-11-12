'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit, Trash2, ArrowRight, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BentoLeadRecordView,
  type LeadDetailRecord,
} from '@/components/crm/bento-lead-record-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface LeadDetailClientProps {
  lead: LeadDetailRecord;
}

export function LeadDetailClient({ lead }: LeadDetailClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [deleting, setDeleting] = React.useState(false);

  const isConverted = lead.status === 'converted' || !!lead.convertedOpportunity;
  const isDeleted = Boolean(lead.deletedAt);

  const handleDelete = async () => {
    if (
      !confirm('Are you sure you want to delete this lead? This will mark the lead as deleted.')
    ) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/leads/${lead.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error?.message || 'Failed to delete lead');
        return;
      }

      router.push('/crm/leads');
      router.refresh();
    } catch {
      alert('An error occurred while deleting the lead');
    } finally {
      setDeleting(false);
    }
  };

  if (isBento) {
    return <BentoLeadRecordView lead={lead} onDeleteRequest={handleDelete} deleting={deleting} />;
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lead #{lead.id.slice(-6)}</h1>
          <p className="text-muted-foreground">
            Source: {lead.source} &bull; Created {new Date(lead.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/crm/leads/new">New Lead</Link>
          </Button>
          {!isDeleted && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/crm/leads/${lead.id}/edit`}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Link>
              </Button>
              {!isConverted && (
                <Button asChild size="sm">
                  <Link href={`/crm/leads/${lead.id}/convert`}>
                    <ArrowRight className="h-4 w-4 mr-1" />
                    Convert to Opportunity
                  </Link>
                </Button>
              )}
              {isConverted && lead.convertedOpportunity && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/crm/opportunities/${lead.convertedOpportunity.id}`}>
                    <Briefcase className="h-4 w-4 mr-1" />
                    View Opportunity
                  </Link>
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                <Trash2 className="h-4 w-4 mr-1" />
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/crm/leads">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Leads
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Lead Details</h2>
          <dl className="space-y-4 text-sm">
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
          <dl className="space-y-4 text-sm">
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
            <p className="text-muted-foreground whitespace-pre-wrap text-sm">{lead.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
