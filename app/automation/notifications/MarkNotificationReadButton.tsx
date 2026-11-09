'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/**
 * Marks a notification as read.
 *
 * This used to be an inline `onClick` inside a Server Component, together with a
 * `cookie` header read from `next/headers` — event handlers cannot be passed
 * from Server Components and the server cookie jar is not available in the
 * browser. It is now a Client Component that calls the API with the browser's
 * own session cookie.
 */
export function MarkNotificationReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/v1/automation/notifications/${encodeURIComponent(notificationId)}/read`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }
      );

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Could not mark as read',
          description: body.error ?? 'Please try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Marked as read' });
      router.refresh();
    } catch {
      toast({
        title: 'Could not mark as read',
        description: 'Network error, please try again.',
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-sm text-accent hover:underline disabled:opacity-50"
    >
      {pending ? 'Marking…' : 'Mark Read'}
    </button>
  );
}
