/**
 * AgencyOS Project Detail page.
 * Displays a single project with progress metrics, milestones, tasks,
 * sub-module navigation, and recent activity history.
 * Employs ProjectDetailClient to toggle Bento vs legacy presentation.
 */

import Link from 'next/link';
import {
  getProject,
  getProjectWorkspaceDetails,
  listProjectMembers,
} from '@/lib/services/crm/project-service';
import { listContracts } from '@/lib/services/documents/contract-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import {
  ProjectActionsBar,
  ProjectMilestonesSection,
  ProjectTasksSection,
} from './ProjectWorkspaceClient';
import { ProjectDetailClient } from './project-detail-client';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const projectResult = await loadPageData(() => getProject(id));

  if (!projectResult.ok) {
    return (
      <PageStateNotice
        reason={projectResult.reason}
        backHref="/projects"
        backLabel="Back to projects"
      />
    );
  }

  const project = projectResult.data;

  const [workspaceResult, membersResult, contractsResult] = await Promise.all([
    loadPageData(() => getProjectWorkspaceDetails(id)),
    loadPageData(() => listProjectMembers()),
    loadPageData(() => listContracts()),
  ]);

  const projectContracts = contractsResult.ok
    ? (
        contractsResult.data as Array<{
          id: string;
          projectId: string | null;
          title: string;
          status: string;
          signedAt: Date | null;
        }>
      ).filter((c) => c.projectId === id)
    : [];

  const workspace = workspaceResult.ok
    ? workspaceResult.data
    : {
        milestones: [],
        timeSummary: { entryCount: 0, totalHours: 0, billableHours: 0, nonBillableHours: 0 },
        counts: { files: 0, approvals: 0, changeOrders: 0 },
        activity: [],
      };
  const members = membersResult.ok ? membersResult.data : [];

  const clientName = project.client
    ? `${project.client.firstName ?? ''} ${project.client.lastName ?? ''}`.trim() ||
      'Unnamed Client'
    : 'Internal Project';

  const submoduleLinksNode = (
    <div className="flex flex-wrap gap-2 border-b border-border pb-4">
      <Link
        href={`/projects/${project.id}/files`}
        className="px-3 py-1.5 rounded-md bg-muted text-sm font-medium hover:bg-muted/80"
      >
        Files ({workspace.counts.files})
      </Link>
      <Link
        href={`/projects/${project.id}/approvals`}
        className="px-3 py-1.5 rounded-md bg-muted text-sm font-medium hover:bg-muted/80"
      >
        Approvals ({workspace.counts.approvals})
      </Link>
      <Link
        href="/projects/change-orders"
        className="px-3 py-1.5 rounded-md bg-muted text-sm font-medium hover:bg-muted/80"
      >
        Change Orders ({workspace.counts.changeOrders})
      </Link>
      <Link
        href="/projects/time-entries"
        className="px-3 py-1.5 rounded-md bg-muted text-sm font-medium hover:bg-muted/80"
      >
        Time Entries ({workspace.timeSummary.entryCount})
      </Link>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <span className="sr-only">
        <Link href="/projects">Back to Projects</Link>
        <span>{clientName}</span>
      </span>
      <ProjectDetailClient
        project={project}
        workspace={workspace}
        members={members}
        contracts={projectContracts}
        actionsNode={
          <ProjectActionsBar
            projectId={project.id}
            status={project.status}
            isDeleted={Boolean(project.deletedAt)}
          />
        }
        milestonesNode={
          <ProjectMilestonesSection
            projectId={project.id}
            milestones={workspace.milestones}
            isDeleted={Boolean(project.deletedAt)}
          />
        }
        tasksNode={
          <ProjectTasksSection
            projectId={project.id}
            tasks={project.tasks}
            milestones={workspace.milestones}
            members={members}
            isDeleted={Boolean(project.deletedAt)}
          />
        }
        submoduleLinksNode={submoduleLinksNode}
      />
    </div>
  );
}
