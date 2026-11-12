'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Eye, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import '@/components/crm/bento-contacts.css';

export interface ContractItem {
  id: string;
  organizationId: string;
  proposalId: string | null;
  projectId: string | null;
  title: string;
  status: string;
  signatureReference: string | null;
  signedAt: Date | string | null;
  signedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  proposal: { id: string; number: string; title: string; status: string } | null;
  project: { id: string; name: string; status: string } | null;
  signer: { id: string; name: string | null; email: string | null } | null;
}

interface BentoContractsViewProps {
  contracts: ContractItem[];
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Awaiting signature' },
  { value: 'signed', label: 'Signed' },
  { value: 'voided', label: 'Voided' },
];

export function BentoContractsView({ contracts }: BentoContractsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [searchVal, setSearchVal] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');

  const filteredContracts = React.useMemo(() => {
    return contracts.filter((c) => {
      if (statusFilter !== 'all' && c.status.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }
      if (!searchVal.trim()) return true;
      const q = searchVal.trim().toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        (c.proposal?.number && c.proposal.number.toLowerCase().includes(q)) ||
        (c.project?.name && c.project.name.toLowerCase().includes(q)) ||
        (c.signer?.name && c.signer.name.toLowerCase().includes(q))
      );
    });
  }, [contracts, searchVal, statusFilter]);

  const activeContract =
    filteredContracts[Math.min(selectedIdx, Math.max(0, filteredContracts.length - 1))] ?? null;

  const draftCount = contracts.filter((c) => c.status === 'draft').length;
  const sentCount = contracts.filter((c) => c.status === 'sent').length;
  const signedCount = contracts.filter((c) => c.status === 'signed').length;

  const getStatusTone = (status: string): 'ok' | 'warn' | 'idle' | 'neutral' => {
    switch (status.toLowerCase()) {
      case 'signed':
        return 'ok';
      case 'sent':
        return 'warn';
      case 'voided':
        return 'idle';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Documents</span>
            <span>/</span>
            <span>Commercial Contracts</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Contracts</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {contracts.length} {contracts.length === 1 ? 'contract' : 'contracts'} registered across
            proposals and projects
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/documents/templates">Templates</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/documents/links">Shareable Links</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/documents/contracts/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Contract
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          { label: 'Total Register', value: String(contracts.length), note: 'all records' },
          { label: 'Drafts', value: String(draftCount), note: 'in negotiation' },
          {
            label: 'Awaiting Signature',
            value: String(sentCount),
            note: 'sent to client',
            tone: sentCount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Executed & Signed',
            value: String(signedCount),
            note: 'binding agreements',
            tone: signedCount > 0 ? 'ok' : undefined,
          },
        ]}
      />

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <div className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            placeholder="Search contracts by title, proposal, project, or signer..."
            aria-label="Search contracts"
          />
          {searchVal && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSearchVal('')}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>

        <div className="bento-status-pills" role="tablist" aria-label="Filter contracts by status">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setStatusFilter(f.value);
                  setSelectedIdx(0);
                }}
                className={`bento-filter-pill ${isActive ? 'bento-filter-pill--active' : ''}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bento 3-Column Contracts Grid ──────────────────────────────── */}
      {filteredContracts.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || statusFilter !== 'all'
                ? 'No contracts match those filters'
                : 'No contracts found'
            }
            sub="Create your first contract linked to an accepted proposal or project."
            action={{
              label: 'Create Contract',
              onClick: () => {
                const link = document.createElement('a');
                link.href = '/documents/contracts/new';
                link.click();
              },
            }}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main Register Table (2 Cols) */}
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Contracts Register (${filteredContracts.length})`}>
              <div className="bento-sales-table-head">
                <span>Contract & Context</span>
                <span>Linked Proposal / Project</span>
                <span>Status</span>
                <span>Execution</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-border/60">
                {filteredContracts.map((c, idx) => {
                  const isSelected = activeContract?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/* Title & Created Date */}
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {c.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          Created {new Date(c.createdAt).toLocaleDateString()}
                        </div>
                      </div>

                      {/* Linked proposal / project */}
                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {c.proposal?.number ? (
                          <span className="text-accent font-medium">#{c.proposal.number}</span>
                        ) : c.project?.name ? (
                          <span>{c.project.name}</span>
                        ) : (
                          '—'
                        )}
                      </div>

                      {/* Status */}
                      <div>
                        <StatusPill tone={getStatusTone(c.status)}>{c.status}</StatusPill>
                      </div>

                      {/* Execution date */}
                      <div className="text-xs text-muted-foreground">
                        {c.signedAt ? new Date(c.signedAt).toLocaleDateString() : '—'}
                      </div>

                      {/* Action */}
                      <div className="text-right">
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                          <Link href={`/documents/contracts/${c.id}`}>View</Link>
                        </Button>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* Quick Preview Rail (1 Col) */}
          <div className="min-w-0">
            {activeContract ? (
              <Panel
                title="Contract Inspector"
                action={
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href={`/documents/contracts/${activeContract.id}`}>
                      Open Detail <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Instrument Title
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-1">
                      {activeContract.title}
                    </h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Status"
                      value={
                        <StatusPill tone={getStatusTone(activeContract.status)}>
                          {activeContract.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Linked Proposal"
                      value={
                        activeContract.proposal ? (
                          <Link
                            href={`/sales/proposals/${activeContract.proposal.id}`}
                            className="text-accent hover:underline font-semibold"
                          >
                            #{activeContract.proposal.number} — {activeContract.proposal.title}
                          </Link>
                        ) : (
                          'None'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Linked Project"
                      value={
                        activeContract.project ? (
                          <Link
                            href={`/projects/${activeContract.project.id}`}
                            className="text-accent hover:underline font-semibold"
                          >
                            {activeContract.project.name}
                          </Link>
                        ) : (
                          'None'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Executed Date"
                      value={
                        activeContract.signedAt ? (
                          <span className="font-semibold text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 size={12} />{' '}
                            {new Date(activeContract.signedAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock size={12} /> Pending Execution
                          </span>
                        )
                      }
                    />
                    {activeContract.signatureReference && (
                      <KeyValueRow
                        label="Audit Reference"
                        value={
                          <span className="font-mono text-[11px] truncate block max-w-[160px]">
                            {activeContract.signatureReference}
                          </span>
                        }
                      />
                    )}
                  </div>

                  <div className="border-t border-border pt-3">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/documents/contracts/${activeContract.id}`}>
                        Inspect Instrument
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel pad>
                <div className="text-center py-8 text-muted-foreground text-xs">
                  <Sparkles size={18} className="mx-auto mb-2 opacity-50" />
                  Select a contract from the register to preview details.
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
