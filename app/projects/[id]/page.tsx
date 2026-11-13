/**
 * AgencyOS Project Detail page.
 * Displays a single project with progress metrics, milestones, tasks,
 * sub-module navigation (files, approvals, change orders, time entries),
 * and recent activity history.
 */

import Link from 'next/link';
import {
  getProject,
  getProjectWorkspaceDetails,
  listProjectMembers,
} from '@/lib/services/crm/project-service';
import { listContracts } from '@/lib/services/documents/contract-service';
import { listInvoices, type InvoiceResponse } from '@/lib/services/crm/invoice-service';
import { getProjectFinancialSummary } from '@/lib/services/crm/project-financial-summary-service';
import { getCurrentPermissions } from '@/lib/current-user';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import {
  ProjectActionsBar,
  ProjectMilestonesSection,
  ProjectTasksSection,
} from './ProjectWorkspaceClient';
import { ProjectFinancialOverview } from './ProjectFinancialOverview';

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

  const canViewFinancialOverview = [
    'project.read',
    'invoice.read',
    'expense.read',
    'time.entry.read',
    'change.order.read',
  ].every((permission) => permissions.has(permission));
  const financialResult = canViewFinancialOverview
    ? await loadPageData(() => getProjectFinancialSummary(id))
    : null;

  // Never offer an action the invoice service would reject: new invoices need
  // `invoice.create` and a project that is neither deleted nor archived.
  const canCreateInvoice =
    permissions.has('invoice.create') && !project.deletedAt && project.status !== 'archived';
  const canLogTime =
    permissions.has('time.entry.create') && !project.deletedAt && project.status !== 'archived';

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
        timeSummary: {
          entryCount: 0,
          totalHours: 0,
          billableHours: 0,
          nonBillableHours: 0,
          ratedBillableEntryCount: 0,
          unratedBillableEntryCount: 0,
          unratedBillableHours: 0,
          billableAmountsByCurrency: [],
        },
        counts: { files: 0, approvals: 0, changeOrders: 0 },
        activity: [],
      };
  const members = membersResult.ok ? membersResult.data : [];

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
    <div className="space-y-6 p-6">
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

        <ProjectActionsBar
          projectId={project.id}
          status={project.status}
          isDeleted={Boolean(project.deletedAt)}
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        <Link
          href={`/projects/${project.id}/files`}
          className="px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
        >
          Files ({workspace.counts.files})
        </Link>
        <Link
          href={`/projects/${project.id}/approvals`}
          className="px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
        >
          Approvals ({workspace.counts.approvals})
        </Link>
        <Link
          href={`/projects/change-orders?projectId=${project.id}`}
          className="px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
        >
          Change Orders ({workspace.counts.changeOrders})
        </Link>
        {permissions.has('time.entry.read') && (
          <Link
            href={`/projects/time-entries?projectId=${project.id}`}
            className="px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
          >
            Time Entries ({workspace.timeSummary.totalHours.toFixed(1)} hrs)
          </Link>
        )}
        {permissions.has('expense.read') && permissions.has('project.read') && (
          <Link
            href={`/finance/expenses?projectId=${encodeURIComponent(project.id)}`}
            className="px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
          >
            Expenses
          </Link>
        )}
        {canLogTime && (
          <Link
            href={`/projects/time-entries/new?projectId=${encodeURIComponent(project.id)}`}
            className="px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
          >
            + Log Time
          </Link>
        )}
      </div>

      {financialResult?.ok ? (
        <ProjectFinancialOverview summary={financialResult.data} />
      ) : financialResult ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          Financial overview is currently unavailable.
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="rounded-md border bg-background p-4 space-y-3">
            <h2 className="text-lg font-semibold">Progress Overview</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Task Completion</span>
                <span className="font-medium">
                  {completedTasks} / {totalTasks} tasks ({taskProgressPct}%)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${taskProgressPct}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-sm">
              <div className="border rounded-md p-2.5">
                <div className="text-xs text-muted-foreground">Milestones</div>
                <div className="font-semibold">
                  {completedMilestones}/{totalMilestones} done
                </div>
              </div>
              {permissions.has('time.entry.read') && (
                <>
                  <div className="border rounded-md p-2.5">
                    <div className="text-xs text-muted-foreground">Total Hours</div>
                    <div className="font-semibold">
                      {workspace.timeSummary.totalHours.toFixed(1)} hrs
                    </div>
                  </div>
                  <div className="border rounded-md p-2.5">
                    <div className="text-xs text-muted-foreground">Billable Hours</div>
                    <div className="font-semibold text-green-700">
                      {workspace.timeSummary.billableHours.toFixed(1)} hrs
                    </div>
                  </div>
                  <div className="border rounded-md p-2.5">
                    <div className="text-xs text-muted-foreground">Non-Billable</div>
                    <div className="font-semibold">
                      {workspace.timeSummary.nonBillableHours.toFixed(1)} hrs
                    </div>
                  </div>
                </>
              )}
            </div>
            {permissions.has('time.entry.read') &&
              (workspace.timeSummary.billableAmountsByCurrency.length > 0 ||
                workspace.timeSummary.unratedBillableEntryCount > 0) && (
                <div
                  className="border rounded-md p-2.5 text-sm flex flex-wrap items-center justify-between gap-2"
                  data-testid="project-billable-summary"
                >
                  <span className="text-xs text-muted-foreground uppercase">
                    Billable Time Value (estimate)
                  </span>
                  <div className="flex flex-wrap items-center gap-3 font-medium">
                    {workspace.timeSummary.billableAmountsByCurrency.map((bucket) => (
                      <span key={bucket.currency} className="text-green-700">
                        {formatMinorUnitsAsCurrency(bucket.amountMinor, bucket.currency)}{' '}
                        <span className="text-xs text-muted-foreground">{bucket.currency}</span>
                      </span>
                    ))}
                    {workspace.timeSummary.unratedBillableEntryCount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ({workspace.timeSummary.unratedBillableHours.toFixed(1)} hrs unrated)
                      </span>
                    )}
                  </div>
                </div>
              )}
          </div>

          <div className="rounded-md border bg-background p-4">
            <h2 className="text-lg font-semibold mb-2">Client & Template</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Client Contact</dt>
                <dd>
                  {project.clientId ? (
                    <Link
                      href={`/crm/contacts/${project.clientId}`}
                      className="text-accent hover:underline"
                    >
                      {clientName}
                    </Link>
                  ) : (
                    'Internal Project'
                  )}
                </dd>
              </div>
              {project.client?.account && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Account</dt>
                  <dd>
                    <Link
                      href={`/crm/accounts/${project.client.account.id}`}
                      className="text-accent hover:underline"
                    >
                      {project.client.account.name}
                    </Link>
                  </dd>
                </div>
              )}
              {project.template && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Template</dt>
                  <dd>
                    <Link
                      href={`/projects/templates/${project.template.id}`}
                      className="text-accent hover:underline"
                    >
                      {project.template.name}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Start Date</dt>
              <dd className="font-medium text-right">
                {project.startDate ? new Date(project.startDate).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">End Date</dt>
              <dd className="font-medium text-right">
                {project.endDate ? new Date(project.endDate).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <dt className="text-muted-foreground">Tasks</dt>
              <dd className="font-medium text-right">{totalTasks}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Milestones</dt>
              <dd className="font-medium text-right">{totalMilestones}</dd>
            </div>
          </dl>
        </div>
      </div>

      {project.description && (
        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Description</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{project.description}</p>
        </div>
      )}

      <div className="rounded-md border bg-background p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Contracts ({projectContracts.length})</h2>
          {!project.deletedAt && (
            <Link
              href={`/documents/contracts/new?projectId=${encodeURIComponent(project.id)}&title=${encodeURIComponent(`${project.name} Contract`)}`}
              className="px-3 py-1.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted"
            >
              + New Contract
            </Link>
          )}
        </div>
        {projectContracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contracts linked to this project yet.</p>
        ) : (
          <div className="divide-y divide-border text-sm">
            {projectContracts.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between">
                <Link
                  href={`/documents/contracts/${c.id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {c.title}
                </Link>
                <span className="text-xs capitalize text-muted-foreground">
                  {c.status}
                  {c.signedAt ? ` · Signed ${new Date(c.signedAt).toLocaleDateString()}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

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

      <ProjectMilestonesSection
        projectId={project.id}
        milestones={workspace.milestones}
        isDeleted={Boolean(project.deletedAt)}
      />

      <ProjectTasksSection
        projectId={project.id}
        tasks={project.tasks}
        milestones={workspace.milestones}
        members={members}
        isDeleted={Boolean(project.deletedAt)}
      />

      <div className="rounded-md border bg-background p-4 space-y-3">
        <h2 className="text-lg font-semibold">Activity History</h2>
        {workspace.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {workspace.activity.map((entry) => (
              <li
                key={entry.id}
                className="py-2 flex flex-col sm:flex-row sm:justify-between gap-1"
              >
                <div>
                  <span className="font-medium">{entry.action}</span>{' '}
                  <span className="text-muted-foreground">({entry.entityType})</span>{' '}
                  {entry.actorName && (
                    <span className="text-muted-foreground">by {entry.actorName}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
