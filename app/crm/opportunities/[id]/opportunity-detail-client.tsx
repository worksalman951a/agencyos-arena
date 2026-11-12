'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BentoOpportunityRecordView,
  type OpportunityDetailRecord,
} from '@/components/crm/bento-opportunity-record-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface OpportunityDetailClientProps {
  opportunity: OpportunityDetailRecord;
}

export function OpportunityDetailClient({ opportunity }: OpportunityDetailClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [deleting, setDeleting] = React.useState(false);

  const isDeleted = Boolean(opportunity.deletedAt);
  const proposals = opportunity.proposals ?? [];
  const quotations = opportunity.quotations ?? [];

  const handleDelete = async () => {
    if (
      !confirm(
        `Are you sure you want to delete ${opportunity.title}? This will mark the opportunity as deleted.`
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/opportunities/${opportunity.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error?.message || 'Failed to delete opportunity');
        return;
      }

      router.push('/crm/opportunities');
      router.refresh();
    } catch {
      alert('An error occurred while deleting the opportunity');
    } finally {
      setDeleting(false);
    }
  };

  if (isBento) {
    return (
      <BentoOpportunityRecordView
        opportunity={opportunity}
        onDeleteRequest={handleDelete}
        deleting={deleting}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{opportunity.title}</h1>
          <p className="text-muted-foreground">
            {opportunity.value
              ? `${opportunity.currency} ${Number(opportunity.value).toLocaleString()}`
              : 'No value'}{' '}
            &bull; Status: {opportunity.status}
          </p>
        </div>
        <div className="flex gap-2">
          {!isDeleted && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/crm/opportunities/${opportunity.id}/edit`}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                <Trash2 className="h-4 w-4 mr-1" />
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/crm/opportunities">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Opportunities
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Opportunity Details</h2>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Title</dt>
              <dd className="font-medium">{opportunity.title}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium capitalize">{opportunity.status}</dd>
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
              <dt className="text-xs text-muted-foreground">Stage</dt>
              <dd className="font-medium">{opportunity.stage?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Close Date</dt>
              <dd className="font-medium">
                {opportunity.closeDate ? new Date(opportunity.closeDate).toLocaleDateString() : '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="col-span-2 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Related Records</h2>
          <dl className="space-y-4 text-sm">
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
                  'No account linked'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Contact</dt>
              <dd className="font-medium">
                {opportunity.contact ? (
                  <Link
                    href={`/crm/contacts/${opportunity.contact.id}`}
                    className="text-accent hover:underline"
                  >
                    {[opportunity.contact.firstName, opportunity.contact.lastName]
                      .filter(Boolean)
                      .join(' ')}
                  </Link>
                ) : (
                  'No contact linked'
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="col-span-3 bg-card p-6 rounded-lg border border-border space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Proposals &amp; Quotations ({proposals.length + quotations.length})
            </h2>
          </div>

          {proposals.length === 0 && quotations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No proposals or quotations linked to this opportunity yet.
            </p>
          ) : (
            <div className="divide-y text-sm">
              {proposals.map((p) => (
                <div key={p.id} className="py-2 flex items-center justify-between">
                  <span>
                    Proposal #{p.number} — {p.title}
                  </span>
                  <span>
                    {p.currency} {Number(p.total).toLocaleString()}
                  </span>
                </div>
              ))}
              {quotations.map((q) => (
                <div key={q.id} className="py-2 flex items-center justify-between">
                  <span>
                    Quotation #{q.number} — {q.title}
                  </span>
                  <span>
                    {q.currency} {Number(q.total).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
