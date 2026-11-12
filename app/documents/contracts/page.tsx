/**
 * AgencyOS Documents - Contracts List
 * Server component that lists contracts for the current organization.
 */

import { listContracts } from '@/lib/services/documents/contract-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ContractsClient } from './contracts-client';

interface ContractListItem {
  id: string;
  organizationId: string;
  proposalId: string | null;
  projectId: string | null;
  title: string;
  status: string;
  signatureReference: string | null;
  signedAt: Date | null;
  signedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  proposal: { id: string; number: string; title: string; status: string } | null;
  project: { id: string; name: string; status: string } | null;
  signer: { id: string; name: string | null; email: string | null } | null;
}

export default async function ContractsListPage() {
  const result = await loadPageData(() => listContracts());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const contracts = result.data as ContractListItem[];

  return (
    <div className="p-6">
      <ContractsClient contracts={contracts} />
    </div>
  );
}
