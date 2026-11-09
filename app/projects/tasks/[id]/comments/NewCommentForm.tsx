'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/**
 * Add a comment to a task (Client Component).
 *
 * The old form asked the user to paste their own raw User CUID so it could be
 * sent as the comment author. The author is taken from the session on the
 * server, so that field is gone.
 */
export function NewCommentForm({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [comment, setComment] = React.useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim()) return;

    setPending(true);
    try {
      const res = await fetch(`/api/v1/projects/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ comment: comment.trim() }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Could not add comment',
          description: body.error ?? 'Please try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Comment added' });
      setComment('');
      router.refresh();
    } catch {
      toast({
        title: 'Could not add comment',
        description: 'Network error.',
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="comment-body">
          Comment
        </label>
        <textarea
          id="comment-body"
          name="comment"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Write a comment..."
          className="w-full border border-input rounded-md px-3 py-2 text-sm"
          required
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add Comment'}
      </button>
    </form>
  );
}
