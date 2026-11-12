/**
 * AgencyOS Documents - New Template
 * Client component form for creating a reusable document template with content and variables.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoDocumentTemplateFormView } from '@/components/documents/bento-document-template-form-view';

export default function NewTemplatePage() {
  const router = useRouter();
  const isBento = useBentoShell();
  const [name, setName] = useState('');
  const [type, setType] = useState('proposal');
  const [content, setContent] = useState('');
  const [variablesRaw, setVariablesRaw] = useState('client_name, project_scope, valid_until');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const varKeys = variablesRaw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const variables = Object.fromEntries(varKeys.map((k) => [k, '']));

    try {
      const res = await fetch('/api/v1/documents/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          content: content || null,
          variables,
          isDefault,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create template' }));
        throw new Error((err as { error?: string }).error || 'Failed to create template');
      }

      const data = await res.json();
      toast.success('Template created');
      router.push(`/documents/templates/${data.id}`);
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
      <BentoDocumentTemplateFormView
        mode="new"
        name={name}
        setName={setName}
        type={type}
        setType={setType}
        content={content}
        setContent={setContent}
        variablesRaw={variablesRaw}
        setVariablesRaw={setVariablesRaw}
        isDefault={isDefault}
        setIsDefault={setIsDefault}
        onSubmit={handleSubmit}
        isLoading={loading}
        error={error}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">New Template</h1>
          <p className="text-muted-foreground">Create a reusable document template.</p>
        </div>
        <Link
          href="/documents/templates"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Templates
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="template-name" className="block text-sm font-medium">
                Template Name <span className="text-destructive">*</span>
              </label>
              <input
                id="template-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
                placeholder="Standard Agency Retainer"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="template-type" className="block text-sm font-medium">
                Template Type
              </label>
              <select
                id="template-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="proposal">Proposal</option>
                <option value="quotation">Quotation</option>
                <option value="contract">Contract</option>
                <option value="invoice">Invoice</option>
                <option value="letter">Letter</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="template-variables" className="block text-sm font-medium">
              Merge Variables (comma-separated)
            </label>
            <input
              id="template-variables"
              type="text"
              value={variablesRaw}
              onChange={(e) => setVariablesRaw(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm font-mono"
              placeholder="client_name, project_scope, valid_until"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="template-content" className="block text-sm font-medium">
              Template Body / Terms
            </label>
            <textarea
              id="template-content"
              rows={7}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              placeholder="Prepared for {{client_name}}. Scope of work: {{project_scope}}..."
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-accent"
              />
              <span className="text-sm">Set as default for this type</span>
            </label>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className={`px-6 py-2 rounded-md text-sm font-medium disabled:opacity-50 ${
                loading
                  ? 'bg-muted cursor-not-allowed'
                  : 'bg-accent text-accent-foreground hover:bg-accent/90'
              }`}
            >
              {loading ? 'Creating...' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
