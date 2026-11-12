'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, ArrowRight } from 'lucide-react';
import { Panel, EmptyState, KeyValueRow, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { ProjectTemplateResponse } from '@/lib/services/projects/project-template-service';
import '@/components/crm/bento-contacts.css';

interface BentoProjectTemplatesViewProps {
  templates: ProjectTemplateResponse[];
  deleteButtonRenderer?: (id: string) => React.ReactNode;
}

export function BentoProjectTemplatesView({
  templates,
  deleteButtonRenderer,
}: BentoProjectTemplatesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeTemplate =
    templates[Math.min(selectedIdx, Math.max(0, templates.length - 1))] ?? null;

  const totalTemplates = templates.length;
  const totalProjectsSpawned = templates.reduce((sum, t) => sum + (t.projectCount || 0), 0);

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Projects</span>
            <span>/</span>
            <span>Blueprint Automation</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Project Templates
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Standardized delivery frameworks, task structures, and reusable scopes
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/projects">Projects Directory</Link>
          </Button>
          <Button asChild className="bg-accent text-accent-foreground" size="sm">
            <Link href="/projects/templates/new">
              <Plus size={14} className="mr-1.5" />
              New Template
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Configured Templates',
            value: String(totalTemplates),
            note: 'ready for project provisioning',
          },
          {
            label: 'Projects Instantiated',
            value: String(totalProjectsSpawned),
            note: 'projects launched from templates',
            tone: totalProjectsSpawned > 0 ? 'ok' : undefined,
          },
        ]}
      />

      {/* ── Templates Grid & Inspector ──────────────────────────────── */}
      {templates.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No project templates created yet"
            sub="Create standardized blueprints to rapidly bootstrap new client projects."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Templates Directory (${templates.length})`}>
              <div className="bento-sales-table-head">
                <span>Template Name</span>
                <span>Description</span>
                <span className="text-right">Projects Launched</span>
                <span className="text-right">Created</span>
                <span className="text-right">Actions</span>
              </div>

              <div className="divide-y divide-border/60">
                {templates.map((tpl, idx) => {
                  const isSelected = activeTemplate?.id === tpl.id;

                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {tpl.name}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {tpl.description || '—'}
                      </div>

                      <div className="text-xs font-mono font-bold text-foreground text-right">
                        {tpl.projectCount}
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(tpl.createdAt).toLocaleDateString()}
                      </div>

                      <div className="text-right space-x-2">
                        <Link
                          href={`/projects/new?templateId=${tpl.id}`}
                          className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Use <ArrowRight size={11} />
                        </Link>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeTemplate ? (
              <Panel
                title="Blueprint Inspector"
                action={
                  <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link href={`/projects/templates/${activeTemplate.id}/edit`}>Edit</Link>
                    </Button>
                    {deleteButtonRenderer?.(activeTemplate.id)}
                  </div>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Blueprint Model
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {activeTemplate.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {activeTemplate.description || 'No blueprint description configured'}
                    </p>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Adoption Count"
                      value={
                        <span className="font-mono font-bold text-sm text-foreground">
                          {activeTemplate.projectCount} projects
                        </span>
                      }
                    />
                    <KeyValueRow
                      label="Configured Date"
                      value={new Date(activeTemplate.createdAt).toLocaleDateString()}
                    />
                  </div>

                  <div className="border-t border-border pt-3 space-y-2">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/projects/new?templateId=${activeTemplate.id}`}>
                        Instantiate New Project
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full" size="sm">
                      <Link href={`/projects/templates/${activeTemplate.id}`}>
                        View Template Blueprint
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
