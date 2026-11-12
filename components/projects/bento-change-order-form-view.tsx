'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, FileEdit, DollarSign, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface ProjectOption {
  id: string;
  name: string;
}

interface MemberOption {
  id: string;
  name: string | null;
  email: string;
}

interface BentoChangeOrderFormViewProps {
  mode: 'new' | 'edit';
  changeOrderId?: string;
  projectId: string;
  setProjectId?: (id: string) => void;
  projectName?: string;
  projects?: ProjectOption[];
  description: string;
  setDescription: (desc: string) => void;
  amount: string;
  setAmount: (amt: string) => void;
  status: string;
  setStatus: (status: string) => void;
  isTerminalStatus?: boolean;
  approvedBy: string;
  setApprovedBy: (appr: string) => void;
  members: MemberOption[];
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error?: string | null;
  onDelete?: () => void;
}

export function BentoChangeOrderFormView({
  mode,
  changeOrderId,
  projectId,
  setProjectId,
  projectName,
  projects = [],
  description,
  setDescription,
  amount,
  setAmount,
  status,
  setStatus,
  isTerminalStatus,
  approvedBy,
  setApprovedBy,
  members,
  onSubmit,
  isLoading,
  error,
  onDelete,
}: BentoChangeOrderFormViewProps) {
  const isEdit = mode === 'edit';
  const backHref = '/projects/change-orders';

  const getStatusTone = (st: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (st.toLowerCase()) {
      case 'approved':
        return 'ok';
      case 'rejected':
        return 'danger';
      default:
        return 'warn';
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
              <Link href="/projects/change-orders" className="hover:underline">
                Change Orders
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Change Order' : 'New Change Order'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit
                ? `Edit Change Order: ${changeOrderId?.slice(-6) || 'Details'}`
                : 'New Change Order'}
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
            {isLoading ? 'Saving Changes…' : isEdit ? 'Save Changes' : 'Create Change Order'}
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
            label: 'Adjustment Amount',
            value: amount ? `$${Number(amount).toLocaleString()}` : '$0.00',
            note: 'scope financial variance',
            tone: amount ? 'ok' : undefined,
          },
          {
            label: 'Approval Status',
            value: status.toUpperCase(),
            note: isTerminalStatus ? 'Finalized terminal state' : 'Pending executive review',
            tone: getStatusTone(status),
          },
          {
            label: 'Bound Project',
            value: projectName || (projectId ? `#${projectId.slice(-6)}` : 'Unselected'),
            note: 'target delivery engagement',
          },
          {
            label: 'Financial Effect',
            value: status === 'approved' ? 'Budget Updated' : 'No Immediate Impact',
            note: 'authoritative server calculation',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Scope Modification Parameters">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              {!isEdit && setProjectId ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-co-proj"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <FileEdit className="h-3.5 w-3.5 text-accent" />
                    Target Project <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="bento-co-proj"
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
              ) : (
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                    Associated Project
                  </span>
                  <div className="font-semibold text-foreground text-sm">
                    {projectName || `#${projectId}`}
                  </div>
                </div>
              )}

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="bento-co-desc" className="font-semibold text-foreground">
                  Scope Variance Description <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="bento-co-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isLoading}
                  rows={3}
                  placeholder="Detail added or removed deliverables, hours adjustment, and commercial terms..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-co-amt"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <DollarSign className="h-3.5 w-3.5 text-accent" />
                    Adjustment Amount ($) <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="bento-co-amt"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isLoading}
                    placeholder="0.00"
                    className="h-8 text-xs font-mono text-right"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="bento-co-status" className="font-semibold text-foreground">
                    Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="bento-co-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={isLoading || isTerminalStatus}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground disabled:opacity-60"
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  {isTerminalStatus && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Status is finalized ({status}) and cannot transition.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="bento-co-appr" className="font-semibold text-foreground">
                    Approved By (optional)
                  </label>
                  <select
                    id="bento-co-appr"
                    value={approvedBy}
                    onChange={(e) => setApprovedBy(e.target.value)}
                    disabled={isLoading}
                    className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                  >
                    <option value="">Unassigned / Auto on approval</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ? `${m.name} (${m.email})` : m.email}
                      </option>
                    ))}
                  </select>
                </div>
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
                  {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Change Order'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Association Sidebar */}
        <div className="space-y-6">
          <Panel title="Commercial Audit">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Change Order State
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{projectName || 'Project Scope'}</span>
                  <StatusPill tone={getStatusTone(status)}>{status.toUpperCase()}</StatusPill>
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Change orders formalize variations to contract scope, timelines, or commercial
                  fees.
                </p>
                <p className="pt-1">
                  Once marked as Approved, adjustments integrate directly into project budget
                  reconciliation.
                </p>
              </div>

              <div className="border-t border-border pt-2 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  Financial Safeguards
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Prisma Decimal-compatible financial math prevents floating-point precision loss.
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
