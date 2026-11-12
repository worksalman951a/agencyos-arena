'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoTimeEntriesView } from '@/components/projects/bento-time-entries-view';
import { DeleteTimeEntryButton } from './DeleteTimeEntryButton';
import type { TimeEntryResponse } from '@/lib/services/projects/time-entry-service';

interface TimeEntriesClientProps {
  timeEntries: TimeEntryResponse[];
  projectId?: string;
  rawBillable?: string;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
}

export function TimeEntriesClient({
  timeEntries,
  projectId,
  rawBillable,
  totalHours,
  billableHours,
  nonBillableHours,
}: TimeEntriesClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <BentoTimeEntriesView
        timeEntries={timeEntries}
        projectId={projectId}
        rawBillable={rawBillable}
        deleteButtonRenderer={(id) => <DeleteTimeEntryButton entryId={id} />}
      />
    );
  }

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
        </div>
      </div>

      <form className="flex flex-wrap gap-2 items-center" action="/projects/time-entries">
        {projectId && <input type="hidden" name="projectId" value={projectId} />}
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

      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Summary</h2>
        <dl className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Entries</dt>
            <dd className="font-medium text-lg">{timeEntries.length}</dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Total Hours</dt>
            <dd className="font-medium text-lg">{totalHours.toFixed(2)} hrs</dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Billable Hours</dt>
            <dd className="font-medium text-lg text-green-700">{billableHours.toFixed(2)} hrs</dd>
          </div>
          <div className="border rounded-md p-3">
            <dt className="text-xs text-muted-foreground uppercase">Non-Billable Hours</dt>
            <dd className="font-medium text-lg">{nonBillableHours.toFixed(2)} hrs</dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Project / Task</th>
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium text-right">Hours</th>
              <th className="pb-3 font-medium w-28">Date</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium w-24 text-center">Billable</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {timeEntries.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No time entries found. Log time to get started.
                </td>
              </tr>
            ) : (
              timeEntries.map((te) => (
                <tr key={te.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 text-sm font-medium">
                    <Link
                      href={`/projects/${te.task?.project?.id ?? te.task?.projectId ?? ''}`}
                      className="text-accent hover:underline"
                    >
                      {te.task?.project?.name ?? te.task?.title ?? '—'}
                    </Link>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {te.user?.name ?? te.user?.email ?? te.userId}
                  </td>
                  <td className="py-4 text-right text-sm font-medium">{te.hours} hrs</td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {new Date(te.date).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground max-w-xs truncate">
                    {te.description ?? '—'}
                  </td>
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
                    {new Date(te.date).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right whitespace-nowrap space-x-3">
                    <Link
                      href={`/projects/time-entries/${te.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      Edit
                    </Link>
                    <DeleteTimeEntryButton entryId={te.id} />
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
