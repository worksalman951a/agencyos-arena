'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Eye, Sparkles } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { formatDecimalMoney } from '@/lib/finance/decimal-utils';
import type { ProjectResponse } from '@/lib/services/crm/project-service';
import '@/components/crm/bento-contacts.css';

interface BentoProjectsViewProps {
  projects: ProjectResponse[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  sortBy: string;
  sortOrder: string;
  onSearchChange: (search: string) => void;
  onStatusFilterChange: (status: string) => void;
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'on-hold', label: 'On Hold' },
  { value: 'archived', label: 'Archived' },
];

export function BentoProjectsView({
  projects,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
}: BentoProjectsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [prevSearchVal, setPrevSearchVal] = React.useState(searchVal);

  if (prevSearchVal !== searchVal) {
    setPrevSearchVal(searchVal);
    setSearchInput(searchVal);
  }

  const activeProj = projects[Math.min(selectedIdx, Math.max(0, projects.length - 1))] ?? null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  // Metrics
  const activeCount = projects.filter((p) => p.status === 'active').length;
  const completedCount = projects.filter((p) => p.status === 'completed').length;
  const onHoldCount = projects.filter((p) => p.status === 'on-hold').length;

  const totalTasks = projects.reduce((sum, p) => sum + p.tasks.length, 0);
  const doneTasks = projects.reduce(
    (sum, p) => sum + p.tasks.filter((t) => t.status === 'done').length,
    0
  );
  const overallTaskPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

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
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Delivery</span>
            <span>/</span>
            <span>Project Workspaces</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Projects</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {total === 1 ? 'project' : 'projects'} in workspace directory
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/projects/templates">Templates</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/projects/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Project
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Active Engagements',
            value: String(activeCount),
            note: 'currently in delivery',
            tone: activeCount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Completed Projects',
            value: String(completedCount),
            note: 'successfully delivered',
            tone: completedCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'On Hold',
            value: String(onHoldCount),
            note: onHoldCount > 0 ? 'requires attention' : 'no blocked projects',
            tone: onHoldCount > 0 ? 'danger' : undefined,
          },
          {
            label: 'Task Progress',
            value: `${overallTaskPct}%`,
            note: `${doneTasks}/${totalTasks} deliverables completed`,
            tone: overallTaskPct >= 70 ? 'ok' : undefined,
          },
        ]}
      />

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <form onSubmit={handleSearchSubmit} className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search projects by name, client, or account..."
            aria-label="Search projects"
          />
          {searchInput && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchInput('');
                onSearchChange('');
              }}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </form>

        <div className="bento-status-pills" role="tablist" aria-label="Filter projects by status">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onStatusFilterChange(f.value)}
                className={`bento-filter-pill ${isActive ? 'bento-filter-pill--active' : ''}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bento 3-Column Projects Grid ─────────────────────────────── */}
      {projects.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || statusFilter ? 'No projects match those filters' : 'No projects found'
            }
            sub="Create your first client delivery project workspace."
            action={{
              label: 'Create Project',
              onClick: () => {
                const link = document.createElement('a');
                link.href = '/projects/new';
                link.click();
              },
            }}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main Table (2 Cols) */}
          <div className="lg:col-span-2 min-w-0">
            <Panel
              title={`Projects Register (${projects.length})`}
              action={
                totalPages > 1 ? (
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                ) : null
              }
            >
              <div className="bento-sales-table-head">
                <span>Project Name</span>
                <span>Client & Account</span>
                <span>Timeline</span>
                <span className="text-right">Task Progress</span>
                <span className="text-right">Status</span>
              </div>

              <div className="divide-y divide-border/60">
                {projects.map((proj, idx) => {
                  const isSelected = activeProj?.id === proj.id;
                  const clientLabel = proj.client
                    ? `${proj.client.firstName ?? ''} ${proj.client.lastName ?? ''}`.trim() ||
                      'Client'
                    : 'Internal Project';

                  const pTotalTasks = proj.tasks.length;
                  const pDoneTasks = proj.tasks.filter((t) => t.status === 'done').length;
                  const pPct = pTotalTasks > 0 ? Math.round((pDoneTasks / pTotalTasks) * 100) : 0;

                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/* Name & Description */}
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {proj.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {proj.description ||
                            `Created ${new Date(proj.createdAt).toLocaleDateString()}`}
                        </div>
                      </div>

                      {/* Client */}
                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        <div>{clientLabel}</div>
                        {proj.client?.account && (
                          <div className="text-[10px] text-muted-foreground/80 truncate">
                            {proj.client.account.name}
                          </div>
                        )}
                      </div>

                      {/* Timeline */}
                      <div className="text-xs text-muted-foreground truncate font-mono">
                        {proj.startDate ? new Date(proj.startDate).toLocaleDateString() : '—'}
                      </div>

                      {/* Progress */}
                      <div className="text-right">
                        <span className="text-xs font-semibold text-foreground font-mono">
                          {pPct}%
                        </span>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {pDoneTasks}/{pTotalTasks} tasks
                        </div>
                      </div>

                      {/* Status */}
                      <div className="text-right">
                        <StatusPill tone={getStatusTone(proj.status)}>{proj.status}</StatusPill>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* Quick Preview Rail (1 Col) */}
          <div className="min-w-0">
            {activeProj ? (
              <Panel
                title="Project Inspector"
                action={
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href={`/projects/${activeProj.id}`}>
                      Workspace <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Project Reference
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">{activeProj.name}</h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Status"
                      value={
                        <StatusPill tone={getStatusTone(activeProj.status)}>
                          {activeProj.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Client Contact"
                      value={
                        activeProj.client ? (
                          <Link
                            href={`/crm/contacts/${activeProj.clientId}`}
                            className="text-accent hover:underline font-semibold"
                          >
                            {`${activeProj.client.firstName ?? ''} ${activeProj.client.lastName ?? ''}`.trim() ||
                              'Client'}
                          </Link>
                        ) : (
                          'Internal'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Target Timeline"
                      value={
                        activeProj.startDate || activeProj.endDate ? (
                          <span className="font-mono">
                            {activeProj.startDate
                              ? new Date(activeProj.startDate).toLocaleDateString()
                              : 'TBD'}{' '}
                            &rarr;{' '}
                            {activeProj.endDate
                              ? new Date(activeProj.endDate).toLocaleDateString()
                              : 'Ongoing'}
                          </span>
                        ) : (
                          'No dates scheduled'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Budget Allocation"
                      value={
                        activeProj.budget ? (
                          <span className="font-mono font-semibold text-foreground">
                            ${formatDecimalMoney(activeProj.budget)}
                          </span>
                        ) : (
                          'Not budgeted'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Deliverable Tasks"
                      value={
                        <span className="font-mono font-semibold">
                          {activeProj.tasks.filter((t) => t.status === 'done').length}/
                          {activeProj.tasks.length} done
                        </span>
                      }
                    />
                    <KeyValueRow
                      label="Milestone Checkpoints"
                      value={
                        <span className="font-mono font-semibold">
                          {activeProj.milestoneCount} milestones
                        </span>
                      }
                    />
                  </div>

                  <div className="border-t border-border pt-3 flex gap-2">
                    <Button asChild className="flex-1 bg-accent text-accent-foreground" size="sm">
                      <Link href={`/projects/${activeProj.id}`}>Open Workspace</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/projects/${activeProj.id}/edit`}>Edit</Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel pad>
                <div className="text-center py-8 text-muted-foreground text-xs">
                  <Sparkles size={18} className="mx-auto mb-2 opacity-50" />
                  Select a project from the register to inspect details.
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
