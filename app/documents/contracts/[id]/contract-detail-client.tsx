'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import {
  BentoContractRecordView,
  type ContractDetailData,
} from '@/components/documents/bento-contract-record-view';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import { Button } from '@/components/ui/button';
import type { SignatureAuditEntry } from '@/lib/services/documents/contract-service';

interface ContractDetailClientProps {
  contract: ContractDetailData;
  signatures: SignatureAuditEntry[];
  actionsNode: React.ReactNode;
}

export function ContractDetailClient({
  contract,
  signatures,
  actionsNode,
}: ContractDetailClientProps) {
  const isBento = useBentoShell();
  const latestSigner = signatures[0] ?? null;
  const isEditable = contract.status === 'draft' || contract.status === 'sent';

  if (isBento) {
    return <BentoContractRecordView contract={contract} actionsNode={actionsNode} />;
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{contract.title}</h1>
          <p className="text-muted-foreground">
            Contract &bull; Status: {contract.status}
            {contract.proposal ? ` · Proposal #${contract.proposal.number}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportDocumentPdfButton
            documentKind="CONTRACT"
            documentId={contract.id}
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
            <Button asChild variant="outline">
              <Link href={`/documents/contracts/${contract.id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/documents/contracts">Back</Link>
          </Button>
        </div>
      </div>

      <div className="bg-card p-4 rounded-lg border border-border">{actionsNode}</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Contract Details</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Title</dt>
              <dd className="font-medium">{contract.title}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium capitalize">{contract.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd>{new Date(contract.createdAt).toLocaleDateString()}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Audit Signatures</h2>
          {signatures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signatures recorded yet.</p>
          ) : (
            <div className="divide-y text-sm">
              {signatures.map((s) => (
                <div key={s.id} className="py-2">
                  <div className="font-medium">
                    {s.signerName} ({s.signerEmail})
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.signedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
