'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, GitBranch, AlertTriangle } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface BentoPipelineFormViewProps {
  mode: 'new' | 'edit';
  pipelineId?: string;
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (desc: string) => void;
  isDefault: boolean;
  setIsDefault: (isDefault: boolean) => void;
  onSubmit: (e?: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
}

export function BentoPipelineFormView({
  mode,
  pipelineId,
  name,
  setName,
  description,
  setDescription,
  isDefault,
  setIsDefault,
  onSubmit,
  isLoading,
  error,
}: BentoPipelineFormViewProps) {
  const isEdit = mode === 'edit';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link href={isEdit && pipelineId ? `/crm/pipelines/${pipelineId}` : '/crm/pipelines'}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/pipelines" className="hover:underline">
                CRM
              </Link>
              <span>/</span>
              <Link href="/crm/pipelines" className="hover:underline">
                Pipelines
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Pipeline' : 'New Pipeline'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Pipeline: ${name || 'Untitled'}` : 'New Sales Pipeline'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href={isEdit && pipelineId ? `/crm/pipelines/${pipelineId}` : '/crm/pipelines'}>
              Cancel
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isLoading}
            onClick={() => onSubmit()}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : isEdit ? 'Update Pipeline' : 'Create Pipeline'}
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
            label: 'Pipeline Identity',
            value: name || 'Unnamed',
            note: isDefault ? 'Default Organization Pipeline' : 'Custom Secondary Pipeline',
            tone: isDefault ? 'ok' : undefined,
          },
          {
            label: 'Default Status',
            value: isDefault ? 'PRIMARY DEFAULT' : 'STANDARD',
            note: isDefault ? 'Default target for incoming leads' : 'Explicit assignment only',
          },
          {
            label: 'Evaluation Scope',
            value: 'Organization Isolated',
            note: 'Enforces tenant boundary',
          },
          {
            label: 'Lifecycle Mode',
            value: isEdit ? 'EXISTING RECORD' : 'NEW REGISTRATION',
            note: isEdit ? `Pipeline ID: ${pipelineId?.slice(-6) || '—'}` : 'Initial provisioning',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Pipeline Parameters">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit(e);
              }}
              className="space-y-4 text-xs"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="pipe-name"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <GitBranch className="h-3.5 w-3.5 text-accent" />
                  Pipeline Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="pipe-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Inbound Enterprise Sales"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="pipe-desc" className="font-semibold text-foreground">
                  Description
                </label>
                <textarea
                  id="pipe-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Describe the target deals, deal velocity, or qualification criteria for this pipeline..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label className="font-semibold text-foreground flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    disabled={isLoading}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded border-input text-accent bg-background"
                  />
                  <span>Set as default pipeline for new deals and lead conversions</span>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  When enabled, any opportunity created without an explicit pipeline will
                  automatically route here.
                </p>
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link
                    href={isEdit && pipelineId ? `/crm/pipelines/${pipelineId}` : '/crm/pipelines'}
                  >
                    Cancel
                  </Link>
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading}
                  className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving...' : isEdit ? 'Update Pipeline' : 'Create Pipeline'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Association Sidebar */}
        <div className="space-y-6">
          <Panel title="Configuration Overview">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Pipeline Status
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{name || 'Untitled Pipeline'}</span>
                  {isDefault && <StatusPill tone="ok">Default</StatusPill>}
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Sales pipelines track the journey of opportunities through progressive
                  qualification, proposal, and deal closing stages.
                </p>
                <p className="pt-1">
                  Stages can be defined and customized once the pipeline has been registered.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
