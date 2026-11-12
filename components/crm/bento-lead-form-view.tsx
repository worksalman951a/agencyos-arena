'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, AlertTriangle, Layers, Shield } from 'lucide-react';
import { Panel, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface BentoLeadFormViewProps {
  mode: 'new' | 'edit';
  leadId?: string;
  // Form fields
  contactId: string;
  setContactId: (val: string) => void;
  accountId: string;
  setAccountId: (val: string) => void;
  source: string;
  setSource: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  priority: string;
  setPriority: (val: string) => void;
  expectedValue: string;
  setExpectedValue: (val: string) => void;
  ownerId: string;
  setOwnerId: (val: string) => void;
  pipelineId: string;
  setPipelineId: (val: string) => void;
  stageId?: string;
  setStageId?: (val: string) => void;
  notes: string;
  setNotes: (val: string) => void;
  // Submission
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
  duplicateWarning: { duplicateId: string; message: string } | null;
  onConfirmOverride: () => void;
}

export function BentoLeadFormView({
  mode,
  leadId,
  contactId,
  setContactId,
  accountId,
  setAccountId,
  source,
  setSource,
  status,
  setStatus,
  priority,
  setPriority,
  expectedValue,
  setExpectedValue,
  ownerId,
  setOwnerId,
  pipelineId,
  setPipelineId,
  notes,
  setNotes,
  onSubmit,
  isLoading,
  error,
  duplicateWarning,
  onConfirmOverride,
}: BentoLeadFormViewProps) {
  const isEdit = mode === 'edit';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link
              href={isEdit && leadId ? `/crm/leads/${leadId}` : '/crm/leads'}
              title="Cancel and return"
            >
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/leads" className="hover:underline">
                CRM
              </Link>
              <span>/</span>
              <Link href="/crm/leads" className="hover:underline">
                Leads
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Record' : 'New Enquiry'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Lead ${leadId ? `#${leadId.slice(-6)}` : ''}` : 'New Lead Enquiry'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={isEdit && leadId ? `/crm/leads/${leadId}` : '/crm/leads'}>Cancel</Link>
          </Button>
          <Button onClick={onSubmit} size="sm" disabled={isLoading}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Lead'}
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary ───────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Form Context',
            value: isEdit ? 'Update Lead' : 'Intake Qualification',
            note: isEdit ? 'Editing registered lead' : 'Creating new CRM enquiry',
          },
          {
            label: 'Initial Status',
            value: status.toUpperCase(),
            note: 'Lead progression state',
            tone: status === 'qualified' ? 'ok' : undefined,
          },
          {
            label: 'Assigned Priority',
            value: (priority || 'None').toUpperCase(),
            note: 'Operational priority tier',
            tone: priority === 'high' || priority === 'urgent' ? 'danger' : undefined,
          },
          {
            label: 'Estimated Value',
            value: expectedValue ? `$${expectedValue}` : 'Unstated',
            note: 'Expected deal size if converted',
          },
        ]}
      />

      {/* ── Error & Duplicate Alerts ─────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="font-semibold">{error}</div>
        </div>
      )}

      {duplicateWarning && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Duplicate Lead Detected</span>
          </div>
          <p>{duplicateWarning.message}</p>
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onConfirmOverride}
              disabled={isLoading}
              className="border-amber-600/40 text-amber-900 dark:text-amber-200"
            >
              Confirm and Save Anyway
            </Button>
            {duplicateWarning.duplicateId && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/crm/leads/${duplicateWarning.duplicateId}`}>View Existing Lead</Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Bento Layout: Main Form & Context Rail ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Form Fields */}
        <div className="lg:col-span-2 min-w-0">
          <Panel title="Lead Qualification & Identity">
            <form onSubmit={onSubmit} className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-source">
                    Lead Source <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="lead-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="e.g. Website, Referral, Cold Outreach"
                    className="h-9 text-xs"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Where this business enquiry originated from.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-status">
                    Qualification Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="lead-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background"
                  >
                    <option value="new">New / Uncontacted</option>
                    <option value="contacted">Contacted</option>
                    <option value="qualified">Qualified</option>
                    <option value="unqualified">Unqualified / Disqualified</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-priority">
                    Priority Tier
                  </label>
                  <select
                    id="lead-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-expected-value">
                    Expected Deal Value ($)
                  </label>
                  <Input
                    id="lead-expected-value"
                    type="number"
                    value={expectedValue}
                    onChange={(e) => setExpectedValue(e.target.value)}
                    placeholder="e.g. 15000"
                    min={0}
                    step="0.01"
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-contact-id">
                    Associated Contact ID
                  </label>
                  <Input
                    id="lead-contact-id"
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    placeholder="Optional Contact record CUID"
                    className="h-9 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Link an existing Contact to auto-populate prospect identity.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-account-id">
                    Associated Account ID
                  </label>
                  <Input
                    id="lead-account-id"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    placeholder="Optional Account record CUID"
                    className="h-9 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Link an existing business Account record.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-owner-id">
                    Owner / Assignee User ID
                  </label>
                  <Input
                    id="lead-owner-id"
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    placeholder="User ID of sales representative"
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="lead-pipeline-id">
                    Target Pipeline ID
                  </label>
                  <Input
                    id="lead-pipeline-id"
                    value={pipelineId}
                    onChange={(e) => setPipelineId(e.target.value)}
                    placeholder="Target Sales Pipeline CUID"
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium" htmlFor="lead-notes">
                    Qualification Notes & Discovery Context
                  </label>
                  <textarea
                    id="lead-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    placeholder="Record prospect goals, project timeline, budget parameters, and initial discussion summary…"
                    className="w-full border border-input rounded-md p-3 text-xs bg-background"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border flex items-center justify-between">
                <Button asChild variant="ghost" size="sm">
                  <Link href={isEdit && leadId ? `/crm/leads/${leadId}` : '/crm/leads'}>
                    Cancel
                  </Link>
                </Button>
                <Button type="submit" size="sm" disabled={isLoading}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving…' : isEdit ? 'Save Lead Changes' : 'Create Lead'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Contextual Guidance Rail */}
        <div className="lg:col-span-1 space-y-4">
          <Panel title="Lead Lifecycle Guidance">
            <div className="p-4 space-y-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-accent" />
                <span>Conversion Pathway</span>
              </div>
              <p>
                A lead is an unqualified business inquiry. Once qualified, use the{' '}
                <strong>Convert Lead</strong> action to atomically create:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  A formal <strong>Account</strong> profile
                </li>
                <li>
                  A primary client <strong>Contact</strong>
                </li>
                <li>
                  An active <strong>Opportunity</strong> in your sales pipeline
                </li>
              </ul>
            </div>
          </Panel>

          <Panel title="Duplicate Prevention">
            <div className="p-4 space-y-2 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-accent" />
                <span>Duplicate Guarding</span>
              </div>
              <p>
                The backend automatically detects duplicate leads matching the same contact or
                account in your organization to prevent pipeline fragmentation.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
