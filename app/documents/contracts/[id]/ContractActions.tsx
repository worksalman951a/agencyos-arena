'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface ContractActionsProps {
  contractId: string;
  status: string;
}

export function ContractActions({ contractId, status }: ContractActionsProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<'send' | 'sign' | 'void' | 'delete' | null>(null);
  const [signFormOpen, setSignFormOpen] = React.useState(false);
  const [signerName, setSignerName] = React.useState('');
  const [signerEmail, setSignerEmail] = React.useState('');
  const [signatureReference, setSignatureReference] = React.useState('manual-esign');

  const canSend = status === 'draft';
  const canSign = status === 'draft' || status === 'sent';
  const canVoid = status === 'draft' || status === 'sent';
  const canDelete = status !== 'signed';

  async function handleSend() {
    setPending('send');
    try {
      const res = await fetch(`/api/v1/documents/contracts/${encodeURIComponent(contractId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status: 'sent' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not mark contract as sent');
      }
      toast.success('Contract marked as sent');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function handleSignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signerName.trim() || !signerEmail.trim()) {
      toast.error('Signer name and email are required');
      return;
    }

    setPending('sign');
    try {
      const res = await fetch(`/api/v1/documents/contracts/${encodeURIComponent(contractId)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerEmail: signerEmail.trim(),
          signatureReference: signatureReference.trim() || 'manual-esign',
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not sign contract');
      }

      toast.success('Contract signed');
      setSignFormOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function handleVoid() {
    setPending('void');
    try {
      const res = await fetch(`/api/v1/documents/contracts/${encodeURIComponent(contractId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status: 'voided' }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not void contract');
      }

      toast.success('Contract voided');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    setPending('delete');
    try {
      const res = await fetch(`/api/v1/documents/contracts/${encodeURIComponent(contractId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not delete contract');
      }
      toast.success('Contract deleted');
      router.push('/documents/contracts');
    } catch (err) {
      toast.error((err as Error).message);
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {status === 'signed' && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-xs text-green-800">
          This contract has been executed and locked for audit integrity.
        </div>
      )}

      {status === 'voided' && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-800">
          This contract has been voided and can no longer be signed.
        </div>
      )}

      {canSend && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={handleSend}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending === 'send' ? 'Sending…' : 'Mark as Sent'}
        </button>
      )}

      {canSign && !signFormOpen && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => setSignFormOpen(true)}
          className="w-full px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          Sign Contract
        </button>
      )}

      {canSign && signFormOpen && (
        <form
          onSubmit={handleSignSubmit}
          className="space-y-3 rounded-md border border-border p-3 bg-muted/20"
        >
          <div className="text-xs font-semibold text-foreground">Record Authorized Signature</div>
          <div className="space-y-1">
            <label htmlFor="signer-name" className="block text-xs text-muted-foreground">
              Signer Full Name *
            </label>
            <input
              id="signer-name"
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Jane Doe"
              required
              className="w-full border border-input rounded px-2.5 py-1.5 text-sm bg-background"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="signer-email" className="block text-xs text-muted-foreground">
              Signer Email *
            </label>
            <input
              id="signer-email"
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              placeholder="jane@client.com"
              required
              className="w-full border border-input rounded px-2.5 py-1.5 text-sm bg-background"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="signature-ref" className="block text-xs text-muted-foreground">
              Signature Reference
            </label>
            <input
              id="signature-ref"
              type="text"
              value={signatureReference}
              onChange={(e) => setSignatureReference(e.target.value)}
              placeholder="manual-esign"
              className="w-full border border-input rounded px-2.5 py-1.5 text-sm bg-background"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending !== null}
              className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {pending === 'sign' ? 'Signing…' : 'Confirm Signature'}
            </button>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => setSignFormOpen(false)}
              className="px-3 py-1.5 border border-border rounded text-xs font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {canVoid && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={handleVoid}
          className="w-full px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
        >
          {pending === 'void' ? 'Voiding…' : 'Void Contract'}
        </button>
      )}

      {canDelete && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={handleDelete}
          className="w-full px-4 py-2 border border-red-200 text-red-700 rounded-md text-sm font-medium hover:bg-red-50 disabled:opacity-50"
        >
          {pending === 'delete' ? 'Deleting…' : 'Delete Contract'}
        </button>
      )}
    </div>
  );
}
