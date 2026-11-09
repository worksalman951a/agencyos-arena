/**
 * AgencyOS Task Comments page.
 * Lists and creates comments for a specific task.
 */

import Link from 'next/link';
import { listTaskComments } from '@/lib/services/projects/task-comment-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NewCommentForm } from './NewCommentForm';

export default async function TaskCommentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => listTaskComments(id));

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const comments = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Task Comments</h1>
          <p className="text-sm text-muted-foreground">Collaborate on this task with your team.</p>
        </div>
        <Link
          href="/projects"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Projects
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-3xl">
        <h2 className="text-lg font-semibold mb-4">Add Comment</h2>
        <NewCommentForm taskId={id} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium">Comment</th>
              <th className="pb-3 font-medium text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {(
              comments as Array<{
                id: string;
                comment: string;
                user: { name: string | null; email: string | null };
                createdAt: Date;
                updatedAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-muted-foreground">
                  No comments yet. Be the first to comment.
                </td>
              </tr>
            ) : (
              (
                comments as Array<{
                  id: string;
                  comment: string;
                  user: { name: string | null; email: string | null };
                  createdAt: Date;
                  updatedAt: Date;
                }>
              ).map((c) => (
                <tr key={c.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    {c.user?.name ?? (c.user?.email || 'Unknown')}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground whitespace-pre-wrap">
                    {c.comment}
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
