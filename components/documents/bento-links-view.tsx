'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Copy, Check, ExternalLink } from 'lucide-react';
import { Panel, EmptyState, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { DocumentLinkItem } from '@/app/documents/links/LinksPageClient';
import '@/components/crm/bento-contacts.css';

interface BentoLinksViewProps {
  links: DocumentLinkItem[];
  onOpenCreateModal: () => void;
  onRevokeLink: (id: string) => Promise<void>;
  revokingId: string | null;
}

export function BentoLinksView({
  links,
  onOpenCreateModal,
  onRevokeLink,
  revokingId,
}: BentoLinksViewProps) {
  const [searchVal, setSearchVal] = React.useState('');
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [typeFilter, setTypeFilter] = React.useState('all');

  const filteredLinks = React.useMemo(() => {
    return links.filter((l) => {
      if (typeFilter !== 'all' && l.documentType.toLowerCase() !== typeFilter.toLowerCase()) {
        return false;
      }
      if (!searchVal.trim()) return true;
      const q = searchVal.trim().toLowerCase();
      return (
        l.documentTitle.toLowerCase().includes(q) ||
        l.documentType.toLowerCase().includes(q) ||
        l.token.toLowerCase().includes(q)
      );
    });
  }, [links, searchVal, typeFilter]);

  const now = new Date();
  const activeCount = links.filter((l) => new Date(l.expiresAt) > now).length;
  const expiredCount = links.length - activeCount;
  const totalAccesses = links.reduce((acc, l) => acc + (l.accessCount || 0), 0);

  function copyToClipboard(link: DocumentLinkItem) {
    const fullUrl = `${window.location.origin}/share/${link.token}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedId(link.id);
    toast.success('Public link copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Documents</span>
            <span>/</span>
            <span>External Access Tokens</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Shareable Document Links
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {links.length} {links.length === 1 ? 'secure link' : 'secure links'} generated for
            external client review & verification
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/documents/contracts">Contracts</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/documents/templates">Templates</Link>
          </Button>
          <Button
            onClick={onOpenCreateModal}
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Plus size={14} strokeWidth={2.4} className="mr-1" /> New Share Link
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          { label: 'Total Links', value: String(links.length), note: 'all time tokens' },
          {
            label: 'Active Tokens',
            value: String(activeCount),
            note: 'live for client view',
            tone: activeCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Lapsed or Revoked',
            value: String(expiredCount),
            note: 'access disabled',
            tone: expiredCount > 0 ? 'warn' : undefined,
          },
          { label: 'Total Audit Hits', value: String(totalAccesses), note: 'verified page views' },
        ]}
      />

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <div className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            placeholder="Search links by document title, type, or token..."
            aria-label="Search links"
          />
          {searchVal && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSearchVal('')}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>

        <div className="bento-status-pills" role="tablist" aria-label="Filter links by type">
          {['all', 'proposal', 'quotation', 'estimate', 'contract'].map((tp) => {
            const isActive = typeFilter === tp;
            return (
              <button
                key={tp}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTypeFilter(tp)}
                className={`bento-filter-pill ${isActive ? 'bento-filter-pill--active' : ''}`}
              >
                {tp === 'all' ? 'All Types' : tp.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Links Register ────────────────────────────────────────────── */}
      {filteredLinks.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || typeFilter !== 'all'
                ? 'No shareable links match those filters'
                : 'No shareable links generated yet'
            }
            sub="Create public client review links with token expiration and view-count restrictions."
            action={{
              label: 'Generate Link',
              onClick: onOpenCreateModal,
            }}
          />
        </Panel>
      ) : (
        <Panel title={`Active and Expired Link Tokens (${filteredLinks.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="py-2.5 px-3">Document & Type</th>
                  <th className="py-2.5 px-3">Token Reference</th>
                  <th className="py-2.5 px-3">Status & Expiry</th>
                  <th className="py-2.5 px-3 text-center">Access Count</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredLinks.map((link) => {
                  const isExpired = new Date(link.expiresAt) <= now;
                  const isLimitReached =
                    link.maxAccess !== null && link.accessCount >= link.maxAccess;
                  const isRevokedOrDead = isExpired || isLimitReached;

                  return (
                    <tr key={link.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-foreground text-xs">
                          {link.documentTitle}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Type:{' '}
                          <span className="uppercase font-mono text-accent">
                            {link.documentType}
                          </span>{' '}
                          &bull; Created {new Date(link.createdAt).toLocaleDateString()}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-mono text-[11px] bg-muted/60 px-2 py-0.5 rounded border border-border">
                          /share/{link.token.slice(0, 10)}…
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <StatusPill tone={isRevokedOrDead ? 'idle' : 'ok'}>
                            {isRevokedOrDead ? 'Revoked / Expired' : 'Active'}
                          </StatusPill>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Expires: {new Date(link.expiresAt).toLocaleString()}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <span className="font-mono font-semibold text-foreground">
                          {link.accessCount}
                        </span>
                        <span className="text-muted-foreground">
                          {link.maxAccess !== null ? ` / ${link.maxAccess}` : ' / ∞'}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => copyToClipboard(link)}
                            title="Copy link to clipboard"
                          >
                            {copiedId === link.id ? (
                              <Check size={12} className="text-emerald-600" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </Button>

                          {!isRevokedOrDead && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                              disabled={revokingId === link.id}
                              onClick={() => onRevokeLink(link.id)}
                            >
                              {revokingId === link.id ? 'Revoking…' : 'Revoke'}
                            </Button>
                          )}

                          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            <a
                              href={`/share/${link.token}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open public share view in new tab"
                            >
                              <ExternalLink size={12} />
                            </a>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
