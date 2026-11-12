'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Layers, AlertTriangle } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface BentoPipelineStageFormViewProps {
  mode: 'new' | 'edit';
  pipelineId?: string | null;
  stageId?: string;
  name: string;
  setName: (name: string) => void;
  order: number;
  setOrder: (order: number) => void;
  color: string;
  setColor: (color: string) => void;
  probability: string;
  setProbability: (prob: string) => void;
  isWon: boolean;
  setIsWon: (isWon: boolean) => void;
  isLost: boolean;
  setIsLost: (isLost: boolean) => void;
  onSubmit: (e?: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
}

export function BentoPipelineStageFormView({
  mode,
  pipelineId,
  name,
  setName,
  order,
  setOrder,
  color,
  setColor,
  probability,
  setProbability,
  isWon,
  setIsWon,
  isLost,
  setIsLost,
  onSubmit,
  isLoading,
  error,
}: Omit<BentoPipelineStageFormViewProps, 'stageId'>) {
  const isEdit = mode === 'edit';
  const backHref = pipelineId ? `/crm/pipelines/${pipelineId}` : '/crm/pipelines';

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
              <Link href="/crm/pipelines" className="hover:underline">
                CRM
              </Link>
              <span>/</span>
              <Link href={backHref} className="hover:underline">
                Pipeline
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Stage' : 'New Stage'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Stage: ${name || 'Untitled'}` : 'New Pipeline Stage'}
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
            onClick={() => onSubmit()}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : isEdit ? 'Update Stage' : 'Create Stage'}
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
            label: 'Stage Name',
            value: name || 'Unnamed Stage',
            note: `Step #${order} in pipeline sequence`,
          },
          {
            label: 'Forecast Probability',
            value: probability ? `${probability}%` : '0%',
            note: 'deal conversion expectation',
            tone: isWon ? 'ok' : isLost ? 'danger' : undefined,
          },
          {
            label: 'Terminal Classification',
            value: isWon ? 'CLOSED WON' : isLost ? 'CLOSED LOST' : 'PROGRESSIVE STAGE',
            note: isWon || isLost ? 'Terminal outcome state' : 'Active negotiation step',
            tone: isWon ? 'ok' : isLost ? 'danger' : undefined,
          },
          {
            label: 'Display Accent',
            value: color || '#3b82f6',
            note: 'visual Kanban header indicator',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Stage Specifications">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit(e);
              }}
              className="space-y-4 text-xs"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="stage-name"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Layers className="h-3.5 w-3.5 text-accent" />
                  Stage Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="stage-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Technical Feasibility"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label htmlFor="stage-order" className="font-semibold text-foreground">
                    Display Order <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="stage-order"
                    type="number"
                    value={order}
                    onChange={(e) => setOrder(parseInt(e.target.value, 10) || 0)}
                    className="h-8 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="stage-prob" className="font-semibold text-foreground">
                    Probability (%)
                  </label>
                  <Input
                    id="stage-prob"
                    type="number"
                    min="0"
                    max="100"
                    value={probability}
                    onChange={(e) => setProbability(e.target.value)}
                    placeholder="0-100"
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="stage-color" className="font-semibold text-foreground">
                    Color Accent (hex)
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={color || '#3b82f6'}
                      onChange={(e) => setColor(e.target.value)}
                      className="h-8 w-8 rounded border border-input cursor-pointer p-0.5 bg-background"
                    />
                    <Input
                      id="stage-color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      placeholder="#3b82f6"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="text-[11px] font-semibold text-foreground">
                  Terminal Outcome Flags
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded border border-border bg-muted/20">
                    <input
                      type="checkbox"
                      checked={isWon}
                      disabled={isLoading}
                      onChange={(e) => {
                        setIsWon(e.target.checked);
                        if (e.target.checked) setIsLost(false);
                      }}
                      className="rounded border-input text-accent bg-background"
                    />
                    <div>
                      <div className="font-semibold text-foreground">Won Stage</div>
                      <div className="text-[10px] text-muted-foreground">
                        Deals in this stage are marked as Won
                      </div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded border border-border bg-muted/20">
                    <input
                      type="checkbox"
                      checked={isLost}
                      disabled={isLoading}
                      onChange={(e) => {
                        setIsLost(e.target.checked);
                        if (e.target.checked) setIsWon(false);
                      }}
                      className="rounded border-input text-accent bg-background"
                    />
                    <div>
                      <div className="font-semibold text-foreground">Lost Stage</div>
                      <div className="text-[10px] text-muted-foreground">
                        Deals in this stage are marked as Lost
                      </div>
                    </div>
                  </label>
                </div>
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
                  {isLoading ? 'Saving...' : isEdit ? 'Update Stage' : 'Create Stage'}
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
                  Stage Preview
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color || '#3b82f6' }}
                  />
                  <span>{name || 'Untitled Stage'}</span>
                  {isWon && <StatusPill tone="ok">Won</StatusPill>}
                  {isLost && <StatusPill tone="danger">Lost</StatusPill>}
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Pipeline stages define sequential milestones for tracking opportunity progress in
                  kanban and list boards.
                </p>
                <p className="pt-1">
                  Ensure the order sequence aligns with your organization&apos;s standard sales
                  methodology.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
