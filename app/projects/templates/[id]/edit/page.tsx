/**
 * AgencyOS Edit Project Template page.
 * Client component form for editing an existing project template.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function EditProjectTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    params.then(async ({ id: pid }) => {
      if (!active) return;
      setId(pid);
      try {
        const res = await fetch(`/api/v1/projects/templates/${encodeURIComponent(pid)}`);
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Failed to load template');
        }
        const data = (await res.json()) as { name?: string; description?: string | null };
        if (!active) return;
        setName(data.name || '');
        setDescription(data.description || '');
        setLoadError(null);
      } catch (err) {
        if (!active) return;
        const message = (err as Error).message;
        setLoadError(message);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projects/templates/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || undefined,
          description: description.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update template');
      }

      toast.success('Template updated');
      router.push(`/projects/templates/${id}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading template…</div>;
  }

  if (loadError) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
        <Link href="/projects/templates" className="text-sm text-accent hover:underline">
          Back to Templates
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Template</h1>
        <Link
          href={`/projects/templates/${id}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="space-y-2">
          <label htmlFor="edit-template-name" className="text-sm font-medium">
            Template Name
          </label>
          <input
            id="edit-template-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="edit-template-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="edit-template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
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
