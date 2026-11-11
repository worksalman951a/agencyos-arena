'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface ProposalActionsProps {
  proposalId: string;
  status: string;
}

export function ProposalActions({ proposalId, status }: ProposalActionsProps) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function transitionStatus(nextStatus: string, label: string) {
    if (busyAction) return;
    setBusyAction(nextStatus);
    try {
      const res = await fetch(`/api/v1/crm/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Failed to ${label.toLowerCase()}`);
      }
      toast.success(`Proposal marked as ${nextStatus}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveVersion() {
    if (busyAction) return;
    setBusyAction('version');
    try {
      const res = await fetch('/api/v1/documents/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to save version snapshot');
      }
      const created = (await res.json()) as { version: number };
      toast.success(`Saved version snapshot v${created.version}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    if (busyAction) return;
    setBusyAction('delete');
    try {
      const res = await fetch(`/api/v1/crm/proposals/${proposalId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to delete proposal');
      }
      toast.success('Proposal deleted');
      router.push('/sales/proposals');
    } catch (err) {
      toast.error((err as Error).message);
      setBusyAction(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'draft' && (
        <>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('sent', 'Mark Sent')}
            className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {busyAction === 'sent' ? 'Sending…' : 'Mark as Sent'}
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('expired', 'Mark Expired')}
            className="px-3 py-2 border border-border bg-background text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
          >
            Mark Expired
          </button>
        </>
      )}

      {status === 'sent' && (
        <>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('accepted', 'Accept')}
            className="px-3 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {busyAction === 'accepted' ? 'Accepting…' : 'Accept Proposal'}
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('rejected', 'Reject')}
            className="px-3 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {busyAction === 'rejected' ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('expired', 'Expire')}
            className="px-3 py-2 border border-border bg-background text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
          >
            Mark Expired
          </button>
        </>
      )}

      <button
        type="button"
        disabled={Boolean(busyAction)}
        onClick={handleSaveVersion}
        className="px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
      >
        {busyAction === 'version' ? 'Saving…' : 'Save Snapshot'}
      </button>

      {status !== 'accepted' && (
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={handleDelete}
          className="px-3 py-2 border border-red-200 bg-red-50 text-red-700 rounded-md text-sm font-medium hover:bg-red-100 disabled:opacity-50"
        >
          {busyAction === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
      )}
    </div>
  );
}
