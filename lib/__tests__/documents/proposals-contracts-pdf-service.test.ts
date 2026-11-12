import { describe, it, expect } from 'vitest';
import {
  generateProposalPdf,
  generateQuotationPdf,
  generateContractPdf,
} from '@/lib/services/documents/pdf-service';
import type { ProposalResponse } from '@/lib/services/crm/proposal-service';
import type { QuotationResponse } from '@/lib/services/crm/quotation-service';
import type { ContractResponse } from '@/lib/services/documents/contract-service';

function inspectPdfStructure(bytes: Uint8Array) {
  const str = Buffer.from(bytes).toString('latin1');
  const hasValidHeader = str.startsWith('%PDF-');
  const hasEOF = str.includes('%%EOF');
  const pageMatches = str.match(/\/Type\s*\/Page[^s]/g) || [];
  return {
    hasValidHeader,
    hasEOF,
    pageCount: pageMatches.length,
    rawText: str,
  };
}

describe('Phase 11B: Proposals, Quotations & Contracts PDF Generation', () => {
  const mockProposal: ProposalResponse = {
    id: 'prop-unit-1',
    organizationId: 'org-test-1',
    number: 'PROP-1001',
    opportunityId: 'opp-1',
    contactId: 'contact-1',
    title: 'Cloud Infrastructure Modernization',
    status: 'sent',
    subtotal: '45000.00',
    tax: '4500.00',
    total: '49500.00',
    currency: 'USD',
    validUntil: new Date('2026-12-31'),
    notes: 'Standard 45-day warranty post deployment.',
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: null,
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
    creator: null,
    updater: null,
    opportunity: { id: 'opp-1', title: 'Infra Modernization' },
    contact: { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace' },
    items: [
      {
        id: 'p-item-1',
        proposalId: 'prop-unit-1',
        description: 'Multi-Region Kubernetes Architecture',
        quantity: '1',
        unitPrice: '25000.00',
        taxRate: '10.00',
        amount: '25000.00',
        sortOrder: 0,
        createdAt: new Date(),
      },
      {
        id: 'p-item-2',
        proposalId: 'prop-unit-1',
        description: 'Zero-Trust Security & RBAC Configuration',
        quantity: '1',
        unitPrice: '20000.00',
        taxRate: '10.00',
        amount: '20000.00',
        sortOrder: 1,
        createdAt: new Date(),
      },
    ],
  };

  const mockQuotation: QuotationResponse = {
    id: 'quot-unit-1',
    organizationId: 'org-test-1',
    number: 'QUOT-500',
    opportunityId: null,
    contactId: 'contact-2',
    title: 'Design Sprints & UX Prototyping',
    status: 'draft',
    subtotal: '12000.00',
    tax: '0.00',
    total: '12000.00',
    currency: 'GBP',
    validUntil: new Date('2026-12-15'),
    notes: 'Fixed-bid engagement terms apply.',
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: null,
    createdAt: new Date('2026-11-05'),
    updatedAt: new Date('2026-11-05'),
    creator: null,
    updater: null,
    opportunity: null,
    contact: { id: 'contact-2', firstName: 'Alan', lastName: 'Turing' },
    items: [
      {
        id: 'q-item-1',
        quotationId: 'quot-unit-1',
        description: '2-Week Rapid Design Sprint',
        quantity: '1',
        unitPrice: '12000.00',
        taxRate: '0.00',
        amount: '12000.00',
        sortOrder: 0,
        createdAt: new Date(),
      },
    ],
  };

  const mockContract: ContractResponse = {
    id: 'contract-unit-1',
    organizationId: 'org-test-1',
    proposalId: 'prop-unit-1',
    projectId: 'proj-1',
    title: 'Strategic Delivery Agreement',
    status: 'signed',
    signatureReference: 'SIG-VERIFIED-AUTH-00129',
    signedAt: new Date('2026-11-10T12:00:00Z'),
    signedBy: 'Grace Hopper',
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-10'),
    proposal: {
      id: 'prop-unit-1',
      number: 'PROP-1001',
      title: 'Infra Modernization',
      status: 'accepted',
    },
    project: { id: 'proj-1', name: 'Alpha Infra', status: 'active' },
    signer: { id: 'user-grace', name: 'Grace Hopper', email: 'grace@navy.mil' },
  };

  it('generates valid Proposal PDF with accurate line items and branding', () => {
    const bytes = generateProposalPdf(mockProposal, { brandName: 'TechCorp Solutions' });
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.hasEOF).toBe(true);
    expect(inspection.pageCount).toBe(1);
    expect(inspection.rawText).toContain('TechCorp Solutions');
    expect(inspection.rawText).toContain('PROP-1001');
    expect(inspection.rawText).toContain('Ada Lovelace');
    expect(inspection.rawText).toContain('49,500.00');
  });

  it('generates valid Quotation PDF with exact persisted totals and currency formatting', () => {
    const bytes = generateQuotationPdf(mockQuotation);
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.hasEOF).toBe(true);
    expect(inspection.rawText).toContain('QUOT-500');
    expect(inspection.rawText).toContain('Alan Turing');
    expect(inspection.rawText).toContain('GBP 12,000.00');
  });

  it('generates valid Contract PDF displaying actual verified signature metadata when signed', () => {
    const bytes = generateContractPdf(mockContract, { brandName: 'AgencyOS Legal' });
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.hasEOF).toBe(true);
    expect(inspection.rawText).toContain('CONTRACT AGREEMENT');
    expect(inspection.rawText).toContain('Strategic Delivery Agreement');
    expect(inspection.rawText).toContain('Signed and Executed');
    expect(inspection.rawText).toContain('Grace Hopper');
    expect(inspection.rawText).toContain('SIG-VERIFIED-AUTH-00129');
  });

  it('renders unsigned Contract PDF without fabricating signatures or execution claims', () => {
    const draftContract: ContractResponse = {
      ...mockContract,
      status: 'draft',
      signatureReference: null,
      signedAt: null,
      signedBy: null,
      signer: null,
    };

    const bytes = generateContractPdf(draftContract);
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.rawText).toContain('Status: DRAFT');
    expect(inspection.rawText).toContain('Pending Execution');
    expect(inspection.rawText).not.toContain('Signed and Executed');
    expect(inspection.rawText).not.toContain('SIG-VERIFIED-AUTH');
  });

  it('handles multi-page pagination for long proposals without layout clipping', () => {
    const longProposalItems = Array.from({ length: 40 }, (_, i) => ({
      id: `p-item-${i}`,
      proposalId: 'prop-unit-1',
      description: `Scope deliverable milestone #${i + 1} detailing comprehensive engineering specifications and cross-functional requirements`,
      quantity: '1',
      unitPrice: '1000.00',
      taxRate: '0.00',
      amount: '1000.00',
      sortOrder: i,
      createdAt: new Date(),
    }));

    const longProposal: ProposalResponse = {
      ...mockProposal,
      items: longProposalItems,
    };

    const bytes = generateProposalPdf(longProposal);
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.pageCount).toBeGreaterThanOrEqual(2);
    expect(inspection.rawText).toContain(`Page 1 of ${inspection.pageCount}`);
  });
});
