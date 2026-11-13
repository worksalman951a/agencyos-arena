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
import { listInvoices, type InvoiceResponse } from '@/lib/services/crm/invoice-service';
import { getCurrentPermissions } from '@/lib/current-user';
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

  const [workspaceResult, membersResult, contractsResult, invoicesResult, permissions] =
    await Promise.all([
      loadPageData(() => getProjectWorkspaceDetails(id)),
      loadPageData(() => listProjectMembers()),
      loadPageData(() => listContracts()),
      // Related invoices come from the invoice service, so they carry its own
      // authorization (`invoice.read`) and organization scoping. A project
      // reader without invoice access gets no invoice section at all.
      loadPageData(() =>
        listInvoices({
          page: 1,
          pageSize: 50,
          projectId: id,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          includeDeleted: false,
        })
      ),
      getCurrentPermissions(),
    ]);

  // Never offer an action the invoice service would reject: new invoices need
  // `invoice.create` and a project that is neither deleted nor archived.
  const canCreateInvoice =
    permissions.has('invoice.create') && !project.deletedAt && project.status !== 'archived';

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

      {invoicesResult.ok && (
        <div
          className="rounded-md border bg-background p-4 space-y-3"
          data-testid="project-invoices"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Invoices ({invoicesResult.data.total})</h2>
            <div className="flex items-center gap-2">
              {invoicesResult.data.total > 0 && (
                <Link
                  href={`/finance/invoices?projectId=${encodeURIComponent(project.id)}`}
                  className="text-xs text-accent hover:underline"
                >
                  View all
                </Link>
              )}
              {canCreateInvoice && (
                <Link
                  href={`/finance/invoices/new?projectId=${encodeURIComponent(project.id)}`}
                  className="px-3 py-1.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted"
                >
                  + New Invoice
                </Link>
              )}
            </div>
          </div>
          {invoicesResult.data.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices linked to this project yet.</p>
          ) : (
            <div className="divide-y divide-border text-sm">
              {invoicesResult.data.invoices.map((invoice: InvoiceResponse) => (
                <div key={invoice.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/finance/invoices/${invoice.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {invoice.number}
                    </Link>
                    <span className="ml-2 text-muted-foreground">{invoice.title}</span>
                  </div>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    <span className="capitalize">{invoice.status}</span>
                    {` · ${invoice.currency} ${invoice.total}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
