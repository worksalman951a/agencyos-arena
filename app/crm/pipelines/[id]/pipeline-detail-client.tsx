'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, ArrowLeft, GitCommit } from 'lucide-react';
import {
  Panel,
  KeyValueRow,
  StatusPill,
  Chip,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface PipelineData {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface StageData {
  id: string;
  name: string;
  order: number;
  color: string | null;
  probability: number | null;
  isWon: boolean;
  isLost: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface PipelineDetailClientProps {
  pipeline: PipelineData;
  stages: StageData[];
  total: number;
  page: number;
  totalPages: number;
}

export function PipelineDetailClient({
  pipeline,
  stages,
  total,
  page,
  totalPages,
}: PipelineDetailClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <div className="bento-crm space-y-6">
        {/* ── Page Header ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/pipelines" className="hover:underline flex items-center gap-1">
                <ArrowLeft size={12} /> Pipelines
              </Link>
              <span>/</span>
              <span>{pipeline.name}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{pipeline.name}</h1>
              {pipeline.isDefault && <StatusPill tone="ok">Default Pipeline</StatusPill>}
            </div>
            {pipeline.description && (
              <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                {pipeline.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/crm/pipelines/${pipeline.id}/edit`}>Edit Pipeline</Link>
            </Button>
            <Button
              asChild
              className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
              size="sm"
            >
              <Link
                href={`/crm/pipeline-stages/new?pipelineId=${pipeline.id}`}
                className="flex items-center gap-1.5"
              >
                <Plus size={14} strokeWidth={2.4} /> Add Stage
              </Link>
            </Button>
          </div>
        </div>

        {/* ── Top StatStrip ────────────────────────────────────────────── */}
        <StatStrip
          stats={[
            {
              label: 'Total Stages',
              value: String(total),
              note: 'Sequence steps configured',
            },
            {
              label: 'Default Status',
              value: pipeline.isDefault ? 'Primary' : 'Secondary',
              tone: pipeline.isDefault ? 'ok' : undefined,
              note: pipeline.isDefault ? 'Assigned to new deals by default' : 'Manual assignment',
            },
            {
              label: 'Pipeline ID',
              value: pipeline.id.slice(0, 8) + '...',
              note: 'Organization-scoped',
            },
          ]}
        />

        {/* ── Stages Progression Flow ──────────────────────────────────── */}
        <Panel title="Configured Milestone Sequence">
          {stages.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No stages in this pipeline. Add your first progression stage.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {stages.map((stg) => (
                  <div
                    key={stg.id}
                    className="p-3.5 rounded-xl border border-border bg-card/60 flex flex-col justify-between gap-2 shadow-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded bg-muted text-muted-foreground flex items-center justify-center font-bold text-[11px]">
                          {stg.order}
                        </span>
                        <span className="font-semibold text-xs text-foreground truncate">
                          {stg.name}
                        </span>
                      </div>
                      {stg.isWon ? (
                        <StatusPill tone="ok">Won</StatusPill>
                      ) : stg.isLost ? (
                        <StatusPill tone="idle">Lost</StatusPill>
                      ) : (
                        <Chip>{stg.probability ? `${stg.probability}%` : 'Standard'}</Chip>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/50">
                      <span>Prob: {stg.probability ? `${stg.probability}%` : 'N/A'}</span>
                      <div className="flex gap-2">
                        <Link
                          href={`/crm/pipeline-stages/${stg.id}`}
                          className="text-accent hover:underline font-medium"
                        >
                          View
                        </Link>
                        <Link
                          href={`/crm/pipeline-stages/${stg.id}/edit`}
                          className="hover:underline font-medium"
                        >
                          Edit
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* ── Metadata Panel ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Panel title="Pipeline Properties">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Internal ID"
                value={<span className="font-mono">{pipeline.id}</span>}
              />
              <KeyValueRow
                label="Created At"
                value={new Date(pipeline.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Last Updated"
                value={new Date(pipeline.updatedAt).toLocaleDateString()}
              />
            </div>
          </Panel>

          <Panel title="Pipeline Actions">
            <div className="flex flex-col gap-2 p-1 text-xs">
              <Link
                href={`/crm/opportunities?pipelineId=${pipeline.id}`}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 font-medium transition"
              >
                <span>View Opportunities in this Pipeline</span>
                <GitCommit size={14} className="text-muted-foreground" />
              </Link>
              <Link
                href={`/crm/pipeline-stages/new?pipelineId=${pipeline.id}`}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 font-medium transition"
              >
                <span>Add Milestone Stage</span>
                <Plus size={14} className="text-muted-foreground" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{pipeline.name}</h1>
          {pipeline.description && <p className="text-muted-foreground">{pipeline.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link
            href="/crm/pipelines/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Pipeline
          </Link>
          <Link
            href={`/crm/pipeline-stages/new?pipelineId=${pipeline.id}`}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Stage
          </Link>
          <Link
            href="/crm/pipelines"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Pipelines
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Pipeline Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="font-medium">{pipeline.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Description</dt>
              <dd className="font-medium">{pipeline.description ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Default Pipeline</dt>
              <dd
                className={`font-medium ${pipeline.isDefault ? 'text-green-800' : 'text-muted-foreground'}`}
              >
                {pipeline.isDefault ? 'Yes' : 'No'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total Stages</dt>
              <dd className="font-medium">{total}</dd>
            </div>
          </dl>
        </div>
      </div>

      <h2 className="text-xl font-bold">Stages</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Order</th>
              <th className="pb-3 font-medium">Color</th>
              <th className="pb-3 font-medium">Probability</th>
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stages.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No stages found. Add a stage to get started.
                </td>
              </tr>
            ) : (
              stages.map((stage) => (
                <tr key={stage.id} className="border-b border-border text-sm hover:bg-muted/50">
                  <td className="py-3 font-medium">{stage.name}</td>
                  <td className="py-3">{stage.order}</td>
                  <td className="py-3">
                    {stage.color ? (
                      <span
                        className="inline-block w-4 h-4 rounded-full border border-border"
                        style={{ backgroundColor: stage.color }}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3">{stage.probability ? `${stage.probability}%` : '—'}</td>
                  <td className="py-3">
                    {stage.isWon ? (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                        Won
                      </span>
                    ) : stage.isLost ? (
                      <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                        Lost
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Standard</span>
                    )}
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/crm/pipeline-stages/${stage.id}`}
                      className="text-accent hover:underline text-sm font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </div>
      )}
    </div>
  );
}
