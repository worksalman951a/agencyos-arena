import { getProposal } from '@/lib/services/crm/proposal-service';
import {
  listProposalVersions,
  type ProposalVersionResponse,
} from '@/lib/services/documents/version-service';
import { getCurrentPermissions } from '@/lib/current-user';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
import { ProposalDetailClient } from './proposal-detail-client';

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getProposal(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/sales/proposals"
        backLabel="Back to proposals"
      />
    );
  }

  const proposal = result.data;
  const versions: ProposalVersionResponse[] = await listProposalVersions(id).catch(() => []);

  // Handoff actions are permission-aware: the create APIs enforce the same
  // codes, so the UI never offers an action the service would refuse.
  const permissions = await getCurrentPermissions();
  const handoffs = {
    project: permissions.has('project.create'),
    contract: permissions.has('contract.create'),
    quotation: permissions.has('quotation.create'),
  };

  const formattedProposal = {
    id: proposal.id,
    organizationId: proposal.organizationId,
    number: proposal.number,
    title: proposal.title,
    status: proposal.status,
    subtotal: Number(proposal.subtotal),
    tax: Number(proposal.tax),
    total: Number(proposal.total),
    currency: proposal.currency,
    validUntil: proposal.validUntil,
    notes: proposal.notes,
    opportunityId: proposal.opportunityId,
    contactId: proposal.contactId,
    opportunity: proposal.opportunity,
    contact: proposal.contact,
    creator: proposal.creator,
    updater: proposal.updater,
    items: proposal.items.map((it) => ({
      id: it.id,
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      taxRate: Number(it.taxRate),
      amount: Number(it.amount),
      sortOrder: it.sortOrder,
    })),
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <ProposalDetailClient proposal={formattedProposal} versions={versions} handoffs={handoffs} />
    </div>
  );
}
