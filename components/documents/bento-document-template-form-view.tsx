'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, FileCode, Layers, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface BentoDocumentTemplateFormViewProps {
  mode: 'new' | 'edit';
  templateId?: string;
  name: string;
  setName: (n: string) => void;
  type: string;
  setType: (t: string) => void;
  content: string;
  setContent: (c: string) => void;
  variablesRaw: string;
  setVariablesRaw: (v: string) => void;
  isDefault: boolean;
  setIsDefault: (d: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error?: string | null;
  onCancel?: () => void;
}

export function BentoDocumentTemplateFormView({
  mode,
  templateId,
  name,
  setName,
  type,
  setType,
  content,
  setContent,
  variablesRaw,
  setVariablesRaw,
  isDefault,
  setIsDefault,
  onSubmit,
  isLoading,
  error,
  onCancel,
}: BentoDocumentTemplateFormViewProps) {
  const isEdit = mode === 'edit';
  const backHref =
    isEdit && templateId ? `/documents/templates/${templateId}` : '/documents/templates';

  const varList = variablesRaw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            asChild={!onCancel}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Cancel and return"
            onClick={onCancel}
          >
            {onCancel ? (
              <ArrowLeft className="h-4 w-4" />
            ) : (
              <Link href={backHref}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/documents" className="hover:underline">
                Documents
              </Link>
              <span>/</span>
              <Link href="/documents/templates" className="hover:underline">
                Templates
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Template' : 'New Template'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Template: ${name || 'Untitled'}` : 'New Document Template'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
              <Link href={backHref}>Cancel</Link>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={isLoading}
            onClick={onSubmit}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : isEdit ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Template Identity',
            value: name || 'Untitled Template',
            note: isDefault ? 'Default template for type' : 'Standard blueprint',
            tone: isDefault ? 'ok' : undefined,
          },
          {
            label: 'Document Type',
            value: type.toUpperCase(),
            note: 'output document category',
          },
          {
            label: 'Merge Variables',
            value: `${varList.length} variables`,
            note: 'dynamic placeholder keys',
          },
          {
            label: 'Blueprint Scope',
            value: isDefault ? 'ORGANIZATION DEFAULT' : 'CUSTOM TEMPLATE',
            note: 'workspace template registry',
            tone: isDefault ? 'ok' : undefined,
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Template Specifications & Content">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-doc-tpl-name"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <FileCode className="h-3.5 w-3.5 text-accent" />
                    Template Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="bento-doc-tpl-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isLoading}
                    placeholder="e.g. Standard Retainer Agreement"
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-doc-tpl-type"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <Layers className="h-3.5 w-3.5 text-accent" />
                    Template Type
                  </label>
                  <select
                    id="bento-doc-tpl-type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    disabled={isLoading}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
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

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="bento-doc-tpl-vars" className="font-semibold text-foreground">
                  Merge Variables (comma-separated keys)
                </label>
                <Input
                  id="bento-doc-tpl-vars"
                  type="text"
                  value={variablesRaw}
                  onChange={(e) => setVariablesRaw(e.target.value)}
                  disabled={isLoading}
                  placeholder="client_name, project_scope, valid_until"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="bento-doc-tpl-content" className="font-semibold text-foreground">
                  Template Body / Terms Markdown
                </label>
                <textarea
                  id="bento-doc-tpl-content"
                  rows={8}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  disabled={isLoading}
                  placeholder="Enter template text with {{placeholders}} matching the merge variable keys above..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs font-mono bg-background text-foreground"
                />
              </div>

              <div className="pt-2 border-t border-border flex items-center gap-2">
                <input
                  id="bento-doc-tpl-default"
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  disabled={isLoading}
                  className="rounded border-input text-accent focus:ring-accent h-4 w-4"
                />
                <label
                  htmlFor="bento-doc-tpl-default"
                  className="font-medium text-foreground text-xs cursor-pointer"
                >
                  Set as default template for {type} documents
                </label>
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                {onCancel ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    className="h-8 text-xs"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={backHref}>Cancel</Link>
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading}
                  className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Template'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Association Sidebar */}
        <div className="space-y-6">
          <Panel title="Template Overview">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Configuration
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{name || 'Untitled Template'}</span>
                  {isDefault && <StatusPill tone="ok">DEFAULT</StatusPill>}
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Document templates seed reusable agreements, proposals, quotations, and official
                  letters.
                </p>
                <p className="pt-1">
                  Placeholders wrapped in double brackets (e.g.{' '}
                  <code>&#123;&#123;client_name&#125;&#125;</code>) populate dynamically when
                  documents are generated.
                </p>
              </div>

              <div className="border-t border-border pt-2 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  Organization Scoped
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Available exclusively to authenticated team members within your organization.
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
