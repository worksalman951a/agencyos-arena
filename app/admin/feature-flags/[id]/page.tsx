/**
 * AgencyOS Edit Feature Flag page.
 * Client component form for toggling feature flags.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoFeatureFlagFormView } from '@/components/admin/bento-feature-flag-form-view';

export default function EditFeatureFlagPage({ params }: { params: Promise<{ id: string }> }) {
  const isBento = useBentoShell();
  const router = useRouter();
  const [id, setId] = useState<string>('');
  const [flagKey, setFlagKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(async ({ id: pid }) => {
      setId(pid);
      try {
        const res = await fetch(`/api/v1/admin/feature-flags/${pid}`);
        if (!res.ok) throw new Error('Failed to load feature flag');
        const data = await res.json();
        setFlagKey(data.flagKey || '');
        setEnabled(data.enabled || false);
        setDescription(data.description || '');
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/feature-flags/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          enabled,
          description: description || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const msg = err.error || 'Failed to update feature flag';
        setError(msg);
        throw new Error(msg);
      }

      toast.success('Feature flag updated');
      router.push('/admin/feature-flags');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (isBento) {
    return (
      <BentoFeatureFlagFormView
        flagKey={flagKey}
        enabled={enabled}
        setEnabled={setEnabled}
        description={description}
        setDescription={setDescription}
        onSubmit={handleSubmit}
        isLoading={saving}
        error={error}
      />
    );
  }

  // Legacy fallback view
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Feature Flag</h1>
        <Link
          href="/admin/feature-flags"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="space-y-2">
          <label className="text-sm font-medium">Flag Key</label>
          <input
            type="text"
            value={flagKey}
            onChange={(e) => setFlagKey(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm font-mono"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            Enabled
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-input text-accent bg-background"
            />
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
