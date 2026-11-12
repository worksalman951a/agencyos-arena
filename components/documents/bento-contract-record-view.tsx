'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  FileCheck2,
  Calendar,
  Clock,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Lock,
} from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import type { SignatureAuditEntry } from '@/lib/services/documents/contract-service';

export interface ContractDetailData {
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
  signatures?: SignatureAuditEntry[];
}

interface BentoContractRecordViewProps {
  contract: ContractDetailData;
  actionsNode: React.ReactNode;
}

export function BentoContractRecordView({ contract, actionsNode }: BentoContractRecordViewProps) {
  const isEditable = contract.status === 'draft' || contract.status === 'sent';
  const signatures = contract.signatures ?? [];
  const latestSigner = signatures[0] ?? null;

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
    <div className="bento-crm space-y-6">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href="/documents/contracts" aria-label="Back to contracts">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Contracts</span>
              <span>/</span>
              <span>{contract.id.slice(0, 8).toUpperCase()}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {contract.title}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportDocumentPdfButton
            documentKind="CONTRACT"
            number={contract.id.slice(0, 8).toUpperCase()}
            title={contract.title}
            status={contract.status}
            createdAt={contract.createdAt}
            projectName={contract.project?.name ?? null}
            signedAt={contract.signedAt}
            signerName={
              latestSigner
                ? `${latestSigner.signerName} (${latestSigner.signerEmail})`
                : contract.signer
                  ? `${contract.signer.name ?? ''} (${contract.signer.email ?? ''})`
                  : null
            }
            signatureReference={contract.signatureReference}
          />
          <ShareDocumentButton entityType="contract" entityId={contract.id} />
          {isEditable && (
            <Button asChild variant="outline" size="sm" className="h-9 text-xs">
              <Link href={`/documents/contracts/${contract.id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link href="/documents/contracts">Back</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip High-Level Summary ─────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Instrument Status',
            value: contract.status.toUpperCase(),
            tone:
              contract.status === 'signed' ? 'ok' : contract.status === 'sent' ? 'warn' : undefined,
          },
          {
            label: 'Binding Signatures',
            value: String(signatures.length),
            note: contract.signedAt ? 'fully executed' : 'pending execution',
            tone: contract.signedAt ? 'ok' : 'warn',
          },
          {
            label: 'Created Date',
            value: new Date(contract.createdAt).toLocaleDateString(),
            note: 'registered in system',
          },
          {
            label: 'Linked Instrument',
            value: contract.proposal
              ? `#${contract.proposal.number}`
              : (contract.project?.name ?? 'Standalone'),
            note: contract.proposal ? 'commercial proposal' : 'project agreement',
          },
        ]}
      />

      {/* ── Primary Action & Status Workflow Bar ─────────────────────── */}
      <div className="bg-card p-4 rounded-lg border border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2">
            Workflow:
          </span>
          {actionsNode}
        </div>
        {!isEditable && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-md border border-border">
            <Lock size={12} className="text-muted-foreground" />
            <span>Document is {contract.status} and locked against modifications.</span>
          </div>
        )}
      </div>

      {/* ── Bento 2-Column Content Layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Signatures & Instrument Details (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Signature Audit Trail */}
          <Panel
            title={`Signature Audit Trail (${signatures.length})`}
            action={
              contract.signedAt ? (
                <span className="text-emerald-700 font-semibold text-xs flex items-center gap-1">
                  <ShieldCheck size={14} /> Audit Trail Recorded
                </span>
              ) : (
                <span className="text-amber-700 font-medium text-xs flex items-center gap-1">
                  <Clock size={13} /> Awaiting Signatures
                </span>
              )
            }
          >
            {signatures.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-xs space-y-1">
                <FileCheck2 size={24} className="mx-auto mb-1 opacity-40" />
                <p className="font-semibold text-foreground">No signatures recorded yet</p>
                <p>
                  When signed via the internal execution workflow, signer identity evidence and
                  audit-trail metadata are logged here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border text-xs">
                {signatures.map((s) => (
                  <div
                    key={s.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-600" />
                        <span>{s.signerName}</span>
                        <span className="text-muted-foreground font-normal">({s.signerEmail})</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Method:{' '}
                        <span className="font-mono text-foreground">{s.signatureMethod}</span>
                        {s.signatureReference && (
                          <>
                            {' '}
                            &bull; Ref:{' '}
                            <span className="font-mono text-foreground">
                              {s.signatureReference}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-muted-foreground font-mono">
                      {new Date(s.signedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Instrument Terms & Scope */}
          <Panel title="Contract Instrument Information">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Document ID"
                value={<span className="font-mono">{contract.id}</span>}
              />
              <KeyValueRow
                label="Agreement Title"
                value={<span className="font-semibold">{contract.title}</span>}
              />
              <KeyValueRow
                label="Current Status"
                value={
                  <StatusPill tone={getStatusTone(contract.status)}>{contract.status}</StatusPill>
                }
              />
              <KeyValueRow
                label="Created Timestamp"
                value={new Date(contract.createdAt).toLocaleString()}
              />
              <KeyValueRow
                label="Last Modified"
                value={new Date(contract.updatedAt).toLocaleString()}
              />
            </div>
          </Panel>
        </div>

        {/* Right Column: Commercial & Project Linkage (1 col) */}
        <div className="space-y-6 min-w-0">
          <Panel title="Commercial Relationships">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Commercial Proposal"
                value={
                  contract.proposal ? (
                    <Link
                      href={`/sales/proposals/${contract.proposal.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <FileText size={13} />
                      <span>
                        #{contract.proposal.number} — {contract.proposal.title}
                      </span>
                    </Link>
                  ) : (
                    'No proposal linked'
                  )
                }
              />
              <KeyValueRow
                label="Delivery Project"
                value={
                  contract.project ? (
                    <Link
                      href={`/projects/${contract.project.id}`}
                      className="text-accent hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Building2 size={13} />
                      <span>{contract.project.name}</span>
                    </Link>
                  ) : (
                    'No project linked'
                  )
                }
              />
              <KeyValueRow
                label="Primary Signer"
                value={
                  latestSigner
                    ? `${latestSigner.signerName} (${latestSigner.signerEmail})`
                    : contract.signer?.name
                      ? `${contract.signer.name} (${contract.signer.email ?? ''})`
                      : 'Not signed yet'
                }
              />
              {contract.signedAt && (
                <KeyValueRow
                  label="Execution Date"
                  value={
                    <span className="font-semibold text-emerald-700 flex items-center gap-1">
                      <Calendar size={13} /> {new Date(contract.signedAt).toLocaleDateString()}
                    </span>
                  }
                />
              )}
            </div>
          </Panel>

          <Panel title="Security & Compliance">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>
                This agreement is tenant-isolated within your organization workspace. Public client
                access is only granted via cryptographic share tokens with strict field allowlists.
              </p>
              <div className="pt-2">
                <Button asChild variant="outline" size="sm" className="w-full text-xs">
                  <Link href="/documents/links">Manage Shared Links</Link>
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
