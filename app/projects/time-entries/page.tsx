/**
 * AgencyOS Time Entries page.
 * Lists time entries across the organization's projects and tasks with
 * billable/total aggregations and project/billable filters.
 */

import { listTimeEntries } from '@/lib/services/projects/time-entry-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { TimeEntriesClient } from './time-entries-client';

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

  const result = await loadPageData(() => listTimeEntries(undefined, projectId, billableFilter));

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const timeEntries = result.data;
  const totalHours = timeEntries.reduce((sum, te) => sum + Number(te.hours || 0), 0);
  const billableHours = timeEntries.reduce(
    (sum, te) => (te.billable ? sum + Number(te.hours || 0) : sum),
    0
  );
  const nonBillableHours = totalHours - billableHours;

  return (
    <TimeEntriesClient
      timeEntries={timeEntries}
      projectId={projectId}
      rawBillable={rawBillable}
      totalHours={totalHours}
      billableHours={billableHours}
      nonBillableHours={nonBillableHours}
    />
  );
}
