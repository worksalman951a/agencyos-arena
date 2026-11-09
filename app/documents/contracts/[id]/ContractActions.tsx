'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/**
 * Sign / void actions for a contract.
 *
 * These handlers lived inside the Server Component detail page, where event
 * handlers are not allowed and `window` does not exist during rendering. They
 * are now client-side, calling the same API endpoints and refreshing the
 * server-rendered detail afterwards.
 */
export function ContractActions({ contractId, status }: { contractId: string; status: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<'sign' | 'void' | null>(null);

  const canSign = status === 'draft' || status === 'sent';
  const canVoid = status !== 'voided';

  async function submit(kind: 'sign' | 'void') {
    if (
      kind === 'sign' &&
      !window.confirm('Mark this contract as signed? This action creates an audit record.')
    ) {
      return;
    }
    if (
      kind === 'void' &&
      !window.confirm('Are you sure you want to void this contract? This cannot be undone.')
    ) {
      return;
    }

    setPending(kind);
    try {
      const res = await fetch(`/api/v1/documents/contracts/${encodeURIComponent(contractId)}`, {
        method: kind === 'sign' ? 'POST' : 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:
          kind === 'sign'
            ? JSON.stringify({
                signerName: '',
                signerEmail: '',
                signatureReference: 'manual',
              })
            : JSON.stringify({ status: 'voided' }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: kind === 'sign' ? 'Could not sign contract' : 'Could not void contract',
          description: body.error ?? 'Please try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: kind === 'sign' ? 'Contract signed' : 'Contract voided' });
      router.refresh();
    } catch {
      toast({
        title: kind === 'sign' ? 'Could not sign contract' : 'Could not void contract',
        description: 'Network error.',
        variant: 'destructive',
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-2">
      {canSign ? (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => submit('sign')}
          className="w-full px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          {pending === 'sign' ? 'Signing…' : 'Sign Contract'}
        </button>
      ) : null}
      {canVoid ? (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => submit('void')}
          className="w-full px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
        >
          {pending === 'void' ? 'Voiding…' : 'Void Contract'}
        </button>
      ) : null}
    </div>
  );
}
