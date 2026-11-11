'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/** Redeems a portal invitation for the signed-in account. */
export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/portal/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'This invitation could not be accepted.');
        return;
      }

      // The portal must render with the freshly created client identity, so the
      // router cache is invalidated before navigating.
      router.refresh();
      router.push('/portal');
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        data-testid="accept-invitation"
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Activating…' : 'Accept invitation'}
      </button>
    </div>
  );
}
