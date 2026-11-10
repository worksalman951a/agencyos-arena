/**
 * AgencyOS Task Comments page.
 * Lists, creates, edits, and deletes comments for a specific task.
 */

import Link from 'next/link';
import { getTaskCommentContext } from '@/lib/services/projects/task-comment-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NewCommentForm } from './NewCommentForm';
import { CommentListClient } from './CommentListClient';

export default async function TaskCommentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getTaskCommentContext(id));

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const { task, comments } = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Task Comments</h1>
          <p className="text-sm text-muted-foreground">
            {task.projectName} · {task.title}
          </p>
        </div>
        <Link
          href={`/projects/${task.projectId}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Project
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-3xl">
        <h2 className="text-lg font-semibold mb-4">Add Comment</h2>
        <NewCommentForm taskId={id} />
      </div>

      <CommentListClient taskId={id} comments={comments} />
    </div>
  );
}
