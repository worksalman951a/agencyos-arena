'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/** Retries a failed execution. Actions that already succeeded are not repeated. */
export function RetryExecutionButton({ executionId }: { executionId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function retry() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/v1/automation/executions/${encodeURIComponent(executionId)}/retry`,
        { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not retry the execution');
        return;
      }
      toast.success(`Retry finished: ${body.status ?? 'unknown'}`);
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
      onClick={retry}
      disabled={pending}
      className="text-sm text-accent hover:underline disabled:opacity-50"
    >
      {pending ? 'Retrying…' : 'Retry'}
    </button>
  );
}
