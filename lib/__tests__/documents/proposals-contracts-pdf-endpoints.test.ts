import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getProposalPdf } from '@/app/api/v1/crm/proposals/[id]/pdf/route';
import { GET as getQuotationPdf } from '@/app/api/v1/crm/quotations/[id]/pdf/route';
import { GET as getContractPdf } from '@/app/api/v1/documents/contracts/[id]/pdf/route';

vi.mock('@/lib/services/crm/proposal-service', () => ({
  getProposal: vi.fn(),
}));

vi.mock('@/lib/services/crm/quotation-service', () => ({
  getQuotation: vi.fn(),
}));

vi.mock('@/lib/services/documents/contract-service', () => ({
  getContract: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    organizationSetting: {
      findFirst: vi.fn().mockResolvedValue({
        brandName: 'Prestige Agency',
        brandColor: '#0f172a',
        logoUrl: null,
      }),
    },
  },
}));

import { getProposal } from '@/lib/services/crm/proposal-service';
import { getQuotation } from '@/lib/services/crm/quotation-service';
import { getContract } from '@/lib/services/documents/contract-service';

describe('Phase 11B: Proposal, Quotation & Contract PDF Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/crm/proposals/[id]/pdf', () => {
    it('returns 200 with application/pdf and attachment header for authorized proposal', async () => {
      vi.mocked(getProposal).mockResolvedValue({
        id: 'prop-101',
        organizationId: 'org-1',
        number: 'PROP-2026-001',
        opportunityId: 'opp-1',
        contactId: 'contact-1',
        title: 'Full-Stack Modernization Proposal',
        status: 'sent',
        subtotal: '25000.00',
        tax: '2500.00',
        total: '27500.00',
        currency: 'USD',
        validUntil: new Date('2026-12-31'),
        notes: 'Delivery over 8 weeks.',
        deletedAt: null,
        createdBy: 'user-1',
        updatedBy: null,
        createdAt: new Date('2026-11-10'),
        updatedAt: new Date('2026-11-10'),
        creator: null,
        updater: null,
        opportunity: { id: 'opp-1', title: 'Q4 Digital Transformation' },
        contact: { id: 'contact-1', firstName: 'Diana', lastName: 'Prince' },
        items: [
          {
            id: 'item-p1',
            proposalId: 'prop-101',
            description: 'Core Discovery & System Architecture',
            quantity: '1',
            unitPrice: '10000.00',
            taxRate: '10.00',
            amount: '10000.00',
            sortOrder: 0,
            createdAt: new Date(),
          },
        ],
      });

      const req = new Request('http://localhost/api/v1/crm/proposals/prop-101/pdf');
      const params = Promise.resolve({ id: 'prop-101' });
      const res = await getProposalPdf(req, { params });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toBe(
        'attachment; filename="Proposal_PROP-2026-001.pdf"'
      );

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);
      const signature = String.fromCharCode(...new Uint8Array(arrayBuf.slice(0, 5)));
      expect(signature).toBe('%PDF-');
    });

    it('returns 404 if proposal does not exist or user is unauthorized', async () => {
      vi.mocked(getProposal).mockRejectedValue(
        Object.assign(new Error('Not found'), { statusCode: 404 })
      );

      const req = new Request('http://localhost/api/v1/crm/proposals/prop-none/pdf');
      const params = Promise.resolve({ id: 'prop-none' });
      const res = await getProposalPdf(req, { params });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Not found');
    });
  });

  describe('GET /api/v1/crm/quotations/[id]/pdf', () => {
    it('returns 200 with application/pdf and attachment header for authorized quotation', async () => {
      vi.mocked(getQuotation).mockResolvedValue({
        id: 'quot-202',
        organizationId: 'org-1',
        number: 'QUOT-888',
        opportunityId: null,
        contactId: 'contact-2',
        title: 'Design Sprints & Prototyping',
        status: 'draft',
        subtotal: '15000.00',
        tax: '0.00',
        total: '15000.00',
        currency: 'EUR',
        validUntil: new Date('2026-12-15'),
        notes: 'Price guaranteed for 30 calendar days.',
        deletedAt: null,
        createdBy: 'user-1',
        updatedBy: null,
        createdAt: new Date('2026-11-12'),
        updatedAt: new Date('2026-11-12'),
        creator: null,
        updater: null,
        opportunity: null,
        contact: { id: 'contact-2', firstName: 'Bruce', lastName: 'Wayne' },
        items: [],
      });

      const req = new Request('http://localhost/api/v1/crm/quotations/quot-202/pdf');
      const params = Promise.resolve({ id: 'quot-202' });
      const res = await getQuotationPdf(req, { params });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toBe(
        'attachment; filename="Quotation_QUOT-888.pdf"'
      );

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);
      const signature = String.fromCharCode(...new Uint8Array(arrayBuf.slice(0, 5)));
      expect(signature).toBe('%PDF-');
    });
  });

  describe('GET /api/v1/documents/contracts/[id]/pdf', () => {
    it('returns 200 with application/pdf and reflects actual signature audit metadata when signed', async () => {
      vi.mocked(getContract).mockResolvedValue({
        id: 'contract-303',
        organizationId: 'org-1',
        proposalId: 'prop-101',
        projectId: 'proj-1',
        title: 'Master Consulting Agreement',
        status: 'signed',
        signatureReference: 'SIG-VERIFY-998877',
        signedAt: new Date('2026-11-12T14:30:00Z'),
        signedBy: 'Clark Kent',
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-12'),
        proposal: {
          id: 'prop-101',
          number: 'PROP-2026-001',
          title: 'Modernization',
          status: 'accepted',
        },
        project: { id: 'proj-1', name: 'Alpha Delivery', status: 'active' },
        signer: { id: 'user-3', name: 'Clark Kent', email: 'clark@kent.test' },
      });

      const req = new Request('http://localhost/api/v1/documents/contracts/contract-303/pdf');
      const params = Promise.resolve({ id: 'contract-303' });
      const res = await getContractPdf(req, { params });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toContain(
        'attachment; filename="Contract_Master_Consulting_Agreement_ct-303.pdf"'
      );

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);
      const signature = String.fromCharCode(...new Uint8Array(arrayBuf.slice(0, 5)));
      expect(signature).toBe('%PDF-');

      const pdfText = Buffer.from(arrayBuf).toString('latin1');
      expect(pdfText).toContain('Signed and Executed');
      expect(pdfText).toContain('Clark Kent');
      expect(pdfText).toContain('SIG-VERIFY-998877');
    });

    it('returns 403 Forbidden for cross-tenant contract access', async () => {
      vi.mocked(getContract).mockRejectedValue(
        Object.assign(new Error('Forbidden'), { statusCode: 403 })
      );

      const req = new Request('http://localhost/api/v1/documents/contracts/contract-foreign/pdf');
      const params = Promise.resolve({ id: 'contract-foreign' });
      const res = await getContractPdf(req, { params });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });
  });
});
