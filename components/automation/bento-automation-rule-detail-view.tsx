'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { RetryExecutionButton } from '@/app/automation/rules/[id]/RetryExecutionButton';
import type {
  WorkflowRuleResponse,
  WorkflowExecutionResponse,
} from '@/lib/services/automation/workflow-service';
import '@/components/crm/bento-contacts.css';

interface BentoAutomationRuleDetailViewProps {
  rule: WorkflowRuleResponse;
  executions: WorkflowExecutionResponse[];
}

export function BentoAutomationRuleDetailView({
  rule,
  executions,
}: BentoAutomationRuleDetailViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeExecution =
    executions[Math.min(selectedIdx, Math.max(0, executions.length - 1))] ?? null;

  const actions = (rule.actions as { list?: Array<{ type: string; title?: string }> }).list ?? [];

  const totalRuns = executions.length;
  const successRuns = executions.filter((e) => e.status === 'succeeded').length;
  const failedRuns = executions.filter((e) => e.status === 'failed').length;
  const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 100;

  const getExecutionTone = (status: string): 'ok' | 'danger' | 'warn' | undefined => {
    switch (status.toLowerCase()) {
      case 'succeeded':
      case 'success':
        return 'ok';
      case 'failed':
      case 'error':
        return 'danger';
      case 'running':
      case 'pending':
        return 'warn';
      default:
        return undefined;
    }
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href="/automation/rules" aria-label="Back to rules">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Automation</span>
              <span>/</span>
              <span>Rules</span>
              <span>/</span>
              <span className="font-mono">{rule.name}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {rule.name}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusPill tone={rule.enabled ? 'ok' : undefined}>
            {rule.enabled ? 'Engine Active' : 'Engine Standby'}
          </StatusPill>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/automation/rules">Rules Directory</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Dispatches',
            value: String(totalRuns),
            note: 'event executions recorded',
          },
          {
            label: 'Success Rate',
            value: totalRuns > 0 ? `${successRate}%` : '—',
            note: totalRuns > 0 ? `${successRuns} completed runs` : 'No runs yet',
            tone: totalRuns > 0 ? 'ok' : undefined,
          },
          {
            label: 'Failed Executions',
            value: String(failedRuns),
            note: 'action execution errors',
            tone: failedRuns > 0 ? 'danger' : undefined,
          },
        ]}
      />

      {/* ── Configuration Blueprint Panels ────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <Panel title="Trigger Conditions">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-border">
              <span className="text-muted-foreground">Trigger Type</span>
              <span className="font-mono font-semibold text-foreground">{rule.trigger}</span>
            </div>
            <div className="pt-2">
              <span className="text-muted-foreground block mb-1">Parsed Predicates (JSON):</span>
              <pre className="text-xs overflow-x-auto bg-muted/40 p-3 rounded font-mono border border-border">
                {JSON.stringify(rule.conditions, null, 2)}
              </pre>
            </div>
          </div>
        </Panel>

        <Panel title="Configured Actions">
          <div className="space-y-3 text-xs">
            {actions.length === 0 ? (
              <p className="text-muted-foreground italic">No actions defined.</p>
            ) : (
              <ul className="space-y-2">
                {actions.map((action, idx) => (
                  <li
                    key={idx}
                    className="p-2.5 rounded bg-muted/30 border border-border flex items-start justify-between"
                  >
                    <div>
                      <span className="font-mono font-semibold text-accent block">
                        {action.type}
                      </span>
                      {action.title && (
                        <span className="text-muted-foreground text-xs">{action.title}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      Step {idx + 1}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-2 border-t border-border flex items-center justify-between text-muted-foreground">
              <span>Rule Status</span>
              <span className="font-semibold text-foreground">
                {rule.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Execution History Register & Inspector ───────────────────── */}
      {executions.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No execution runs recorded yet"
            sub="Rules execute automatically when matching business domain events are dispatched."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Execution Run Register (${executions.length})`}>
              <div className="bento-sales-table-head">
                <span>Target Record</span>
                <span>Attempts</span>
                <span className="text-right">Execution Time</span>
                <span className="text-right">Run Status</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-border/60">
                {executions.map((exec, idx) => {
                  const isSelected = activeExecution?.id === exec.id;

                  return (
                    <div
                      key={exec.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedIdx(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedIdx(idx);
                        }
                      }}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {exec.recordType}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate font-mono">
                          {exec.recordId}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs font-mono text-muted-foreground">
                        {exec.attempts} attempt{exec.attempts === 1 ? '' : 's'}
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(exec.createdAt).toLocaleString()}
                      </div>

                      <div className="text-right">
                        <StatusPill tone={getExecutionTone(exec.status)}>{exec.status}</StatusPill>
                      </div>

                      <div className="text-right" onClick={(e) => e.stopPropagation()}>
                        {exec.status === 'failed' ? (
                          <RetryExecutionButton executionId={exec.id} />
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeExecution ? (
              <Panel
                title="Execution Inspector"
                action={
                  activeExecution.status === 'failed' ? (
                    <RetryExecutionButton executionId={activeExecution.id} />
                  ) : undefined
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Record Target
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {activeExecution.recordType}
                    </h3>
                    <code className="text-[11px] font-mono text-muted-foreground block truncate">
                      {activeExecution.recordId}
                    </code>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Run Status"
                      value={
                        <StatusPill tone={getExecutionTone(activeExecution.status)}>
                          {activeExecution.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Dispatch Attempts"
                      value={`${activeExecution.attempts} retry cycle(s)`}
                    />
                    <KeyValueRow
                      label="Executed At"
                      value={new Date(activeExecution.createdAt).toLocaleString()}
                    />
                    <KeyValueRow
                      label="Last Attempt"
                      value={
                        activeExecution.lastAttemptAt
                          ? new Date(activeExecution.lastAttemptAt).toLocaleString()
                          : 'Initial cycle'
                      }
                    />
                  </div>

                  <div className="border-t border-border pt-3">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                      Execution Result Logs:
                    </span>
                    <pre className="text-xs overflow-x-auto bg-muted/40 p-2.5 rounded font-mono border border-border max-h-56">
                      {JSON.stringify(activeExecution.resultLog, null, 2)}
                    </pre>
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
