'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Briefcase,
  Calendar,
  DollarSign,
  User,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import '@/components/crm/bento-contacts.css';

interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
}

interface BentoProjectFormViewProps {
  mode: 'new' | 'edit';
  projectId?: string;
  name: string;
  setName: (name: string) => void;
  status: string;
  setStatus: (status: string) => void;
  clientId: string;
  setClientId: (clientId: string) => void;
  contactOptions: ComboboxOption[];
  contactQuery?: string;
  setContactQuery?: (q: string) => void;
  onSearchChange?: (q: string) => void;
  contactsLoading: boolean;
  contactsError: string | null;
  templateId: string;
  setTemplateId: (tid: string) => void;
  templates: TemplateSummary[];
  budget: string;
  setBudget: (budget: string) => void;
  startDate: string;
  setStartDate: (d: string) => void;
  endDate: string;
  setEndDate: (d: string) => void;
  description: string;
  setDescription: (d: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  formError?: string | null;
  error?: string | null;
  fieldErrors?: Record<string, string>;
  isDeleted?: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
}

export function BentoProjectFormView({
  mode,
  projectId,
  name,
  setName,
  status,
  setStatus,
  clientId,
  setClientId,
  contactOptions,
  onSearchChange,
  contactsLoading,
  contactsError,
  templateId,
  setTemplateId,
  templates,
  budget,
  setBudget,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  description,
  setDescription,
  onSubmit,
  isLoading,
  formError,
  error,
  fieldErrors = {},
  isDeleted,
  onDelete,
  isDeleting,
}: BentoProjectFormViewProps) {
  const isEdit = mode === 'edit';
  const displayError = formError || error;
  const handleSearchChange = onSearchChange;
  const backHref = isEdit && projectId ? `/projects/${projectId}` : '/projects';

  const selectedContact = contactOptions.find((c) => c.value === clientId);

  const getStatusTone = (st: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (st.toLowerCase()) {
      case 'active':
        return 'ok';
      case 'completed':
        return 'ok';
      case 'on-hold':
        return 'warn';
      case 'archived':
        return undefined;
      default:
        return undefined;
    }
  };

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
              <span>{isEdit ? 'Edit Project' : 'New Project'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Project: ${name || 'Untitled'}` : 'Create New Project'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href={backHref}>Cancel</Link>
          </Button>
          {isEdit && !isDeleted && onDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDeleting || isLoading}
              onClick={onDelete}
              className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={isLoading || isDeleted}
            onClick={onSubmit}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : isEdit ? 'Save Changes' : 'Create Project'}
          </Button>
        </div>
      </div>

      {isDeleted && (
        <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>This project was deleted and cannot be edited.</span>
        </div>
      )}

      {displayError && (
        <div
          role="alert"
          className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{displayError}</span>
        </div>
      )}

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Project Budget',
            value: budget ? `$${Number(budget).toLocaleString()}` : '$0.00',
            note: 'approved project allocation',
            tone: budget ? 'ok' : undefined,
          },
          {
            label: 'Execution Status',
            value: status.toUpperCase(),
            note: status === 'active' ? 'in operational delivery' : 'lifecycle state',
            tone: getStatusTone(status),
          },
          {
            label: 'Client Account',
            value: selectedContact?.label || 'Internal Project',
            note: selectedContact ? 'external client stakeholder' : 'no external client bound',
          },
          {
            label: 'Project Timeline',
            value:
              startDate || endDate
                ? `${startDate || 'TBD'} → ${endDate || 'TBD'}`
                : 'Timeline Undated',
            note: 'scheduled delivery window',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Project Parameters & Scope">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-project-name"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <Briefcase className="h-3.5 w-3.5 text-accent" />
                    Project Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="bento-project-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isLoading || isDeleted}
                    placeholder="e.g. Website Redesign"
                    className="h-8 text-xs"
                    required
                  />
                  {fieldErrors.name && (
                    <p className="text-[11px] text-destructive">{fieldErrors.name}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-project-client"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <User className="h-3.5 w-3.5 text-accent" />
                    Client Stakeholder
                  </label>
                  <Combobox
                    id="bento-project-client"
                    options={contactOptions}
                    value={clientId}
                    onChange={setClientId}
                    onSearchChange={handleSearchChange}
                    placeholder="Internal project (no client)"
                    searchPlaceholder="Search clients…"
                    emptyMessage={contactsError ?? 'No clients found'}
                    loading={contactsLoading && contactOptions.length === 0}
                  />
                  {fieldErrors.clientId && (
                    <p className="text-[11px] text-destructive">{fieldErrors.clientId}</p>
                  )}
                </div>
              </div>

              {templates.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-border">
                  <label htmlFor="bento-project-tpl" className="font-semibold text-foreground">
                    Project Template
                  </label>
                  <select
                    id="bento-project-tpl"
                    value={templateId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setTemplateId(nextId);
                      const matched = templates.find((t) => t.id === nextId);
                      if (matched?.description && !description.trim()) {
                        setDescription(matched.description);
                      }
                    }}
                    disabled={isLoading || isDeleted}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                  >
                    <option value="">No template (blank project)</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label htmlFor="bento-project-status" className="font-semibold text-foreground">
                    Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="bento-project-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={isLoading || isDeleted}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                  >
                    <option value="active">Active</option>
                    <option value="on-hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-project-budget"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <DollarSign className="h-3.5 w-3.5 text-accent" />
                    Budget ($)
                  </label>
                  <Input
                    id="bento-project-budget"
                    type="text"
                    inputMode="decimal"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    disabled={isLoading || isDeleted}
                    placeholder="0.00"
                    className="h-8 text-xs font-mono text-right"
                  />
                  {fieldErrors.budget && (
                    <p className="text-[11px] text-destructive">{fieldErrors.budget}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-project-start"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <Calendar className="h-3.5 w-3.5 text-accent" />
                    Start Date
                  </label>
                  <Input
                    id="bento-project-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={isLoading || isDeleted}
                    className="h-8 text-xs"
                  />
                  {fieldErrors.startDate && (
                    <p className="text-[11px] text-destructive">{fieldErrors.startDate}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label
                  htmlFor="bento-project-end"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Calendar className="h-3.5 w-3.5 text-accent" />
                  Target Delivery / End Date
                </label>
                <Input
                  id="bento-project-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isLoading || isDeleted}
                  className="h-8 text-xs"
                />
                {fieldErrors.endDate && (
                  <p className="text-[11px] text-destructive">{fieldErrors.endDate}</p>
                )}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="bento-project-desc" className="font-semibold text-foreground">
                  Project Description & Key Deliverables
                </label>
                <textarea
                  id="bento-project-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isLoading || isDeleted}
                  rows={3}
                  placeholder="Outline objectives, tech stack, and key milestone criteria..."
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
                  disabled={isLoading || isDeleted}
                  className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Project'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Association Sidebar */}
        <div className="space-y-6">
          <Panel title="Project Governance">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Delivery Status
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{name || 'Untitled Project'}</span>
                  <StatusPill tone={getStatusTone(status)}>{status.toUpperCase()}</StatusPill>
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Projects organize tasks, milestones, file attachments, and team time-tracking
                  entries.
                </p>
                <p className="pt-1">
                  Budget allocations inform burn-rate calculations and financial margin tracking
                  across your workspace.
                </p>
              </div>

              <div className="border-t border-border pt-2 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3 text-accent" />
                  Workspace Scope
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Enforces strict tenant boundary isolation and authenticated team member access.
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
