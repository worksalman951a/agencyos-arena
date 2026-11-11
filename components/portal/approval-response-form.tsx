'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client decision form for one approval request.
 *
 * The decision and note are the only inputs; identity and timestamp are recorded
 * server-side from the session, so they cannot be spoofed by the browser.
 */
export function ApprovalResponseForm({
  approvalId,
  disabled,
}: {
  approvalId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  async function respond(decision: 'approved' | 'changes_requested') {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/portal/approvals/${approvalId}/respond`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ decision, ...(note.trim() ? { note: note.trim() } : {}) }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not record your decision.');
        return;
      }

      setNote('');
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  if (disabled) {
    return (
      <p className="text-sm text-muted-foreground">
        This request can no longer be answered from your account.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor="approval-note" className="text-xs font-medium text-muted-foreground">
        Note (optional)
      </label>
      <textarea
        id="approval-note"
        name="note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        className="w-full rounded-md border px-3 py-2 text-sm"
        placeholder="Anything the team should know"
      />
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => respond('approved')}
          disabled={pending}
          data-testid="approve-button"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => respond('changes_requested')}
          disabled={pending}
          data-testid="request-changes-button"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          Request changes
        </button>
      </div>
    </div>
  );
}
