/**
 * AgencyOS Time Entries page.
 * Lists time entries across the organization's projects and tasks.
 */

import Link from 'next/link';
import { listTimeEntries } from '@/lib/services/projects/time-entry-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function TimeEntriesPage() {
  const result = await loadPageData(() => listTimeEntries(undefined, undefined));

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const timeEntries = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Time Entries</h1>
        <Link
          href="/projects/time-entries/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          Log Time
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Summary</h2>
        <dl className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Entries</dt>
            <dd className="font-medium text-lg">{(timeEntries as Array<unknown>).length}</dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Hours</dt>
            <dd className="font-medium text-lg">
              {(
                (timeEntries as Array<{ hours: string }>).reduce(
                  (sum, te) => sum + Number(te.hours || 0),
                  0
                ) || 0
              ).toFixed(1)}{' '}
              hrs
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Billable Hours</dt>
            <dd className="font-medium text-lg">
              {(
                (timeEntries as Array<{ hours: string; billable: boolean }>).reduce(
                  (sum, te) => (te.billable ? sum + Number(te.hours || 0) : sum),
                  0
                ) || 0
              ).toFixed(1)}{' '}
              hrs
            </dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Non-Billable Hours</dt>
            <dd className="font-medium text-lg">
              {(
                (timeEntries as Array<{ hours: string; billable: boolean }>).reduce(
                  (sum, te) => (!te.billable ? sum + Number(te.hours || 0) : sum),
                  0
                ) || 0
              ).toFixed(1)}{' '}
              hrs
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Task</th>
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium text-right">Hours</th>
              <th className="pb-3 font-medium w-24">Date</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium w-20">Billable</th>
              <th className="pb-3 font-medium text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {(
              timeEntries as Array<{
                id: string;
                taskId: string | null;
                userId: string;
                date: Date;
                hours: string;
                description: string | null;
                billable: boolean;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No time entries found. Log time to get started.
                </td>
              </tr>
            ) : (
              (
                timeEntries as Array<{
                  id: string;
                  taskId: string | null;
                  userId: string;
                  date: Date;
                  hours: string;
                  description: string | null;
                  billable: boolean;
                  createdAt: Date;
                }>
              ).map((te) => (
                <tr key={te.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 text-sm">{te.taskId ?? '—'}</td>
                  <td className="py-4 text-sm text-muted-foreground">{te.userId}</td>
                  <td className="py-4 text-right text-sm font-medium">{te.hours} hrs</td>
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
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(te.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
