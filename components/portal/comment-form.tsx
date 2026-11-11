'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Comment box for a shared resource.
 *
 * `visibility` is only exposed to internal staff; the client form always posts a
 * client-visible comment (the service forces it anyway).
 */
export function CommentForm({
  resourceType,
  resourceId,
  canComment,
}: {
  resourceType: string;
  resourceId: string;
  canComment: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!canComment) {
    return (
      <p className="text-sm text-muted-foreground">Commenting is not enabled for your account.</p>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/portal/comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ resourceType, resourceId, body: body.trim() }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? 'Could not post your comment.');
        return;
      }

      setBody('');
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        aria-label="Comment"
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        className="w-full rounded-md border px-3 py-2 text-sm"
        placeholder="Leave feedback for the team"
      />
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || !body.trim()}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Posting…' : 'Post comment'}
      </button>
    </form>
  );
}
