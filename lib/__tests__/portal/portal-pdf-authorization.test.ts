import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  generateClientPortalInvoicePdf,
  generateClientPortalProposalPdf,
  generateClientPortalContractPdf,
} from '@/lib/services/portal/portal-pdf-service';
import { getClientPortalSession } from '@/lib/services/portal/portal-auth-service';
import {
  getClientPortalInvoice,
  getClientPortalProposal,
  getClientPortalContract,
} from '@/lib/services/portal/portal-data-service';
import {
  generateInvoicePdf,
  generateProposalPdf,
  generateQuotationPdf,
  generateContractPdf,
} from '@/lib/services/documents/pdf-service';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';
import type { BrandTheme } from '@/lib/branding';

vi.mock('@/lib/services/portal/portal-auth-service', () => ({
  getClientPortalSession: vi.fn(),
}));

vi.mock('@/lib/services/portal/portal-data-service', () => ({
  getClientPortalInvoice: vi.fn(),
  getClientPortalProposal: vi.fn(),
  getClientPortalQuotation: vi.fn(),
  getClientPortalContract: vi.fn(),
}));

vi.mock('@/lib/services/documents/pdf-service', () => ({
  generateInvoicePdf: vi.fn(),
  generateProposalPdf: vi.fn(),
  generateQuotationPdf: vi.fn(),
  generateContractPdf: vi.fn(),
}));

vi.mock('@/lib/services/settings/branding-service', () => ({
  getBrandingForOrganization: vi.fn(),
}));

describe('Phase 11G: Client Portal PDF Authorization & Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientPortalSession).mockResolvedValue({
      portalAccessId: 'cpa-1',
      organizationId: 'org-agency-1',
      contactId: 'c-101',
      email: 'client@company.com',
      contactName: 'Alice Client',
      accountId: 'acc-1',
      accountName: 'Acme Corp',
      organizationName: 'Studio Agency',
      organizationBrand: { brandName: 'Studio Agency', brandColor: '#047857', logoUrl: null },
    });
    vi.mocked(getBrandingForOrganization).mockResolvedValue({
      brandName: 'Studio Agency',
      brandColor: '#047857',
      logoUrl: null,
      organizationName: 'Studio Agency',
      theme: 'classic' as unknown as BrandTheme,
      themeCss: '',
      isCustomized: false,
    });
    vi.mocked(generateInvoicePdf).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(generateProposalPdf).mockResolvedValue(new Uint8Array([4, 5, 6]));
    vi.mocked(generateQuotationPdf).mockResolvedValue(new Uint8Array([7, 8, 9]));
    vi.mocked(generateContractPdf).mockResolvedValue(new Uint8Array([10, 11, 12]));
  });

  it('generates invoice PDF only after verifying contact ownership of the invoice', async () => {
    vi.mocked(getClientPortalInvoice).mockResolvedValue({
      id: 'inv-101',
      number: 'INV-1001',
      title: 'Monthly Services',
      subtotal: '2500.00',
      tax: '0.00',
      total: '2500.00',
      currency: 'USD',
      status: 'sent',
      dueDate: new Date('2026-11-30'),
      createdAt: new Date('2026-11-01'),
      items: [
        {
          id: 'item-1',
          description: 'Consulting',
          quantity: '1',
          unitPrice: '2500.00',
          amount: '2500.00',
        },
      ],
    });

    const result = await generateClientPortalInvoicePdf('inv-101');

    expect(getClientPortalInvoice).toHaveBeenCalledWith('inv-101');
    expect(result.number).toBe('INV-1001');
    expect(result.pdfBuffer).toBeDefined();
  });

  it('generates proposal PDF verifying contact entitlement', async () => {
    vi.mocked(getClientPortalProposal).mockResolvedValue({
      id: 'prop-1',
      number: 'PRP-01',
      title: 'Design SOW',
      subtotal: '5000.00',
      tax: '0.00',
      total: '5000.00',
      currency: 'USD',
      status: 'sent',
      validUntil: new Date('2026-12-01'),
      createdAt: new Date('2026-11-01'),
      items: [],
    });

    const result = await generateClientPortalProposalPdf('prop-1');
    expect(getClientPortalProposal).toHaveBeenCalledWith('prop-1');
    expect(result.number).toBe('PRP-01');
  });

  it('generates contract PDF with truthful audit signature evidence', async () => {
    vi.mocked(getClientPortalContract).mockResolvedValue({
      id: 'ctr-1',
      title: 'MSA Contract',
      status: 'signed',
      proposalId: 'prop-1',
      projectId: null,
      signatureReference: 'portal-esign-123',
      signedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      signatures: [
        {
          id: 'sig-1',
          signerName: 'Alice Client',
          signerEmail: 'client@company.com',
          signedAt: new Date(),
          signatureMethod: 'audit_trail',
          signatureReference: 'portal-esign-123',
        },
      ],
    });

    const result = await generateClientPortalContractPdf('ctr-1');
    expect(getClientPortalContract).toHaveBeenCalledWith('ctr-1');
    expect(result.number).toBe('CTR-CTR-1');
  });

  it('rejects PDF generation when document does not belong to authorized contact', async () => {
    vi.mocked(getClientPortalInvoice).mockRejectedValue(
      Object.assign(new Error('Invoice not found or access denied'), { statusCode: 404 })
    );

    await expect(generateClientPortalInvoicePdf('foreign-inv-999')).rejects.toThrow(
      'Invoice not found or access denied'
    );
  });
});
