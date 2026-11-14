import { describe, expect, it } from 'vitest';

import {
  PROPOSAL_HANDOFF_LABELS,
  proposalHandoffHref,
  visibleProposalHandoffs,
} from '@/lib/sales/document-handoffs';

const PROPOSAL = {
  id: 'prop_123',
  title: 'Enterprise Brand Refresh Proposal',
  contactId: 'contact_456',
  total: 3300,
};

const ALL_PERMITTED = { project: true, contract: true, quotation: true };

describe('sales document handoffs', () => {
  describe('visibility', () => {
    it('offers handoffs only once the proposal is accepted', () => {
      for (const status of ['draft', 'sent', 'viewed', 'rejected', 'expired']) {
        expect(visibleProposalHandoffs(status, ALL_PERMITTED), status).toEqual([]);
      }
      expect(visibleProposalHandoffs('accepted', ALL_PERMITTED)).toEqual([
        'project',
        'contract',
        'quotation',
      ]);
    });

    it('never offers an action the actor has no create permission for', () => {
      expect(
        visibleProposalHandoffs('accepted', {
          project: false,
          contract: true,
          quotation: false,
        })
      ).toEqual(['contract']);
      expect(
        visibleProposalHandoffs('accepted', {
          project: false,
          contract: false,
          quotation: false,
        })
      ).toEqual([]);
    });

    it('fails closed when the server resolved no capabilities', () => {
      expect(visibleProposalHandoffs('accepted')).toEqual([]);
      expect(visibleProposalHandoffs('accepted', undefined)).toEqual([]);
    });

    it('no longer exposes an estimate handoff from a quotation', async () => {
      // Estimates are retired from the active sales workflow. The module must
      // not export a handoff helper that could resurrect the creation flow.
      const handoffs = await import('@/lib/sales/document-handoffs');
      expect('estimateHandoffHref' in handoffs).toBe(false);
      expect('canHandoffQuotationToEstimate' in handoffs).toBe(false);
      expect('ESTIMATE_HANDOFF_LABEL' in handoffs).toBe(false);
    });
  });

  describe('destinations', () => {
    it('reuses the project create route with name, client and budget prefill', () => {
      const url = new URL(proposalHandoffHref('project', PROPOSAL), 'https://agency.test');
      expect(url.pathname).toBe('/projects/new');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        name: PROPOSAL.title,
        budget: '3300',
        clientId: PROPOSAL.contactId,
      });
    });

    it('omits clientId when the proposal has no contact', () => {
      const url = new URL(
        proposalHandoffHref('project', { ...PROPOSAL, contactId: null }),
        'https://agency.test'
      );
      expect(url.searchParams.has('clientId')).toBe(false);
      expect(url.searchParams.get('name')).toBe(PROPOSAL.title);
    });

    it('keeps a decimal contract value intact as the budget', () => {
      const url = new URL(
        proposalHandoffHref('project', { ...PROPOSAL, total: '3300.50' }),
        'https://agency.test'
      );
      expect(url.searchParams.get('budget')).toBe('3300.50');
    });

    it('links the contract to the proposal and passes the title verbatim', () => {
      const url = new URL(proposalHandoffHref('contract', PROPOSAL), 'https://agency.test');
      expect(url.pathname).toBe('/documents/contracts/new');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        proposalId: PROPOSAL.id,
        title: PROPOSAL.title,
      });
    });

    it('seeds the quotation builder from the source proposal', () => {
      const url = new URL(proposalHandoffHref('quotation', PROPOSAL), 'https://agency.test');
      expect(url.pathname).toBe('/sales/quotations/builder');
      expect(Object.fromEntries(url.searchParams)).toEqual({ fromProposalId: PROPOSAL.id });
    });

    it('escapes titles so a query string cannot be smuggled through', () => {
      const title = 'Retainer & Scope ?phase=2#top';
      const url = new URL(
        proposalHandoffHref('project', { ...PROPOSAL, title }),
        'https://agency.test'
      );
      expect(url.searchParams.get('name')).toBe(title);
      expect(url.searchParams.get('phase')).toBeNull();
      expect(url.hash).toBe('');
      expect([...url.searchParams.keys()]).toEqual(['name', 'budget', 'clientId']);
    });

    it('labels the actions the workflow clicks', () => {
      expect(PROPOSAL_HANDOFF_LABELS).toEqual({
        project: 'Create Project',
        contract: 'Create Contract',
        quotation: 'Create Quotation',
      });
    });
  });
});
