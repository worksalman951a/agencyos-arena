'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/**
 * Detach a file from a project (Client Component).
 * Replaces an in-Server-Component `onClick`/`window.confirm` handler.
 */
export function DeleteProjectFileButton({ fileId }: { fileId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    if (!window.confirm('Delete this file record? This cannot be undone.')) return;

    setPending(true);
    try {
      const res = await fetch(`/api/v1/projects/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Could not delete file',
          description: body.error ?? 'Please try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'File removed' });
      router.refresh();
    } catch {
      toast({
        title: 'Could not delete file',
        description: 'Network error.',
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
      className="text-sm text-destructive hover:underline disabled:opacity-50"
    >
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  );
}
