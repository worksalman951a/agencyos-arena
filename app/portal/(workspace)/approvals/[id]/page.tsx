/**
 * Portal approval detail: the request, its immutable event history, the
 * client-visible comment thread, and the decision form.
 *
 * Approval history is append-only: the page renders what the service returns and
 * never offers an edit affordance.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApprovalResponseForm } from '@/components/portal/approval-response-form';
import { CommentForm } from '@/components/portal/comment-form';
import { getClientApproval } from '@/lib/services/portal/client-approval-service';
import { listClientVisibleComments } from '@/lib/services/portal/client-comment-service';
import { requirePortalAccess } from '@/lib/portal/access-control';
import { hasCapability } from '@/lib/portal/capabilities';
import { isPortalResourceType } from '@/lib/portal/resource-registry';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

export default async function PortalApprovalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await loadPortalPageData(async () => {
    const detail = await getClientApproval(id);
    const context = await requirePortalAccess();

    const resourceType = isPortalResourceType(detail.approval.resourceType)
      ? detail.approval.resourceType
      : null;

    const comments = resourceType
      ? await listClientVisibleComments(context, resourceType, detail.approval.resourceId)
      : [];

    return { detail, comments, canComment: hasCapability(context, 'comment') };
  });

  if (!result.ok) {
    // A record the client may not see answers HTTP 404, indistinguishable from a
    // record that does not exist. Only an inactive access gets an explanation.
    if (result.reason === 'not-found') notFound();

    return (
      <div role="alert" className="rounded-md border p-4 text-sm">
        This approval request could not be loaded right now.
        <div className="mt-2">
          <Link href="/portal/approvals" className="text-accent hover:underline">
            Back to approvals
          </Link>
        </div>
      </div>
    );
  }

  const { detail, comments, canComment } = result.data;
  const approval = detail.approval;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal/approvals" className="text-sm text-accent hover:underline">
          ← Approvals
        </Link>
        <h2 className="mt-2 text-2xl font-bold">{approval.title}</h2>
        {approval.description ? (
          <p className="text-sm text-muted-foreground">{approval.description}</p>
        ) : null}
        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          {approval.resourceType} · status: {approval.status}
        </p>
      </div>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-lg font-semibold">Your decision</h3>
        {approval.status === 'pending' ? (
          <ApprovalResponseForm approvalId={approval.id} />
        ) : (
          <p className="mt-2 text-sm" data-testid="approval-decision">
            {approval.status === 'approved'
              ? 'You approved this on '
              : approval.status === 'changes_requested'
                ? 'You requested changes on '
                : 'This request was cancelled on '}
            {approval.respondedAt
              ? approval.respondedAt.toLocaleString()
              : approval.createdAt.toLocaleString()}
            {approval.responseNote ? ` — “${approval.responseNote}”` : ''}
          </p>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-lg font-semibold">History</h3>
        <ol className="mt-2 space-y-2" data-testid="approval-history">
          {detail.events.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                <span className="font-medium">
                  {event.actorType === 'client' ? 'You' : (event.actorName ?? 'Agency')}
                </span>{' '}
                {event.action.replace('_', ' ')}
                {event.note ? ` — “${event.note}”` : ''}
              </span>
              <span className="text-xs text-muted-foreground">
                {event.createdAt.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-lg font-semibold">Conversation</h3>
        {comments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-md bg-muted/40 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {comment.authorName} · {comment.createdAt.toLocaleString()}
                </p>
                <p className="mt-1">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
        {isPortalResourceType(approval.resourceType) ? (
          <div className="mt-4">
            <CommentForm
              resourceType={approval.resourceType}
              resourceId={approval.resourceId}
              canComment={canComment}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
