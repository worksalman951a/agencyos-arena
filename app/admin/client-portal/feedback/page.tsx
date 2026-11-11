/**
 * Client feedback (internal view).
 *
 * Shows the client conversation and team-only notes together, marked by
 * visibility, and offers a reply box that can post either kind. Clients never see
 * the `internal` rows.
 */

import Link from 'next/link';

import { InternalReplyForm } from '@/components/portal/admin/internal-reply-form';
import { listCommentsForOrganization } from '@/lib/services/portal/client-comment-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export const dynamic = 'force-dynamic';

export default async function AdminClientFeedbackPage() {
  const result = await loadPageData(() => listCommentsForOrganization());

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const comments = result.data;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/admin/client-portal" className="text-sm text-accent hover:underline">
          ← Client portal
        </Link>
        <h1 className="text-2xl font-bold">Client feedback</h1>
        <p className="text-sm text-muted-foreground">
          Client comments and internal notes. Internal notes are never returned to a client request.
        </p>
      </div>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No client feedback yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{comment.authorName}</span> ·{' '}
                  {comment.resourceType} ·{' '}
                  {comment.visibility === 'internal' ? 'internal note' : 'client-visible'}
                </span>
                <span>{comment.createdAt.toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm">{comment.body}</p>
              <InternalReplyForm
                resourceType={comment.resourceType}
                resourceId={comment.resourceId}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
