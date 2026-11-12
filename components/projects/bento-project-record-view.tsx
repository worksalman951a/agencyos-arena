'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { formatDecimalMoney } from '@/lib/finance/decimal-utils';
import type {
  ProjectResponse,
  ProjectWorkspaceDetails,
  ProjectMemberSummary,
} from '@/lib/services/crm/project-service';
import '@/components/crm/bento-contacts.css';

interface BentoProjectRecordViewProps {
  project: ProjectResponse;
  workspace: ProjectWorkspaceDetails;
  members: ProjectMemberSummary[];
  contracts: Array<{
    id: string;
    title: string;
    status: string;
    signedAt: Date | null;
  }>;
  actionsNode: React.ReactNode;
  milestonesNode: React.ReactNode;
  tasksNode: React.ReactNode;
}

export function BentoProjectRecordView({
  project,
  workspace,
  contracts,
  actionsNode,
  milestonesNode,
  tasksNode,
}: BentoProjectRecordViewProps) {
  const clientName = project.client
    ? `${project.client.firstName ?? ''} ${project.client.lastName ?? ''}`.trim() ||
      'Unnamed Client'
    : 'Internal Project';

  const totalTasks = project.tasks.length;
  const completedTasks = project.tasks.filter((t) => t.status === 'done').length;
  const taskProgressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const totalMilestones = workspace.milestones.length;
  const completedMilestones = workspace.milestones.filter((m) => m.status === 'completed').length;

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'ok';
      case 'active':
        return 'warn';
      case 'on-hold':
        return 'danger';
      default:
        return undefined;
    }
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Breadcrumb & Top Header ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href="/projects" aria-label="Back to projects">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Projects</span>
              <span>/</span>
              <span>{project.name}</span>
            </div>
            <div className="flex items-center gap-2.5 mt-0.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.name}</h1>
              <StatusPill tone={getStatusTone(project.status)}>{project.status}</StatusPill>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">{actionsNode}</div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Task Progress',
            value: `${taskProgressPct}%`,
            note: `${completedTasks} of ${totalTasks} tasks completed`,
            tone: taskProgressPct >= 70 ? 'ok' : undefined,
          },
          {
            label: 'Milestones Reached',
            value: `${completedMilestones}/${totalMilestones}`,
            note: 'delivery gates',
            tone: completedMilestones === totalMilestones && totalMilestones > 0 ? 'ok' : undefined,
          },
          {
            label: 'Budget Allocated',
            value: project.budget ? `$${formatDecimalMoney(project.budget)}` : 'No budget',
            note: 'approved funding ceiling',
          },
          {
            label: 'Logged Billable Time',
            value: `${workspace.timeSummary.billableHours.toFixed(1)} hrs`,
            note: `${workspace.timeSummary.totalHours.toFixed(1)} hrs gross logged`,
            tone: workspace.timeSummary.billableHours > 0 ? 'ok' : undefined,
          },
        ]}
      />

      {/* ── Submodule Navigation Tabs ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-lg border bg-card text-xs">
        <Link
          href={`/projects/${project.id}/files`}
          className="px-3 py-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Files ({workspace.counts.files})
        </Link>
        <Link
          href={`/projects/${project.id}/approvals`}
          className="px-3 py-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Approvals ({workspace.counts.approvals})
        </Link>
        <Link
          href="/projects/change-orders"
          className="px-3 py-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Change Orders ({workspace.counts.changeOrders})
        </Link>
        <Link
          href="/projects/time-entries"
          className="px-3 py-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Time Log ({workspace.timeSummary.entryCount})
        </Link>
      </div>

      {/* ── Bento 2-Column Content Layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Tasks & Milestones Interactive Sections (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Milestones Integrated Section */}
          <Panel title="Milestones & Delivery Gates">{milestonesNode}</Panel>

          {/* Tasks Integrated Section */}
          <Panel title="Project Tasks & Deliverables">{tasksNode}</Panel>

          {/* Description */}
          {project.description && (
            <Panel title="Project Charter & Scope">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {project.description}
              </p>
            </Panel>
          )}
        </div>

        {/* Right Column: Context, Contracts & Metadata (1 col) */}
        <div className="space-y-6 min-w-0">
          <Panel title="Client & Account Context">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Client Contact"
                value={
                  project.clientId ? (
                    <Link
                      href={`/crm/contacts/${project.clientId}`}
                      className="text-accent hover:underline font-semibold"
                    >
                      {clientName}
                    </Link>
                  ) : (
                    'Internal Project'
                  )
                }
              />
              {project.client?.account && (
                <KeyValueRow
                  label="Commercial Account"
                  value={
                    <Link
                      href={`/crm/accounts/${project.client.account.id}`}
                      className="text-accent hover:underline font-semibold"
                    >
                      {project.client.account.name}
                    </Link>
                  }
                />
              )}
              <KeyValueRow
                label="Timeline"
                value={
                  <span className="font-mono">
                    {project.startDate ? new Date(project.startDate).toLocaleDateString() : 'TBD'}{' '}
                    &rarr;{' '}
                    {project.endDate ? new Date(project.endDate).toLocaleDateString() : 'Ongoing'}
                  </span>
                }
              />
              <KeyValueRow
                label="Lifecycle Status"
                value={
                  <StatusPill tone={getStatusTone(project.status)}>{project.status}</StatusPill>
                }
              />
            </div>
          </Panel>

          {/* Associated Contracts */}
          <Panel title="Associated Contracts">
            {contracts.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">
                No active contracts linked to this project.
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {contracts.map((c) => (
                  <div
                    key={c.id}
                    className="p-2.5 rounded-md border bg-muted/10 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-foreground">{c.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.signedAt
                          ? `Signed ${new Date(c.signedAt).toLocaleDateString()}`
                          : 'Pending Execution'}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link href={`/documents/contracts/${c.id}`}>View</Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Activity Trail */}
          <Panel title="Audit History">
            {workspace.activity.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">
                No recent workspace activity recorded.
              </div>
            ) : (
              <div className="space-y-2.5 text-xs">
                {workspace.activity.slice(0, 5).map((act) => (
                  <div key={act.id} className="border-b border-border/40 pb-2">
                    <div className="font-semibold text-foreground text-[11px]">
                      {act.action} on {act.entityType}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex justify-between mt-0.5">
                      <span>{act.actorName || 'System'}</span>
                      <span>{new Date(act.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
