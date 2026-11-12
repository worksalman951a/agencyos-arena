'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoProjectRecordView } from '@/components/projects/bento-project-record-view';
import type {
  ProjectResponse,
  ProjectWorkspaceDetails,
  ProjectMemberSummary,
} from '@/lib/services/crm/project-service';

interface ProjectDetailClientProps {
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
  submoduleLinksNode: React.ReactNode;
}

export function ProjectDetailClient(props: ProjectDetailClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <BentoProjectRecordView
        project={props.project}
        workspace={props.workspace}
        members={props.members}
        contracts={props.contracts}
        actionsNode={props.actionsNode}
        milestonesNode={props.milestonesNode}
        tasksNode={props.tasksNode}
      />
    );
  }

  // Legacy Presentation
  const {
    project,
    workspace,
    contracts,
    actionsNode,
    milestonesNode,
    tasksNode,
    submoduleLinksNode,
  } = props;

  const clientName = project.client
    ? `${project.client.firstName ?? ''} ${project.client.lastName ?? ''}`.trim() ||
      'Unnamed Client'
    : 'Internal Project';

  const totalTasks = project.tasks.length;
  const completedTasks = project.tasks.filter((t) => t.status === 'done').length;
  const taskProgressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const totalMilestones = workspace.milestones.length;
  const completedMilestones = workspace.milestones.filter((m) => m.status === 'completed').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                project.status === 'completed'
                  ? 'bg-green-100 text-green-800'
                  : project.status === 'archived'
                    ? 'bg-muted text-muted-foreground'
                    : project.status === 'on-hold'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
              }`}
            >
              {project.status}
            </span>
            {project.deletedAt && (
              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-destructive/15 text-destructive">
                Deleted
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {clientName}
            {project.client?.account ? ` · ${project.client.account.name}` : ''}
          </p>
        </div>

        {actionsNode}
      </div>

      {submoduleLinksNode}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Task Progress</div>
          <div className="text-2xl font-bold mt-1">{taskProgressPct}%</div>
          <div className="text-xs text-muted-foreground mt-1">
            {completedTasks} of {totalTasks} tasks completed
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Milestones</div>
          <div className="text-2xl font-bold mt-1">
            {completedMilestones} / {totalMilestones}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Milestones reached</div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Budget</div>
          <div className="text-2xl font-bold mt-1">
            {project.budget ? `$${project.budget}` : '—'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Total budget allocated</div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Hours Logged</div>
          <div className="text-2xl font-bold mt-1">
            {workspace.timeSummary.totalHours.toFixed(1)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {workspace.timeSummary.billableHours.toFixed(1)} billable hrs (
            {workspace.timeSummary.entryCount} entries)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {milestonesNode}
          {tasksNode}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold">Project Details</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Timeline</dt>
                <dd className="font-medium text-right">
                  {project.startDate ? new Date(project.startDate).toLocaleDateString() : '—'} to{' '}
                  {project.endDate ? new Date(project.endDate).toLocaleDateString() : '—'}
                </dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="font-medium">{new Date(project.createdAt).toLocaleDateString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Last Updated</dt>
                <dd className="font-medium">{new Date(project.updatedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Contracts</h2>
              <span className="text-xs text-muted-foreground">{contracts.length} linked</span>
            </div>
            {contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contracts linked to this project.</p>
            ) : (
              <div className="space-y-2">
                {contracts.map((contract) => (
                  <div
                    key={contract.id}
                    className="flex items-center justify-between p-2 rounded-md border border-border text-sm"
                  >
                    <div>
                      <Link
                        href={`/documents/contracts/${contract.id}`}
                        className="font-medium hover:underline text-accent"
                      >
                        {contract.title}
                      </Link>
                      <div className="text-xs text-muted-foreground capitalize">
                        {contract.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
