'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function markAll() {
    setPending(true);
    try {
      const res = await fetch('/api/v1/automation/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        toast.error('Could not mark notifications as read');
        return;
      }
      const body = (await res.json().catch(() => ({ updated: 0 }))) as { updated?: number };
      toast.success(`Marked ${body.updated ?? 0} as read`);
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
      onClick={markAll}
      disabled={pending || disabled}
      className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
    >
      {pending ? 'Marking…' : 'Mark all read'}
    </button>
  );
}
