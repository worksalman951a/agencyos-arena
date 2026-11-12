'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoDocumentTemplateFormView } from '@/components/documents/bento-document-template-form-view';

interface TemplateDetailClientProps {
  template: {
    id: string;
    name: string;
    type: string;
    content: string | null;
    variables: Record<string, string> | null;
    isDefault: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  };
}

export function TemplateDetailClient({ template }: TemplateDetailClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const initialKeys = template.variables ? Object.keys(template.variables) : [];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [type, setType] = useState(template.type);
  const [content, setContent] = useState(template.content ?? '');
  const [variablesRaw, setVariablesRaw] = useState(initialKeys.join(', '));
  const [isDefault, setIsDefault] = useState(template.isDefault);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const varKeys = variablesRaw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const variables = Object.fromEntries(varKeys.map((k) => [k, template.variables?.[k] ?? '']));
      const res = await fetch(`/api/v1/documents/templates/${encodeURIComponent(template.id)}`, {
        method: 'PUT',
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
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to update template');
      }
      toast.success('Template updated');
      setEditing(false);
      router.refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/documents/templates/${encodeURIComponent(template.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to delete template');
      }
      toast.success('Template deleted');
      router.push('/documents/templates');
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
    }
  }

  if (isBento && editing) {
    return (
      <BentoDocumentTemplateFormView
        mode="edit"
        templateId={template.id}
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
        onSubmit={handleSave}
        isLoading={saving}
        error={error}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{template.name}</h1>
            {template.isDefault && (
              <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-medium">
                Default
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground capitalize">
            Type: {template.type} &bull; Updated {new Date(template.updatedAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {template.type === 'proposal' && (
            <Link
              href="/sales/proposals/builder"
              className="px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Open Proposal Builder
            </Link>
          )}
          {template.type === 'quotation' && (
            <Link
              href="/sales/quotations/builder"
              className="px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Open Quotation Builder
            </Link>
          )}
          {template.type === 'contract' && (
            <Link
              href={`/documents/contracts/new?title=${encodeURIComponent(template.name)}`}
              className="px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Create Contract
            </Link>
          )}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            {editing ? 'Cancel Edit' : 'Edit Template'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="px-3 py-2 border border-red-200 bg-red-50 text-red-700 rounded-md text-sm font-medium hover:bg-red-100 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <Link
            href="/documents/templates"
            className="px-3 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Templates
          </Link>
        </div>
      </div>

      {editing ? (
        <form
          onSubmit={handleSave}
          className="rounded-md border bg-background p-6 space-y-4 max-w-3xl"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="edit-template-name" className="block text-sm font-medium">
                Template Name
              </label>
              <input
                id="edit-template-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-template-type" className="block text-sm font-medium">
                Type
              </label>
              <select
                id="edit-template-type"
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
            <label htmlFor="edit-template-vars" className="block text-sm font-medium">
              Merge Variables
            </label>
            <input
              id="edit-template-vars"
              type="text"
              value={variablesRaw}
              onChange={(e) => setVariablesRaw(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm font-mono"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-template-content" className="block text-sm font-medium">
              Template Body
            </label>
            <textarea
              id="edit-template-content"
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-accent"
            />
            <span className="text-sm">Set as default for this type</span>
          </label>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 rounded-md border bg-background p-6 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Template Body</h2>
            {template.content ? (
              <pre className="whitespace-pre-wrap text-sm font-sans text-foreground bg-muted/30 rounded-md p-4 border border-border">
                {template.content}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                No body text configured yet. Click Edit Template to add reusable terms or scope.
              </p>
            )}
          </div>

          <div className="rounded-md border bg-background p-6 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Merge Variables</h2>
            {initialKeys.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {initialKeys.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center rounded bg-muted px-2 py-1 text-xs font-mono text-foreground"
                  >
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No merge variables defined.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
