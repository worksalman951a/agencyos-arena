/**
 * Portal approvals index — the client's own approval requests.
 */

import Link from 'next/link';

import { listClientApprovals } from '@/lib/services/portal/client-approval-service';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting your decision',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  cancelled: 'Cancelled by the agency',
};

export default async function PortalApprovalsPage() {
  const result = await loadPortalPageData(() => listClientApprovals());

  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border p-4 text-sm">
        Approvals are not available for this account right now.
      </div>
    );
  }

  const approvals = result.data;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Approvals</h2>
      {approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been sent for your approval.</p>
      ) : (
        <ul className="space-y-3" data-testid="portal-approvals">
          {approvals.map((approval) => (
            <li key={approval.id} className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/portal/approvals/${approval.id}`}
                  className="text-lg font-semibold hover:underline"
                >
                  {approval.title}
                </Link>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs ${
                    approval.status === 'pending'
                      ? 'bg-blue-100 text-blue-800'
                      : approval.status === 'approved'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {STATUS_LABELS[approval.status] ?? approval.status}
                </span>
              </div>
              {approval.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{approval.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {approval.resourceType} · requested {approval.createdAt.toLocaleDateString()}
                {approval.dueAt ? ` · due ${approval.dueAt.toLocaleDateString()}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
