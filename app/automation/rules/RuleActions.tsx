'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/** Enable/disable toggle and delete, wired to the automation API. */
export function RuleActions({ ruleId, enabled }: { ruleId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function toggle() {
    setPending(true);
    try {
      const res = await fetch(`/api/v1/automation/workflows/${encodeURIComponent(ruleId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Could not update the rule');
        return;
      }
      toast.success(enabled ? 'Rule disabled' : 'Rule enabled');
      router.refresh();
    } catch {
      toast.error('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this rule and its execution history?')) return;
    setPending(true);
    try {
      const res = await fetch(`/api/v1/automation/workflows/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Could not delete the rule');
        return;
      }
      toast.success('Rule deleted');
      router.refresh();
    } catch {
      toast.error('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="text-sm text-muted-foreground hover:text-accent disabled:opacity-50"
      >
        {enabled ? 'Disable' : 'Enable'}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="text-sm text-red-600 hover:underline disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
