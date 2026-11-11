'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Team reply on a shared resource.
 *
 * `visibility: "internal"` keeps the note out of every client-facing query; the
 * default (`client`) posts into the conversation the client can see.
 */
export function InternalReplyForm({
  resourceType,
  resourceId,
}: {
  resourceType: string;
  resourceId: string;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState('');
  const [visibility, setVisibility] = React.useState<'client' | 'internal'>('client');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/client-comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ resourceType, resourceId, body: body.trim(), visibility }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? 'Could not post the note.');
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
    <form onSubmit={handleSubmit} className="mt-2 space-y-1">
      <textarea
        aria-label="Reply"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        className="w-full rounded-md border px-2 py-1 text-xs"
        placeholder="Reply to the client (or add an internal note)"
      />
      <div className="flex items-center gap-3">
        <select
          aria-label="Visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as 'client' | 'internal')}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          <option value="client">Visible to client</option>
          <option value="internal">Internal only</option>
        </select>
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
