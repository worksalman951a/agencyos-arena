'use client';

import { useState } from 'react';
import { Link2, Copy, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface ShareDocumentButtonProps {
  entityType: 'proposal' | 'quotation' | 'estimate' | 'contract';
  entityId: string;
}

export function ShareDocumentButton({ entityType, entityId }: ShareDocumentButtonProps) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('14');
  const [maxAccess, setMaxAccess] = useState('');
  const [creating, setCreating] = useState(false);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const expiresAt = new Date(Date.now() + Number(days) * 86_400_000).toISOString();
      const res = await fetch('/api/v1/documents/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType,
          entityId,
          expiresAt,
          maxAccess: maxAccess ? Number(maxAccess) : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to create share link');
      }
      const created = (await res.json()) as { publicUrl?: string; token: string };
      const path = created.publicUrl || `/share/${created.token}`;
      setSharePath(path);
      toast.success('Shareable client link created');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!sharePath) return;
    const fullUrl = `${window.location.origin}${sharePath}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy automatically — select the link below');
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="share-document-button"
        className="inline-flex items-center gap-1.5 px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
      >
        <Link2 className="h-4 w-4" />
        Share Link
      </button>

      {open && (
        <div className="mt-2 p-4 w-80 rounded-lg border border-border bg-card shadow-lg z-30 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Client Share Link</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <form onSubmit={handleCreateLink} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Expires In
              </label>
              <select
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-full border border-input rounded-md px-2.5 py-1.5 text-sm bg-background"
              >
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Max Views (optional)
              </label>
              <input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={maxAccess}
                onChange={(e) => setMaxAccess(e.target.value)}
                className="w-full border border-input rounded-md px-2.5 py-1.5 text-sm bg-background"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {creating ? 'Generating…' : 'Generate Share Link'}
            </button>
          </form>

          {sharePath && (
            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground">Shareable URL:</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={sharePath}
                  data-testid="generated-share-url"
                  className="flex-1 border border-input rounded px-2 py-1 text-xs bg-muted/40 font-mono"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 border border-border rounded hover:bg-muted"
                  title="Copy link"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                <a
                  href={sharePath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 border border-border rounded hover:bg-muted"
                  title="Open client view"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
