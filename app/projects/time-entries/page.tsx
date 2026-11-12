/**
 * AgencyOS Time Entries page.
 * Lists time entries across the organization's projects and tasks with
 * billable/total/multi-currency aggregations and project/billable filters.
 */

import Link from 'next/link';
import {
  getTimeEntriesAccessContext,
  listTimeEntries,
} from '@/lib/services/projects/time-entry-service';
import { listProjectOptions } from '@/lib/services/crm/project-service';
import { getCurrentPermissions } from '@/lib/current-user';
import { formatMinorUnitsAsCurrency, parseAmountToMinorUnits } from '@/lib/currencies';
import { summarizeTimeEntries } from '@/lib/projects/time-entry-billing';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DeleteTimeEntryButton } from './DeleteTimeEntryButton';

export default async function TimeEntriesPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await searchParamsPromise;
  const rawProjectId = Array.isArray(searchParams.projectId)
    ? searchParams.projectId[0]
    : searchParams.projectId;
  const rawBillable = Array.isArray(searchParams.billable)
    ? searchParams.billable[0]
    : searchParams.billable;

  const projectId = rawProjectId || undefined;
  const billableFilter =
    rawBillable === 'true' ? true : rawBillable === 'false' ? false : undefined;

  const [result, accessResult, projectOptionsResult, permissions] = await Promise.all([
    loadPageData(() => listTimeEntries(undefined, projectId, billableFilter)),
    loadPageData(() => getTimeEntriesAccessContext()),
    loadPageData(() => listProjectOptions({ includeArchived: true })),
    getCurrentPermissions(),
  ]);

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const timeEntries = result.data;
  const summary = summarizeTimeEntries(timeEntries);
  const currentUserId = accessResult.ok ? accessResult.data.currentUserId : '';
  const isAdmin = accessResult.ok ? accessResult.data.isAdmin : false;
  const projectOptions = projectOptionsResult.ok ? projectOptionsResult.data : [];

  const canCreate = permissions.has('time.entry.create');
  const canUpdate = permissions.has('time.entry.update');
  const canDelete = permissions.has('time.entry.delete');

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Time Entries</h1>
        <div className="flex flex-wrap gap-2">
          {projectId && (
            <Link
              href={`/projects/${projectId}`}
              className="px-4 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Back to Project
            </Link>
          )}
          {canCreate && (
            <Link
              href={
                projectId
                  ? `/projects/time-entries/new?projectId=${encodeURIComponent(projectId)}`
                  : '/projects/time-entries/new'
              }
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Log Time
            </Link>
          )}
        </div>
      </div>

      <form className="flex flex-wrap gap-2 items-center" action="/projects/time-entries">
        {projectOptions.length > 0 ? (
          <select
            name="projectId"
            defaultValue={projectId ?? ''}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background"
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projectOptions.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.name}
                {proj.status === 'archived' ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        ) : (
          projectId && <input type="hidden" name="projectId" value={projectId} />
        )}
        <select
          name="billable"
          defaultValue={rawBillable ?? ''}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
          aria-label="Filter by billable"
        >
          <option value="">All entries</option>
          <option value="true">Billable only</option>
          <option value="false">Non-billable only</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {(projectId || rawBillable) && (
          <Link
            href="/projects/time-entries"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="rounded-md border bg-background p-6 space-y-4">
        <h2 className="text-lg font-semibold">Summary</h2>
        <dl className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Entries</dt>
            <dd className="font-medium text-lg">{summary.entryCount}</dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Hours</dt>
            <dd className="font-medium text-lg">{summary.totalHours.toFixed(2)} hrs</dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Billable Hours</dt>
            <dd className="font-medium text-lg text-green-700">
              {summary.billableHours.toFixed(2)} hrs
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Non-Billable Hours</dt>
            <dd className="font-medium text-lg">{summary.nonBillableHours.toFixed(2)} hrs</dd>
          </div>
        </dl>

        {(summary.billableAmountsByCurrency.length > 0 ||
          summary.unratedBillableEntryCount > 0) && (
          <div
            className="border rounded-md p-3 flex flex-wrap items-center justify-between gap-2 text-sm"
            data-testid="time-entries-billable-totals"
          >
            <span className="text-xs text-muted-foreground uppercase font-medium">
              Billable Value by Currency
            </span>
            <div className="flex flex-wrap items-center gap-4">
              {summary.billableAmountsByCurrency.map((bucket) => (
                <span key={bucket.currency} className="font-semibold text-green-700">
                  {formatMinorUnitsAsCurrency(bucket.amountMinor, bucket.currency)}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {bucket.currency} ({bucket.billableHours.toFixed(2)} hrs)
                  </span>
                </span>
              ))}
              {summary.unratedBillableEntryCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {summary.unratedBillableHours.toFixed(2)} hrs billable without rate
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Project / Task</th>
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium text-right">Hours</th>
              <th className="pb-3 font-medium text-right">Rate / Value</th>
              <th className="pb-3 font-medium w-28">Date</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium w-24 text-center">Billable</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {timeEntries.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  No time entries found. Log time to get started.
                </td>
              </tr>
            ) : (
              timeEntries.map((te) => {
                const isOwnerOrAdmin =
                  isAdmin || (currentUserId !== '' && te.userId === currentUserId);
                const linkedProject =
                  te.project ??
                  (te.task?.project
                    ? { ...te.task.project, status: 'active', deleted: false }
                    : null);
                const rateDisplay =
                  te.billable && te.hourlyRate && te.currency
                    ? formatMinorUnitsAsCurrency(
                        parseAmountToMinorUnits(te.hourlyRate),
                        te.currency
                      )
                    : null;
                const amountDisplay =
                  te.billable && te.billableAmount && te.currency
                    ? formatMinorUnitsAsCurrency(
                        parseAmountToMinorUnits(te.billableAmount),
                        te.currency
                      )
                    : null;

                return (
                  <tr key={te.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 text-sm">
                      {te.task ? (
                        <div>
                          <div className="font-medium">{te.task.title}</div>
                          {linkedProject && (
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/projects/${linkedProject.id}`}
                                className="text-xs text-accent hover:underline"
                              >
                                {linkedProject.name}
                              </Link>
                              {(linkedProject.deleted || linkedProject.status === 'archived') && (
                                <span className="text-[10px] rounded px-1 py-0.5 bg-muted text-muted-foreground">
                                  {linkedProject.deleted ? 'deleted' : 'archived'}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : linkedProject ? (
                        <div>
                          <div className="font-medium">Project time</div>
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/projects/${linkedProject.id}`}
                              className="text-xs text-accent hover:underline"
                            >
                              {linkedProject.name}
                            </Link>
                            {(linkedProject.deleted || linkedProject.status === 'archived') && (
                              <span className="text-[10px] rounded px-1 py-0.5 bg-muted text-muted-foreground">
                                {linkedProject.deleted ? 'deleted' : 'archived'}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">General</span>
                      )}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {te.user?.name ?? te.user?.email ?? te.userId}
                    </td>
                    <td className="py-4 text-right text-sm font-medium">{te.hours} hrs</td>
                    <td className="py-4 text-right text-sm">
                      {te.billable ? (
                        rateDisplay && amountDisplay ? (
                          <div>
                            <div className="font-medium text-green-700">{amountDisplay}</div>
                            <div className="text-xs text-muted-foreground">{rateDisplay}/hr</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No rate set</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(te.date).toLocaleDateString()}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">{te.description ?? '—'}</td>
                    <td className="py-4 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          te.billable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {te.billable ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="py-4 text-right whitespace-nowrap space-x-3">
                      {isOwnerOrAdmin ? (
                        <>
                          {canUpdate && (
                            <Link
                              href={`/projects/time-entries/${te.id}`}
                              className="text-xs text-accent hover:underline"
                            >
                              Edit
                            </Link>
                          )}
                          {canDelete && <DeleteTimeEntryButton entryId={te.id} />}
                        </>
                      ) : (
                        <Link
                          href={`/projects/time-entries/${te.id}`}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          View
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
