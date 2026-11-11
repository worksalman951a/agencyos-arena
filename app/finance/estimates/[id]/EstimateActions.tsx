'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface EstimateActionsProps {
  estimateId: string;
  status: string;
}

export function EstimateActions({ estimateId, status }: EstimateActionsProps) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function transitionStatus(nextStatus: string) {
    if (busyAction) return;
    setBusyAction(nextStatus);
    try {
      const res = await fetch(`/api/v1/finance/estimates/${estimateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to update estimate status');
      }
      toast.success(`Estimate marked as ${nextStatus}`);
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
      const res = await fetch(`/api/v1/finance/estimates/${estimateId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to delete estimate');
      }
      toast.success('Estimate deleted');
      router.push('/finance/estimates');
    } catch (err) {
      toast.error((err as Error).message);
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-2">
      {status === 'draft' && (
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => transitionStatus('sent')}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {busyAction === 'sent' ? 'Sending…' : 'Mark as Sent'}
        </button>
      )}

      {(status === 'draft' || status === 'sent') && (
        <>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('accepted')}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {busyAction === 'accepted' ? 'Accepting…' : 'Accept Estimate'}
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('rejected')}
            className="w-full px-4 py-2 border border-red-200 bg-red-50 text-red-700 rounded-md text-sm font-medium hover:bg-red-100 disabled:opacity-50"
          >
            Reject Estimate
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => transitionStatus('expired')}
            className="w-full px-4 py-2 border border-border bg-background text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
          >
            Mark Expired
          </button>
        </>
      )}

      {status !== 'accepted' && status !== 'converted' && (
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={handleDelete}
          className="w-full px-4 py-2 border border-red-200 text-red-700 rounded-md text-sm font-medium hover:bg-red-50 disabled:opacity-50"
        >
          {busyAction === 'delete' ? 'Deleting…' : 'Delete Estimate'}
        </button>
      )}
    </div>
  );
}
