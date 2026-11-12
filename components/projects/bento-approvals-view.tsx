'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { ProjectApprovalResponse } from '@/lib/services/projects/project-approval-service';
import '@/components/crm/bento-contacts.css';

interface BentoApprovalsViewProps {
  approvals: ProjectApprovalResponse[];
  projectId?: string;
}

export function BentoApprovalsView({ approvals, projectId }: BentoApprovalsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeApp = approvals[Math.min(selectedIdx, Math.max(0, approvals.length - 1))] ?? null;

  const approvedCount = approvals.filter((a) => a.status === 'approved').length;
  const pendingCount = approvals.filter((a) => a.status === 'pending').length;
  const changesCount = approvals.filter((a) => a.status === 'changes_requested').length;
  const rejectedCount = approvals.filter((a) => a.status === 'rejected').length;

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (status.toLowerCase()) {
      case 'approved':
        return 'ok';
      case 'changes_requested':
        return 'warn';
      case 'rejected':
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
            <span>Projects</span>
            <span>/</span>
            <span>Governance & Quality Gates</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Project Approvals
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {approvals.length} sign-off records tracked across project deliverables
          </p>
        </div>

        <div className="flex items-center gap-2">
          {projectId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}`}>Back to Workspace</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/projects">Projects Directory</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Approved Gates',
            value: String(approvedCount),
            note: 'signed off & cleared',
            tone: approvedCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Pending Review',
            value: String(pendingCount),
            note: 'awaiting client or lead feedback',
            tone: pendingCount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Changes Requested',
            value: String(changesCount),
            note: 'revision required',
            tone: changesCount > 0 ? 'danger' : undefined,
          },
          {
            label: 'Rejected',
            value: String(rejectedCount),
            note: 'rejected approvals',
            tone: rejectedCount > 0 ? 'danger' : undefined,
          },
        ]}
      />

      {/* ── Approvals Grid & Inspector ───────────────────────────────── */}
      {approvals.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No project approvals recorded yet"
            sub="Deliverable reviews and sign-offs will appear here once submitted."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Approvals Register (${approvals.length})`}>
              <div className="bento-sales-table-head">
                <span>Project Name</span>
                <span>Reviewer</span>
                <span>Feedback Summary</span>
                <span className="text-right">Decision Date</span>
                <span className="text-right">Status</span>
              </div>

              <div className="divide-y divide-border/60">
                {approvals.map((app, idx) => {
                  const isSelected = activeApp?.id === app.id;
                  const reviewer = app.contact
                    ? `${app.contact.firstName ?? ''} ${app.contact.lastName}`.trim()
                    : app.creator?.name || app.creator?.email || 'Internal Lead';

                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {app.project?.name || `Project #${app.projectId.slice(0, 8)}`}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          Type: {app.contact ? 'Client Review' : 'Internal Sign-off'}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {reviewer}
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {app.feedback || 'No written feedback logged'}
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(app.createdAt).toLocaleDateString()}
                      </div>

                      <div className="text-right">
                        <StatusPill tone={getStatusTone(app.status)}>{app.status}</StatusPill>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeApp ? (
              <Panel
                title="Approval Inspector"
                action={
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link href={`/projects/approvals/${activeApp.id}`}>
                      Open Detail <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Approval Reference
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {activeApp.project?.name || `Project #${activeApp.projectId.slice(0, 8)}`}
                    </h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Gate Status"
                      value={
                        <StatusPill tone={getStatusTone(activeApp.status)}>
                          {activeApp.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Reviewer Scope"
                      value={activeApp.contact ? 'Client External Contact' : 'Internal Workspace'}
                    />
                    <KeyValueRow
                      label="Submitted Date"
                      value={new Date(activeApp.createdAt).toLocaleDateString()}
                    />
                    <KeyValueRow
                      label="Feedback"
                      value={
                        <span className="italic text-foreground">
                          {activeApp.feedback || 'None provided'}
                        </span>
                      }
                    />
                  </div>

                  <div className="border-t border-border pt-3">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/projects/approvals/${activeApp.id}`}>
                        Inspect & Review Decision
                      </Link>
                    </Button>
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
