'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, ArrowUpRight, GitBranch } from 'lucide-react';
import { Panel, EmptyState, KeyValueRow, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import './bento-contacts.css';

export interface PipelineItem {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoPipelinesViewProps {
  pipelines: PipelineItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  onSearchChange: (val: string) => void;
}

export function BentoPipelinesView({
  pipelines,
  total,
  totalPages,
  page,
  searchVal,
  onSearchChange,
}: BentoPipelinesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activePipeline =
    pipelines[Math.min(selectedIdx, Math.max(0, pipelines.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>CRM</span>
            <span>/</span>
            <span>Pipeline Architecture</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Pipelines</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'pipeline' : 'pipelines'} configured in your organization
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/crm/pipeline-stages">Manage All Stages</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/crm/pipelines/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Pipeline
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <form onSubmit={handleSearchSubmit} className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search pipelines..."
            aria-label="Search pipelines"
          />
          {searchInput && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchInput('');
                onSearchChange('');
              }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </form>

        <div className="ml-auto text-xs font-medium text-muted-foreground">
          Showing {pipelines.length} of {total}
        </div>
      </div>

      {/* ── Bento 3-Column CRM Grid ───────────────────────────────────── */}
      {pipelines.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={searchVal ? 'No pipelines match those terms' : 'No pipelines found'}
            sub="Get started by creating your primary sales pipeline."
          />
        </Panel>
      ) : (
        <div className="bento-crm-grid">
          {/* Column 1: Pipelines Master List */}
          <Panel title="Pipelines" pad={false}>
            <div className="divide-y divide-border">
              {pipelines.map((p, i) => {
                const isSelected = activePipeline?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left p-3.5 hover:bg-muted/40 transition flex items-center justify-between gap-3"
                    style={{
                      borderLeft: isSelected
                        ? '3px solid var(--pm-accent, #0f766e)'
                        : '3px solid transparent',
                      background: isSelected ? 'var(--pm-accent-soft, #ccfbf1)' : undefined,
                    }}
                    onClick={() => setSelectedIdx(i)}
                    aria-label={`${p.name}, ${p.isDefault ? 'Default' : 'Custom'}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center font-bold text-xs shrink-0">
                        <GitBranch size={14} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-foreground text-xs truncate">
                          {p.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground truncate">
                          {p.description ?? 'No description'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {p.isDefault && <StatusPill tone="ok">Default</StatusPill>}
                    </div>
                  </button>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={`/crm/pipelines?page=${page - 1}&search=${encodeURIComponent(searchVal)}`}
                      className="hover:underline"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/crm/pipelines?page=${page + 1}&search=${encodeURIComponent(searchVal)}`}
                      className="hover:underline"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Column 2: Selected Pipeline Detail Rail */}
          {activePipeline && (
            <Panel
              title="Pipeline Configuration"
              action={
                <Link
                  href={`/crm/pipelines/${activePipeline.id}`}
                  className="text-xs text-accent hover:underline flex items-center gap-1 font-medium"
                >
                  View Stages <ArrowUpRight size={12} />
                </Link>
              }
            >
              <div className="space-y-4 text-xs">
                <div className="flex items-start gap-3 pb-3 border-b border-border">
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-sm shrink-0">
                    <GitBranch size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground truncate">
                      {activePipeline.name}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activePipeline.isDefault
                        ? 'Primary organization sales workflow'
                        : 'Custom pipeline'}
                    </p>
                  </div>
                  {activePipeline.isDefault && <StatusPill tone="ok">Default</StatusPill>}
                </div>

                <div className="space-y-3">
                  <KeyValueRow label="Description" value={activePipeline.description ?? '—'} />
                  <KeyValueRow
                    label="Status"
                    value={activePipeline.isDefault ? 'Default Routing' : 'Active Custom'}
                  />
                  <KeyValueRow
                    label="Configured On"
                    value={new Date(activePipeline.createdAt).toLocaleDateString()}
                  />
                </div>

                <div className="pt-2 border-t border-border flex gap-2">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/pipelines/${activePipeline.id}`}>View Stages</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/pipelines/${activePipeline.id}/edit`}>Edit Pipeline</Link>
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          {/* Column 3: Quick Navigation */}
          {activePipeline && (
            <div className="bento-crm-side">
              <Panel title="Stages & Opportunities">
                <div className="flex flex-col gap-2 p-1 text-xs">
                  <Link
                    href={`/crm/pipeline-stages/new?pipelineId=${encodeURIComponent(activePipeline.id)}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 font-medium transition"
                  >
                    <span>Add Stage to Pipeline</span>
                    <Plus size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href="/crm/pipeline-stages"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 font-medium transition"
                  >
                    <span>All Pipeline Stages</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                  <Link
                    href="/crm/opportunities"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 font-medium transition"
                  >
                    <span>Active Opportunities</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
