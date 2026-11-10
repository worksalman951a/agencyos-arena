/**
 * AgencyOS Documents - Contract Detail
 * Server component that displays a single contract with signing actions.
 */

import Link from 'next/link';
import { getContract } from '@/lib/services/documents/contract-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ContractActions } from './ContractActions';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The service validates the session, permissions and organization scoping.
  const result = await loadPageData(() => getContract(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/documents/contracts"
        backLabel="Back to contracts"
      />
    );
  }

  const contract = result.data;

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Contract</h1>
          <p className="text-muted-foreground">{contract.title}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/documents/contracts"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Contracts
          </Link>
          <Link
            href={`/documents/contracts/${contract.id}/edit`}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/80"
          >
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 md:col-span-2">
          <div className="rounded-md border bg-background p-6">
            <h2 className="text-lg font-semibold mb-4">Contract Details</h2>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Status</dt>
                <dd className="text-sm">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      contract.status === 'signed'
                        ? 'bg-green-100 text-green-800'
                        : contract.status === 'voided'
                          ? 'bg-red-100 text-red-800'
                          : contract.status === 'sent'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {contract.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Proposal</dt>
                <dd className="text-sm">
                  {contract.proposal ? (
                    <Link
                      href={`/sales/proposals/${contract.proposal.id}`}
                      className="text-accent hover:underline"
                    >
                      #{contract.proposal.number} - {contract.proposal.title}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Not linked</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Project</dt>
                <dd className="text-sm">
                  {contract.project ? (
                    <Link
                      href={`/projects/${contract.project.id}`}
                      className="text-accent hover:underline"
                    >
                      {contract.project.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Not linked</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Signed By</dt>
                <dd className="text-sm">
                  {contract.signer ? (
                    <span>
                      {contract.signer.name} ({contract.signer.email})
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not signed</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Signed At</dt>
                <dd className="text-sm">
                  {contract.signedAt ? (
                    <span>{new Date(contract.signedAt).toLocaleString()}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Signature Reference</dt>
                <dd className="text-sm">
                  {contract.signatureReference || <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="col-span-1 md:col-span-1">
          <div className="rounded-md border bg-background p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            <ContractActions contractId={contract.id} status={contract.status} />
          </div>
        </div>
      </div>
    </div>
  );
}
