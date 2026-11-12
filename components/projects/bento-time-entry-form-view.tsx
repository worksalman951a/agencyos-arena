'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Clock,
  CheckSquare,
  AlertTriangle,
  Calendar,
  UserCheck,
} from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface MemberOption {
  id: string;
  name: string | null;
  email: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface TaskOption {
  id: string;
  title: string;
  projectId: string;
}

interface BentoTimeEntryFormViewProps {
  mode: 'new' | 'edit';
  entryId?: string;
  userId: string;
  setUserId: (id: string) => void;
  members: MemberOption[];
  projectId: string;
  setProjectId: (id: string) => void;
  projects: ProjectOption[];
  taskId: string;
  setTaskId: (id: string) => void;
  tasks: TaskOption[];
  date: string;
  setDate: (d: string) => void;
  hours: string;
  setHours: (h: string) => void;
  billable: boolean;
  setBillable: (b: boolean) => void;
  description: string;
  setDescription: (d: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error?: string | null;
  onDelete?: () => void;
}

export function BentoTimeEntryFormView({
  mode,
  entryId,
  userId,
  setUserId,
  members,
  projectId,
  setProjectId,
  projects,
  taskId,
  setTaskId,
  tasks,
  date,
  setDate,
  hours,
  setHours,
  billable,
  setBillable,
  description,
  setDescription,
  onSubmit,
  isLoading,
  error,
  onDelete,
}: BentoTimeEntryFormViewProps) {
  const isEdit = mode === 'edit';
  const backHref = '/projects/time-entries';

  const selectedProject = projects.find((p) => p.id === projectId);
  const selectedMember = members.find((m) => m.id === userId);

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/projects" className="hover:underline">
                Projects
              </Link>
              <span>/</span>
              <Link href="/projects/time-entries" className="hover:underline">
                Time Tracking
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Time Entry' : 'Log Time'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Time Entry: ${entryId?.slice(-6) || 'Details'}` : 'Log Time Entry'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href={backHref}>Cancel</Link>
          </Button>
          {isEdit && onDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              Delete
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={isLoading}
            onClick={onSubmit}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : isEdit ? 'Save Changes' : 'Log Time'}
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Logged Effort',
            value: hours ? `${hours} hrs` : '0.0 hrs',
            note: 'delivery duration',
            tone: hours && Number(hours) > 0 ? 'ok' : undefined,
          },
          {
            label: 'Billing Status',
            value: billable ? 'BILLABLE' : 'NON-BILLABLE',
            note: billable ? 'charges client ledger' : 'internal agency overhead',
            tone: billable ? 'ok' : undefined,
          },
          {
            label: 'Team Member',
            value: selectedMember?.name || selectedMember?.email || 'Unassigned',
            note: 'effort attribution',
          },
          {
            label: 'Target Project',
            value: selectedProject?.name || 'Unassigned',
            note: date ? `date: ${date}` : 'delivery allocation',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Time Allocation Parameters">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-time-user"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <UserCheck className="h-3.5 w-3.5 text-accent" />
                    Team Member <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="bento-time-user"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    disabled={isLoading}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                    required
                  >
                    <option value="">Select a team member…</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ? `${m.name} (${m.email})` : m.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-time-proj"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <Clock className="h-3.5 w-3.5 text-accent" />
                    Project <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="bento-time-proj"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    disabled={isLoading}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                    required
                  >
                    <option value="">Select a project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-time-task"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <CheckSquare className="h-3.5 w-3.5 text-accent" />
                    Task (optional)
                  </label>
                  <select
                    id="bento-time-task"
                    value={taskId}
                    onChange={(e) => setTaskId(e.target.value)}
                    disabled={isLoading || !projectId}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground disabled:opacity-50"
                  >
                    <option value="">General Project Time</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-time-date"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <Calendar className="h-3.5 w-3.5 text-accent" />
                    Date <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="bento-time-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={isLoading}
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="bento-time-hours" className="font-semibold text-foreground">
                    Hours <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="bento-time-hours"
                    type="text"
                    inputMode="decimal"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    disabled={isLoading}
                    placeholder="1.5"
                    className="h-8 text-xs font-mono text-right"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-border flex items-center gap-2">
                <input
                  id="bento-time-billable"
                  type="checkbox"
                  checked={billable}
                  onChange={(e) => setBillable(e.target.checked)}
                  disabled={isLoading}
                  className="rounded border-input text-accent focus:ring-accent h-4 w-4"
                />
                <label
                  htmlFor="bento-time-billable"
                  className="font-medium text-foreground text-xs cursor-pointer"
                >
                  Billable to client
                </label>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="bento-time-desc" className="font-semibold text-foreground">
                  Description / Work Delivered
                </label>
                <textarea
                  id="bento-time-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isLoading}
                  rows={3}
                  placeholder="Describe tasks completed, blockers encountered, or deliverables submitted..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link href={backHref}>Cancel</Link>
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading}
                  className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Log Time'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Association Sidebar */}
        <div className="space-y-6">
          <Panel title="Attribution Context">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Engagement Target
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{selectedProject?.name || 'No Project Selected'}</span>
                  {billable && <StatusPill tone="ok">BILLABLE</StatusPill>}
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Time entries track team utilization and feed directly into project burn rates and
                  profitability calculations.
                </p>
                <p className="pt-1">
                  Filtering tasks dynamically updates when a project is selected to prevent
                  cross-project attribution errors.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
