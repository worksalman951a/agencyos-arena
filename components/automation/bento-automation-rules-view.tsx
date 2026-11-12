'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { RuleActions } from '@/app/automation/rules/RuleActions';
import type { WorkflowRuleResponse } from '@/lib/services/automation/workflow-service';
import '@/components/crm/bento-contacts.css';

interface BentoAutomationRulesViewProps {
  workflows: WorkflowRuleResponse[];
  createRuleFormNode: React.ReactNode;
}

export function BentoAutomationRulesView({
  workflows,
  createRuleFormNode,
}: BentoAutomationRulesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeRule = workflows[Math.min(selectedIdx, Math.max(0, workflows.length - 1))] ?? null;

  const totalRules = workflows.length;
  const enabledCount = workflows.filter((w) => w.enabled).length;
  const disabledCount = totalRules - enabledCount;

  // Derive actions count safely
  const getActionCount = (rule: WorkflowRuleResponse): number => {
    const actionsObj = rule.actions as { list?: unknown[] };
    return Array.isArray(actionsObj?.list) ? actionsObj.list.length : 0;
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Automation</span>
            <span>/</span>
            <span>Event-Driven Workflow Engine</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Automation Rules
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Orchestrate business triggers, status changes, assignments, and notification policies
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/automation/notifications">Notifications</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/automation/preferences">Notification Preferences</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Active Rules',
            value: String(totalRules),
            note: 'configured triggers across workspace',
          },
          {
            label: 'Enabled Rules',
            value: String(enabledCount),
            note: 'actively listening for event dispatches',
            tone: enabledCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Standby / Disabled',
            value: String(disabledCount),
            note: 'paused workflows',
            tone: disabledCount > 0 ? 'warn' : undefined,
          },
        ]}
      />

      {/* ── Rule Creation Panel ──────────────────────────────────────── */}
      <Panel title="Configure Workflow Rule">
        <p className="text-xs text-muted-foreground mb-4">
          Rules run when an event is dispatched for a record in this organization. Each rule
          executes at most once per record and status transition.
        </p>
        <div className="max-w-3xl">{createRuleFormNode}</div>
      </Panel>

      {/* ── Rules Grid & Inspector ───────────────────────────────────── */}
      {workflows.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No workflow rules configured yet"
            sub="Create your first event-driven rule above to automate record assignment and alerts."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Workflow Rules Directory (${workflows.length})`}>
              <div className="bento-sales-table-head">
                <span>Rule Name</span>
                <span>Trigger Event</span>
                <span className="text-right">Actions</span>
                <span className="text-right">Status</span>
                <span className="text-right">Manage</span>
              </div>

              <div className="divide-y divide-border/60">
                {workflows.map((rule, idx) => {
                  const isSelected = activeRule?.id === rule.id;
                  const actionCount = getActionCount(rule);

                  return (
                    <div
                      key={rule.id}
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
                          {rule.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate font-mono">
                          {rule.trigger}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs font-mono text-muted-foreground truncate">
                        {rule.trigger}
                      </div>

                      <div className="text-xs font-mono font-medium text-foreground text-right">
                        {actionCount} step{actionCount === 1 ? '' : 's'}
                      </div>

                      <div className="text-right">
                        <StatusPill tone={rule.enabled ? 'ok' : undefined}>
                          {rule.enabled ? 'Active' : 'Disabled'}
                        </StatusPill>
                      </div>

                      <div className="text-right" onClick={(e) => e.stopPropagation()}>
                        <RuleActions ruleId={rule.id} enabled={rule.enabled} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeRule ? (
              <Panel
                title="Rule Inspector"
                action={
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link href={`/automation/rules/${activeRule.id}`}>
                      Execution Log <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Workflow Blueprint
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">{activeRule.name}</h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Engine Status"
                      value={
                        <StatusPill tone={activeRule.enabled ? 'ok' : undefined}>
                          {activeRule.enabled ? 'Active Listening' : 'Disabled'}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Event Trigger"
                      value={<code className="font-mono text-xs">{activeRule.trigger}</code>}
                    />
                    <KeyValueRow
                      label="Configured Steps"
                      value={`${getActionCount(activeRule)} pipeline step(s)`}
                    />
                    <KeyValueRow
                      label="Created"
                      value={new Date(activeRule.createdAt).toLocaleDateString()}
                    />
                  </div>

                  <div className="border-t border-border pt-3 space-y-2">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/automation/rules/${activeRule.id}`}>
                        View Rule Record & Execution History
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
