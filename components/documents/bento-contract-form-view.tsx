'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  FileText,
  Briefcase,
  FileCheck,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface ProposalOption {
  id: string;
  number: string;
  title: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface BentoContractFormViewProps {
  mode: 'new' | 'edit';
  contractId?: string;
  title: string;
  setTitle: (t: string) => void;
  proposalId: string;
  setProposalId: (pid: string) => void;
  proposals: ProposalOption[];
  projectId: string;
  setProjectId: (pjid: string) => void;
  projects: ProjectOption[];
  status: string;
  setStatus: (s: string) => void;
  isLocked?: boolean;
  savedStatus?: string;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error?: string | null;
}

export function BentoContractFormView({
  mode,
  contractId,
  title,
  setTitle,
  proposalId,
  setProposalId,
  proposals,
  projectId,
  setProjectId,
  projects,
  status,
  setStatus,
  isLocked,
  savedStatus,
  onSubmit,
  isLoading,
  error,
}: BentoContractFormViewProps) {
  const isEdit = mode === 'edit';
  const backHref =
    isEdit && contractId ? `/documents/contracts/${contractId}` : '/documents/contracts';

  const selectedProposal = proposals.find((p) => p.id === proposalId);
  const selectedProject = projects.find((p) => p.id === projectId);

  const getStatusTone = (st: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (st.toLowerCase()) {
      case 'signed':
      case 'accepted':
        return 'ok';
      case 'sent':
        return 'warn';
      case 'voided':
        return 'danger';
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
              <Link href="/documents" className="hover:underline">
                Documents
              </Link>
              <span>/</span>
              <Link href="/documents/contracts" className="hover:underline">
                Contracts
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Contract' : 'New Contract'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Contract: ${title || 'Untitled'}` : 'New Contract'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href={backHref}>Cancel</Link>
          </Button>
          {!isLocked && (
            <Button
              type="button"
              size="sm"
              disabled={isLoading}
              onClick={onSubmit}
              className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {isLoading ? 'Saving Changes…' : isEdit ? 'Save Changes' : 'Create Contract'}
            </Button>
          )}
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

      {isLocked && (
        <div className="p-4 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-md border border-amber-500/20 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Contract is {savedStatus}. Signed and voided contracts are immutable to preserve
            execution audit records.
          </span>
        </div>
      )}

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Contract Identity',
            value: title || 'Untitled Agreement',
            note: isEdit ? `Contract ID: #${contractId?.slice(-6) || '—'}` : 'New legal agreement',
          },
          {
            label: 'Contract Status',
            value: status.toUpperCase(),
            note: isLocked ? 'Execution record locked' : 'Lifecycle stage',
            tone: getStatusTone(status),
          },
          {
            label: 'Commercial Source',
            value: selectedProposal ? `#${selectedProposal.number}` : 'Direct Contract',
            note: selectedProposal ? selectedProposal.title : 'No proposal bound',
          },
          {
            label: 'Delivery Target',
            value: selectedProject?.name || 'Unassigned Project',
            note: 'Operational scope allocation',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Contract Parameters & Scope">
            {isLocked ? (
              <div className="space-y-4 text-xs text-muted-foreground">
                <p>
                  This agreement has achieved a terminal status ({savedStatus}) and cannot be
                  edited.
                </p>
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link href={backHref}>Return to Contract View</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label
                    htmlFor="bento-contract-title"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <FileText className="h-3.5 w-3.5 text-accent" />
                    Contract Title <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="bento-contract-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isLoading}
                    placeholder="e.g. Master Services Agreement"
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="bento-contract-proposal"
                      className="font-semibold text-foreground flex items-center gap-1.5"
                    >
                      <FileCheck className="h-3.5 w-3.5 text-accent" />
                      Linked Proposal
                    </label>
                    <select
                      id="bento-contract-proposal"
                      value={proposalId}
                      onChange={(e) => setProposalId(e.target.value)}
                      disabled={isLoading}
                      className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                    >
                      <option value="">None (standalone contract)</option>
                      {proposals.map((p) => (
                        <option key={p.id} value={p.id}>
                          #{p.number} — {p.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="bento-contract-project"
                      className="font-semibold text-foreground flex items-center gap-1.5"
                    >
                      <Briefcase className="h-3.5 w-3.5 text-accent" />
                      Linked Project
                    </label>
                    <select
                      id="bento-contract-project"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      disabled={isLoading}
                      className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                    >
                      <option value="">None</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border">
                  <label htmlFor="bento-contract-status" className="font-semibold text-foreground">
                    Lifecycle Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="bento-contract-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={isLoading}
                    className="w-full sm:w-1/2 border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
                  >
                    {(!isEdit || savedStatus === 'draft') && <option value="draft">Draft</option>}
                    <option value="sent">Sent</option>
                    {isEdit && <option value="voided">Voided</option>}
                  </select>
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
                    {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Contract'}
                  </Button>
                </div>
              </form>
            )}
          </Panel>
        </div>

        {/* Association Sidebar */}
        <div className="space-y-6">
          <Panel title="Document Governance">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Contract Agreement
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{title || 'Untitled Contract'}</span>
                  <StatusPill tone={getStatusTone(status)}>{status.toUpperCase()}</StatusPill>
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Contracts formally establish delivery scope, warranties, and commercial
                  commitments.
                </p>
                <p className="pt-1">
                  Linking a proposal carries forward approved line items and schedule requirements.
                </p>
              </div>

              <div className="border-t border-border pt-2 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  Execution Safeguards
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Signed documents enter an immutable state to protect audit integrity and ensure
                  compliance.
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
