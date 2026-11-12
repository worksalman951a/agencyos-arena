'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { TimeEntryResponse } from '@/lib/services/projects/time-entry-service';
import '@/components/crm/bento-contacts.css';

interface BentoTimeEntriesViewProps {
  timeEntries: TimeEntryResponse[];
  projectId?: string;
  rawBillable?: string;
  deleteButtonRenderer?: (id: string) => React.ReactNode;
}

export function BentoTimeEntriesView({
  timeEntries,
  projectId,
  rawBillable,
  deleteButtonRenderer,
}: BentoTimeEntriesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeEntry =
    timeEntries[Math.min(selectedIdx, Math.max(0, timeEntries.length - 1))] ?? null;

  const totalHours = timeEntries.reduce((sum, te) => sum + Number(te.hours || 0), 0);
  const billableHours = timeEntries.reduce(
    (sum, te) => (te.billable ? sum + Number(te.hours || 0) : sum),
    0
  );
  const nonBillableHours = totalHours - billableHours;
  const billableRatePercent = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Projects</span>
            <span>/</span>
            <span>Resource Utilization & Tracking</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Time Entries</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Timesheet tracking, billable utilization, and resource effort across tasks
          </p>
        </div>

        <div className="flex items-center gap-2">
          {projectId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}`}>Back to Workspace</Link>
            </Button>
          )}
          <Button asChild className="bg-accent text-accent-foreground" size="sm">
            <Link
              href={
                projectId
                  ? `/projects/time-entries/new?projectId=${encodeURIComponent(projectId)}`
                  : '/projects/time-entries/new'
              }
            >
              <Plus size={14} className="mr-1.5" />
              Log Time
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Hours Logged',
            value: `${totalHours.toFixed(1)} hrs`,
            note: `${timeEntries.length} logged entries`,
          },
          {
            label: 'Billable Hours',
            value: `${billableHours.toFixed(1)} hrs`,
            note: `${billableRatePercent}% billable efficiency`,
            tone: 'ok',
          },
          {
            label: 'Non-billable Hours',
            value: `${nonBillableHours.toFixed(1)} hrs`,
            note: 'internal overhead & discovery',
          },
        ]}
      />

      {/* ── Filters Bar ─────────────────────────────────────────────── */}
      <Panel>
        <form className="flex flex-wrap gap-2 items-center" action="/projects/time-entries">
          {projectId && <input type="hidden" name="projectId" value={projectId} />}
          <select
            name="billable"
            defaultValue={rawBillable ?? ''}
            className="border border-input rounded-md px-3 py-1.5 text-xs bg-background"
            aria-label="Filter by billable"
          >
            <option value="">All Entries</option>
            <option value="true">Billable Only</option>
            <option value="false">Non-billable Only</option>
          </select>
          <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
            Filter
          </Button>
          {(projectId || rawBillable) && (
            <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
              <Link href="/projects/time-entries">Clear</Link>
            </Button>
          )}
        </form>
      </Panel>

      {/* ── Time Entries Grid & Inspector ───────────────────────────── */}
      {timeEntries.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No time entries logged"
            sub="Use 'Log Time' above to record effort against projects and tasks."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Timesheets Register (${timeEntries.length})`}>
              <div className="bento-sales-table-head">
                <span>Team Member</span>
                <span>Project / Task</span>
                <span className="text-right">Hours</span>
                <span className="text-right">Date</span>
                <span className="text-right">Billable</span>
              </div>

              <div className="divide-y divide-border/60">
                {timeEntries.map((te, idx) => {
                  const isSelected = activeEntry?.id === te.id;
                  const memberName = te.user?.name || te.user?.email || 'Team Member';
                  const taskName = te.task?.title || 'General Project Scope';

                  return (
                    <button
                      key={te.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {memberName}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {te.description || 'No description provided'}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-medium text-foreground truncate">
                          {te.task?.project?.name ||
                            (te.task?.projectId
                              ? `Project #${te.task.projectId.slice(0, 8)}`
                              : 'General Workspace')}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{taskName}</div>
                      </div>

                      <div className="text-xs font-mono font-bold text-foreground text-right">
                        {Number(te.hours).toFixed(1)}h
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(te.date).toLocaleDateString()}
                      </div>

                      <div className="text-right">
                        <StatusPill tone={te.billable ? 'ok' : undefined}>
                          {te.billable ? 'Billable' : 'Internal'}
                        </StatusPill>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeEntry ? (
              <Panel
                title="Time Entry Details"
                action={
                  <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link href={`/projects/time-entries/${activeEntry.id}`}>Edit</Link>
                    </Button>
                    {deleteButtonRenderer?.(activeEntry.id)}
                  </div>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Logged Effort
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {activeEntry.task?.project?.name ||
                        (activeEntry.task?.projectId
                          ? `Project #${activeEntry.task.projectId.slice(0, 8)}`
                          : 'General Workspace')}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {activeEntry.description || 'No memo attached'}
                    </p>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Logged Hours"
                      value={
                        <span className="font-mono font-bold text-sm text-foreground">
                          {Number(activeEntry.hours).toFixed(1)} hrs
                        </span>
                      }
                    />
                    <KeyValueRow
                      label="Classification"
                      value={
                        <StatusPill tone={activeEntry.billable ? 'ok' : undefined}>
                          {activeEntry.billable ? 'Billable Client Time' : 'Non-Billable Internal'}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Task Associated"
                      value={activeEntry.task?.title || 'None (General Project)'}
                    />
                    <KeyValueRow
                      label="Worker"
                      value={activeEntry.user?.name || activeEntry.user?.email || 'System'}
                    />
                    <KeyValueRow
                      label="Logged Date"
                      value={new Date(activeEntry.date).toLocaleDateString()}
                    />
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
