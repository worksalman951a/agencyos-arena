'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Layers } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  Chip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import './bento-contacts.css';

export interface PipelineStageItem {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  color: string | null;
  probability: number | null;
  isWon: boolean;
  isLost: boolean;
  pipeline: { id: string; name: string } | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface BentoPipelineStagesViewProps {
  stages: PipelineStageItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  pipelineIdFilter: string;
  onSearchChange: (val: string) => void;
  onPipelineFilterChange: (id: string) => void;
}

export function BentoPipelineStagesView({
  stages,
  total,
  totalPages,
  page,
  searchVal,
  pipelineIdFilter,
  onSearchChange,
  onPipelineFilterChange,
}: BentoPipelineStagesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [pipelineInput, setPipelineInput] = React.useState(pipelineIdFilter);

  const activeStage = stages[Math.min(selectedIdx, Math.max(0, stages.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
    onPipelineFilterChange(pipelineInput);
  };

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>CRM</span>
            <span>/</span>
            <span>Pipeline Stages</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Stages</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'stage' : 'stages'} configured in pipeline sequence
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/crm/pipelines">Pipelines</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/crm/pipeline-stages/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Stage
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
            placeholder="Search stages by name..."
            aria-label="Search stages"
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

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={pipelineInput}
            onChange={(e) => setPipelineInput(e.target.value)}
            placeholder="Filter by Pipeline ID..."
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by pipeline"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onPipelineFilterChange(pipelineInput)}
          >
            Filter
          </Button>
          {(searchVal || pipelineIdFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setSearchInput('');
                setPipelineInput('');
                onSearchChange('');
                onPipelineFilterChange('');
              }}
            >
              Clear
            </Button>
          )}
        </div>

        <div className="ml-auto text-xs font-medium text-muted-foreground">
          Showing {stages.length} of {total}
        </div>
      </div>

      {/* ── Bento 3-Column CRM Grid ───────────────────────────────────── */}
      {stages.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || pipelineIdFilter ? 'No stages match those filters' : 'No stages found'
            }
            sub="Get started by creating your first pipeline milestone stage."
          />
        </Panel>
      ) : (
        <div className="bento-crm-grid">
          {/* Column 1: Stages Master List */}
          <Panel title="Configured Stages" pad={false}>
            <div className="divide-y divide-border">
              {stages.map((s, i) => {
                const isSelected = activeStage?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="w-full text-left p-3.5 hover:bg-muted/40 transition flex items-center justify-between gap-3"
                    style={{
                      borderLeft: isSelected
                        ? '3px solid var(--pm-accent, #0f766e)'
                        : '3px solid transparent',
                      background: isSelected ? 'var(--pm-accent-soft, #ccfbf1)' : undefined,
                    }}
                    onClick={() => setSelectedIdx(i)}
                    aria-label={`${s.name}, Stage ${s.order}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded bg-muted text-muted-foreground flex items-center justify-center font-bold text-xs shrink-0">
                        {s.order}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-foreground text-xs truncate">
                          {s.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground truncate">
                          {s.pipeline?.name ?? 'Pipeline'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {s.isWon ? (
                        <StatusPill tone="ok">Won</StatusPill>
                      ) : s.isLost ? (
                        <StatusPill tone="idle">Lost</StatusPill>
                      ) : (
                        <Chip>{s.probability ? `${s.probability}%` : 'Standard'}</Chip>
                      )}
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
                      href={`/crm/pipeline-stages?page=${page - 1}&search=${encodeURIComponent(searchVal)}&pipelineId=${encodeURIComponent(pipelineIdFilter)}`}
                      className="hover:underline"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/crm/pipeline-stages?page=${page + 1}&search=${encodeURIComponent(searchVal)}&pipelineId=${encodeURIComponent(pipelineIdFilter)}`}
                      className="hover:underline"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Column 2: Selected Stage Detail Rail */}
          {activeStage && (
            <Panel
              title="Stage Overview"
              action={
                <Link
                  href={`/crm/pipeline-stages/${activeStage.id}`}
                  className="text-xs text-accent hover:underline font-medium"
                >
                  Full View
                </Link>
              }
            >
              <div className="space-y-4 text-xs">
                <div className="flex items-start gap-3 pb-3 border-b border-border">
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-ink flex items-center justify-center font-bold text-sm shrink-0">
                    <Layers size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground truncate">
                      {activeStage.name}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pipeline:{' '}
                      <span className="font-semibold text-foreground">
                        {activeStage.pipeline?.name ?? 'Standard'}
                      </span>
                    </p>
                  </div>
                  {activeStage.isWon ? (
                    <StatusPill tone="ok">Won</StatusPill>
                  ) : activeStage.isLost ? (
                    <StatusPill tone="idle">Lost</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Active</StatusPill>
                  )}
                </div>

                <div className="space-y-3">
                  <KeyValueRow label="Sequence Order" value={`Step ${activeStage.order}`} />
                  <KeyValueRow
                    label="Win Probability"
                    value={activeStage.probability ? `${activeStage.probability}%` : 'Standard'}
                  />
                  <KeyValueRow
                    label="Stage Type"
                    value={
                      activeStage.isWon
                        ? 'Terminal Won'
                        : activeStage.isLost
                          ? 'Terminal Lost'
                          : 'Progressive Milestone'
                    }
                  />
                  <KeyValueRow
                    label="Stage ID"
                    value={
                      <span className="font-mono text-muted-foreground">{activeStage.id}</span>
                    }
                  />
                </div>

                <div className="pt-2 border-t border-border flex gap-2">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/pipeline-stages/${activeStage.id}`}>View Stage</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/pipeline-stages/${activeStage.id}/edit`}>Edit Stage</Link>
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          {/* Column 3: Quick Navigation */}
          {activeStage && (
            <div className="bento-crm-side">
              <Panel title="Pipeline Context">
                <div className="flex flex-col gap-2 p-1 text-xs">
                  <Link
                    href={`/crm/opportunities?stageId=${encodeURIComponent(activeStage.id)}`}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 font-medium transition"
                  >
                    <span>Opportunities in this Stage</span>
                  </Link>
                  <Link
                    href="/crm/pipeline-stages/new"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 font-medium transition"
                  >
                    <span>Create Another Stage</span>
                    <Plus size={13} className="text-muted-foreground" />
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
