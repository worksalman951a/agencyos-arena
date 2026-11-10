'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface CommentRow {
  id: string;
  taskId: string;
  userId: string;
  comment: string;
  user?: { id: string; name: string | null; email: string | null };
  createdAt: Date;
  updatedAt: Date;
}

export function CommentListClient({
  taskId,
  comments,
}: {
  taskId: string;
  comments: CommentRow[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const startEdit = (row: CommentRow) => {
    setEditingId(row.id);
    setEditBody(row.comment);
  };

  const handleSave = async (commentId: string) => {
    if (!editBody.trim()) return;
    setBusyId(commentId);
    try {
      const res = await fetch(
        `/api/v1/projects/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: editBody.trim() }),
        }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update comment');
      }
      toast.success('Comment updated');
      setEditingId(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!window.confirm('Delete this comment?')) return;
    setBusyId(commentId);
    try {
      const res = await fetch(
        `/api/v1/projects/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete comment');
      }
      toast.success('Comment deleted');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-border text-sm text-muted-foreground">
            <th className="pb-3 font-medium w-48">Author</th>
            <th className="pb-3 font-medium">Comment</th>
            <th className="pb-3 font-medium text-right w-36">Created</th>
            <th className="pb-3 font-medium text-right w-32">Actions</th>
          </tr>
        </thead>
        <tbody>
          {comments.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center py-8 text-muted-foreground">
                No comments yet. Be the first to comment.
              </td>
            </tr>
          ) : (
            comments.map((c) => (
              <tr key={c.id} className="border-b border-border hover:bg-muted/50">
                <td className="py-4 font-medium align-top">
                  {c.user?.name ?? c.user?.email ?? 'Unknown'}
                </td>
                <td className="py-4 text-sm text-muted-foreground whitespace-pre-wrap">
                  {editingId === c.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={2}
                        className="w-full border border-input rounded-md px-2 py-1 text-sm bg-background text-foreground"
                        aria-label="Edit comment"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSave(c.id)}
                          disabled={busyId === c.id}
                          className="text-xs text-accent font-medium hover:underline"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    c.comment
                  )}
                </td>
                <td className="py-4 text-right text-sm text-muted-foreground align-top">
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
                <td className="py-4 text-right align-top space-x-3 whitespace-nowrap">
                  {editingId !== c.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        disabled={busyId === c.id}
                        className="text-xs text-destructive hover:underline"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
