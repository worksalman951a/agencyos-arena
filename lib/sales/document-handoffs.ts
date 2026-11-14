/**
 * Sales document handoffs.
 *
 * Won work has to move forward: an accepted proposal seeds a project, a
 * contract or a quotation, and an accepted quotation seeds an estimate.
 *
 * Every handoff is a plain link to the create route that already exists, with
 * the prefill parameters that route already understands. Nothing here writes
 * data or resolves an organization: the destination page loads the source
 * through its own organization-scoped service and the create API still runs
 * `requirePermission`, so a handoff can never widen what the actor may do.
 *
 * The status and permission gates live here so the Bento view, the legacy
 * fallback and the tests all agree on when an action is offered.
 */

/** Handoffs open once the source document is won; drafts stay editable. */
export const HANDOFF_SOURCE_STATUS = 'accepted';

export type ProposalHandoffKind = 'project' | 'contract' | 'quotation';

/** Server-resolved capabilities, never the raw permission set. */
export interface ProposalHandoffPermissions {
  project: boolean;
  contract: boolean;
  quotation: boolean;
}

export interface ProposalHandoffSource {
  id: string;
  title: string;
  contactId: string | null;
  /** Accepted contract value, used as the project budget. */
  total: number | string;
}

export interface QuotationHandoffSource {
  id: string;
}

export const PROPOSAL_HANDOFF_LABELS: Record<ProposalHandoffKind, string> = {
  project: 'Create Project',
  contract: 'Create Contract',
  quotation: 'Create Quotation',
};

export const ESTIMATE_HANDOFF_LABEL = 'Create Estimate';

const PROPOSAL_HANDOFF_ORDER: readonly ProposalHandoffKind[] = ['project', 'contract', 'quotation'];

/** Which proposal handoffs this actor may see, in rendering order. */
export function visibleProposalHandoffs(
  status: string,
  permissions?: ProposalHandoffPermissions
): ProposalHandoffKind[] {
  if (status !== HANDOFF_SOURCE_STATUS || !permissions) return [];
  return PROPOSAL_HANDOFF_ORDER.filter((kind) => permissions[kind]);
}

/** The estimate handoff is offered on an accepted quotation to permitted actors. */
export function canHandoffQuotationToEstimate(
  status: string,
  canCreateEstimate?: boolean
): boolean {
  return status === HANDOFF_SOURCE_STATUS && Boolean(canCreateEstimate);
}

/**
 * Destinations and their existing prefill contracts:
 *  - projects/new           → name, clientId, budget
 *  - contracts/new          → proposalId, title (an explicit title is kept verbatim)
 *  - quotations/builder     → fromProposalId (copies lines, contact and currency)
 */
export function proposalHandoffHref(
  kind: ProposalHandoffKind,
  proposal: ProposalHandoffSource
): string {
  switch (kind) {
    case 'project': {
      const params = new URLSearchParams({
        name: proposal.title,
        budget: String(proposal.total),
      });
      if (proposal.contactId) params.set('clientId', proposal.contactId);
      return `/projects/new?${params.toString()}`;
    }
    case 'contract': {
      const params = new URLSearchParams({
        proposalId: proposal.id,
        title: proposal.title,
      });
      return `/documents/contracts/new?${params.toString()}`;
    }
    case 'quotation': {
      const params = new URLSearchParams({ fromProposalId: proposal.id });
      return `/sales/quotations/builder?${params.toString()}`;
    }
  }
}

/** estimates/new copies contact, total, currency and notes from the quotation. */
export function estimateHandoffHref(quotation: QuotationHandoffSource): string {
  const params = new URLSearchParams({ fromQuotationId: quotation.id });
  return `/finance/estimates/new?${params.toString()}`;
}
