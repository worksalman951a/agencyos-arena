'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export interface DocumentLinkItem {
  id: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  token: string;
  url: string;
  expiresAt: Date | string;
  accessCount: number;
  maxAccess: number | null;
  createdAt: Date | string;
}

interface EntityOption {
  id: string;
  label: string;
}

export function LinksPageClient({ initialLinks }: { initialLinks: DocumentLinkItem[] }) {
  const router = useRouter();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [entityType, setEntityType] = useState<'proposal' | 'quotation' | 'estimate' | 'contract'>(
    'proposal'
  );
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [expiresHours, setExpiresHours] = useState('168');
  const [maxAccess, setMaxAccess] = useState('');
  const [creating, setCreating] = useState(false);

  async function loadOptionsForType(nextType: 'proposal' | 'quotation' | 'estimate' | 'contract') {
    setLoadingOptions(true);
    setOptions([]);
    setSelectedEntityId('');
    try {
      const endpoint =
        nextType === 'proposal'
          ? '/api/v1/crm/proposals?pageSize=100'
          : nextType === 'quotation'
            ? '/api/v1/crm/quotations?pageSize=100'
            : nextType === 'estimate'
              ? '/api/v1/finance/estimates'
              : '/api/v1/documents/contracts';
      const res = await fetch(endpoint);
      if (!res.ok) return;
      const raw = await res.json();
      const rows: Array<Record<string, unknown>> = Array.isArray(raw)
        ? raw
        : (raw.proposals ?? raw.quotations ?? []);
      const mapped = rows.map((r) => ({
        id: String(r.id),
        label: r.number
          ? `#${String(r.number)}${r.title ? ` — ${String(r.title)}` : ''}`
          : String(r.title || r.id),
      }));
      setOptions(mapped);
      if (mapped[0]) setSelectedEntityId(mapped[0].id);
    } finally {
      setLoadingOptions(false);
    }
  }

  function handleOpenCreate() {
    setModalOpen(true);
    void loadOptionsForType(entityType);
  }

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEntityId) {
      toast.error('Please select a document to share');
      return;
    }
    setCreating(true);
    try {
      const hours = Math.max(1, Number(expiresHours) || 168);
      const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      const parsedMax = maxAccess.trim() ? Number(maxAccess) : undefined;
      const res = await fetch('/api/v1/documents/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType,
          entityId: selectedEntityId,
          expiresAt,
          ...(parsedMax && parsedMax > 0 ? { maxAccess: parsedMax } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to create share link');
      }
      toast.success('Shareable link created');
      setModalOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(token: string) {
    const fullUrl = `${window.location.origin}/share/${token}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
        toast.success('Link copied to clipboard');
      }
    } catch {
      toast.error('Could not copy link');
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/v1/documents/links?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to revoke link');
      }
      toast.success('Share link revoked');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Shared Document Links</h1>
          <p className="text-muted-foreground">
            Token-based, time-bound links for sharing proposals, quotations, estimates, and
            contracts with clients.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          Create Share Link
        </button>
      </div>

      {modalOpen && (
        <form
          onSubmit={handleCreateLink}
          className="rounded-md border bg-card p-6 space-y-4 max-w-2xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Generate Client Share Link</h2>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="share-entity-type" className="block text-sm font-medium">
                Document Category
              </label>
              <select
                id="share-entity-type"
                value={entityType}
                onChange={(e) => {
                  const next = e.target.value as 'proposal' | 'quotation' | 'estimate' | 'contract';
                  setEntityType(next);
                  void loadOptionsForType(next);
                }}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="proposal">Proposal</option>
                <option value="quotation">Quotation</option>
                <option value="estimate">Estimate</option>
                <option value="contract">Contract</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="share-entity-id" className="block text-sm font-medium">
                Select Record
              </label>
              <select
                id="share-entity-id"
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                disabled={loadingOptions}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                {options.length === 0 ? (
                  <option value="">
                    {loadingOptions ? 'Loading…' : `No ${entityType}s available`}
                  </option>
                ) : (
                  options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="share-link-expiry" className="block text-sm font-medium">
                Expires In
              </label>
              <select
                id="share-link-expiry"
                value={expiresHours}
                onChange={(e) => setExpiresHours(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
                <option value="720">30 days</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="share-link-max-views" className="block text-sm font-medium">
                Max Views (optional)
              </label>
              <input
                id="share-link-max-views"
                type="number"
                min="1"
                value={maxAccess}
                onChange={(e) => setMaxAccess(e.target.value)}
                placeholder="Unlimited"
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !selectedEntityId}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create Link'}
            </button>
          </div>
        </form>
      )}

      {initialLinks.length === 0 ? (
        <div className="rounded-md border bg-background p-6 text-center space-y-2">
          <h2 className="text-lg font-semibold">No shared links</h2>
          <p className="text-muted-foreground text-sm">
            Create shareable links here or directly from any Proposal, Quotation, Estimate, or
            Contract detail page.
          </p>
        </div>
      ) : (
        <div className="rounded-md border bg-background p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b text-sm">
                <th className="pb-3 font-medium text-muted-foreground">Document</th>
                <th className="pb-3 font-medium text-muted-foreground">Share Path</th>
                <th className="pb-3 font-medium text-muted-foreground">Expires</th>
                <th className="pb-3 font-medium text-muted-foreground">Views</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialLinks.map((l) => {
                const isExpired = new Date(l.expiresAt) < new Date();
                const isExhausted = l.maxAccess !== null && l.accessCount >= l.maxAccess;
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-4">
                      <span className="text-sm font-medium">{l.documentTitle}</span>
                      <br />
                      <span className="text-xs text-muted-foreground capitalize">
                        {l.documentType}
                      </span>
                    </td>
                    <td className="py-4">
                      <Link
                        href={`/share/${l.token}`}
                        target="_blank"
                        className="font-mono text-xs text-accent hover:underline break-all"
                      >
                        /share/{l.token.slice(0, 16)}…
                      </Link>
                    </td>
                    <td className="py-4 text-sm">
                      {new Date(l.expiresAt).toLocaleString()}
                      {isExpired ? (
                        <span className="ml-2 inline-flex items-center rounded bg-red-100 text-red-800 px-1.5 py-0.5 text-xs">
                          Expired
                        </span>
                      ) : isExhausted ? (
                        <span className="ml-2 inline-flex items-center rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-xs">
                          Limit Reached
                        </span>
                      ) : null}
                    </td>
                    <td className="py-4 text-sm">
                      {l.accessCount}
                      {l.maxAccess !== null ? ` / ${l.maxAccess}` : ''}
                    </td>
                    <td className="py-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleCopy(l.token)}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        Copy URL
                      </button>
                      <button
                        type="button"
                        disabled={revokingId === l.id}
                        onClick={() => handleRevoke(l.id)}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        {revokingId === l.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
