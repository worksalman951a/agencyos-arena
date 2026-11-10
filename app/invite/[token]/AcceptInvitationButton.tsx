'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function accept() {
    setPending(true);
    try {
      const res = await fetch('/api/v1/invitations/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not accept the invitation');
        return;
      }
      toast.success('Welcome to the organization');
      router.push('/dashboard');
      router.refresh();
    } catch {
      toast.error('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={accept}
      disabled={pending}
      className="w-full px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
    >
      {pending ? 'Joining…' : 'Accept invitation'}
    </button>
  );
}
