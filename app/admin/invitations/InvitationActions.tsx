'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function InvitationActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const actionable = status === 'pending' || status === 'expired';

  async function act(action: 'resend' | 'revoke') {
    setPending(true);
    try {
      const response = await fetch(
        action === 'resend'
          ? `/api/v1/admin/invitations/${id}/resend`
          : `/api/v1/admin/invitations/${id}`,
        {
          method: action === 'resend' ? 'POST' : 'DELETE',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        emailDelivery?: { status: string; reason?: string };
      };
      if (!response.ok) throw new Error(body.error ?? 'Could not update invitation');

      if (action === 'revoke') {
        toast.success('Invitation revoked');
      } else if (body.emailDelivery?.status === 'sent') {
        toast.success('A new invitation link was emailed');
      } else {
        toast.error(
          body.emailDelivery?.status === 'disabled'
            ? 'Invitation rotated, but email delivery is disabled'
            : `Invitation rotated, but email was not sent${body.emailDelivery?.reason ? ` (${body.emailDelivery.reason})` : ''}`
        );
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update invitation');
    } finally {
      setPending(false);
    }
  }

  if (!actionable) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => act('resend')}
        className="text-sm text-accent hover:underline disabled:opacity-50"
      >
        {pending ? 'Working…' : 'Resend'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => act('revoke')}
        className="text-sm text-destructive hover:underline disabled:opacity-50"
      >
        Revoke
      </button>
    </div>
  );
}
