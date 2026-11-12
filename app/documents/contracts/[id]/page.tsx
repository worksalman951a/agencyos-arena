/**
 * AgencyOS Documents - Contract Detail
 * Server component that displays a single contract with signing actions,
 * PDF export, shareable link, and audit signature log.
 */

import { getContract, type SignatureAuditEntry } from '@/lib/services/documents/contract-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ContractActions } from './ContractActions';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
import { ContractDetailClient } from './contract-detail-client';

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
  const signatures: SignatureAuditEntry[] = contract.signatures ?? [];

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <ContractDetailClient
        contract={contract}
        signatures={signatures}
        actionsNode={<ContractActions contractId={contract.id} status={contract.status} />}
      />
    </div>
  );
}
