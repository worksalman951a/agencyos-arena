'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, FileText, AlertTriangle, Layers } from 'lucide-react';
import { Panel, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface BentoProjectTemplateFormViewProps {
  mode: 'new' | 'edit';
  templateId?: string;
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (desc: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error?: string | null;
}

export function BentoProjectTemplateFormView({
  mode,
  templateId,
  name,
  setName,
  description,
  setDescription,
  onSubmit,
  isLoading,
  error,
}: BentoProjectTemplateFormViewProps) {
  const isEdit = mode === 'edit';
  const backHref =
    isEdit && templateId ? `/projects/templates/${templateId}` : '/projects/templates';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/projects" className="hover:underline">
                Projects
              </Link>
              <span>/</span>
              <Link href="/projects/templates" className="hover:underline">
                Templates
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Template' : 'New Template'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Template: ${name || 'Untitled'}` : 'New Project Template'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href={backHref}>Cancel</Link>
          </Button>
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
            value: name || 'Unnamed Template',
            note: 'reusable project blueprint',
          },
          {
            label: 'Lifecycle Mode',
            value: isEdit ? 'EXISTING BLUEPRINT' : 'NEW SKELETON',
            note: isEdit ? `ID: ${templateId?.slice(-6) || '—'}` : 'initial definition',
            tone: isEdit ? 'ok' : undefined,
          },
          {
            label: 'Workspace Scope',
            value: 'Organization Shared',
            note: 'accessible across project creators',
          },
          {
            label: 'Automation Level',
            value: 'Standard Skeleton',
            note: 'instantiates task checklists',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Template Specifications">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="bento-tpl-name"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <FileText className="h-3.5 w-3.5 text-accent" />
                  Template Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="bento-tpl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  placeholder="e.g. Website Redesign Template"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="bento-tpl-desc" className="font-semibold text-foreground">
                  Description & Blueprint Scope
                </label>
                <textarea
                  id="bento-tpl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isLoading}
                  rows={4}
                  placeholder="Describe what milestone phases and deliverable tasks this template provides..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link href={backHref}>Cancel</Link>
                </Button>
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
          <Panel title="Blueprint Context">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Template Skeleton
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <Layers className="h-4 w-4 text-accent" />
                  <span>{name || 'Untitled Template'}</span>
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Project templates accelerate delivery by seeding new projects with predefined
                  tasks and deliverables.
                </p>
                <p className="pt-1">
                  Once saved, tasks and milestones can be customized directly on the template detail
                  view.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
