/**
 * AgencyOS New Project Template page.
 * Client component form for creating a new project template.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoProjectTemplateFormView } from '@/components/projects/bento-project-template-form-view';

export default function NewProjectTemplatePage() {
  const router = useRouter();
  const isBento = useBentoShell();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/projects/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to create template');
      }

      const data = (await res.json()) as { id: string };
      toast.success('Template created');
      router.push(`/projects/templates/${data.id}`);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (isBento) {
    return (
      <BentoProjectTemplateFormView
        mode="new"
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
        onSubmit={handleSubmit}
        isLoading={loading}
        error={error}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">New Project Template</h1>
        <Link
          href="/projects/templates"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="space-y-2">
          <label htmlFor="template-name" className="text-sm font-medium">
            Template Name
          </label>
          <input
            id="template-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Website Redesign Template"
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="template-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe what this template includes..."
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {loading ? 'Creating...' : 'Create Template'}
        </button>
      </form>
    </div>
  );
}
