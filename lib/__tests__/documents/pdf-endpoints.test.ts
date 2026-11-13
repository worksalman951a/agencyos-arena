import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getInvoicePdf } from '@/app/api/v1/crm/invoices/[id]/pdf/route';
import { GET as getEstimatePdf } from '@/app/api/v1/finance/estimates/[id]/pdf/route';

vi.mock('@/lib/services/crm/invoice-service', () => ({
  getInvoice: vi.fn(),
}));

vi.mock('@/lib/services/crm/estimate-service', () => ({
  getEstimate: vi.fn(),
}));

// Branding is resolved through the authorized branding service (it reads the
// organization the caller was already allowed to see), not by the route reaching
// into the database.
vi.mock('@/lib/services/settings/branding-service', () => ({
  getBrandingForOrganization: vi.fn().mockResolvedValue({
    brandName: 'Test Org Agency',
    brandColor: '#2563eb',
    logoUrl: null,
  }),
}));

import { getInvoice } from '@/lib/services/crm/invoice-service';
import { getEstimate } from '@/lib/services/crm/estimate-service';

describe('Phase 11A: PDF Download API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/crm/invoices/[id]/pdf', () => {
    it('returns 200 with application/pdf and attachment header for authorized invoice', async () => {
      vi.mocked(getInvoice).mockResolvedValue({
        id: 'inv-123',
        organizationId: 'org-1',
        number: 'INV-1001',
        clientId: 'client-1',
        projectId: null,
        project: null,
        title: 'Development Project',
        status: 'sent',
        subtotal: '1000.00',
        tax: '0.00',
        total: '1000.00',
        currency: 'USD',
        dueDate: new Date('2026-12-01'),
        notes: null,
        deletedAt: null,
        createdBy: 'user-1',
        updatedBy: null,
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-01'),
        creator: null,
        updater: null,
        client: { id: 'client-1', firstName: 'Alice', lastName: 'Walker' },
        items: [],
        payments: [],
      });

      const req = new Request('http://localhost/api/v1/crm/invoices/inv-123/pdf');
      const params = Promise.resolve({ id: 'inv-123' });
      const res = await getInvoicePdf(req, { params });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toBe(
        'attachment; filename="Invoice_INV-1001.pdf"'
      );

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);
      const signature = String.fromCharCode(...new Uint8Array(arrayBuf.slice(0, 5)));
      expect(signature).toBe('%PDF-');
    });

    it('returns 404 or authorization error if invoice not accessible', async () => {
      vi.mocked(getInvoice).mockRejectedValue(
        Object.assign(new Error('Not found'), { statusCode: 404 })
      );

      const req = new Request('http://localhost/api/v1/crm/invoices/inv-other/pdf');
      const params = Promise.resolve({ id: 'inv-other' });
      const res = await getInvoicePdf(req, { params });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Not found');
    });
  });

  describe('GET /api/v1/finance/estimates/[id]/pdf', () => {
    it('returns 200 with application/pdf and attachment header for authorized estimate', async () => {
      vi.mocked(getEstimate).mockResolvedValue({
        id: 'est-456',
        organizationId: 'org-1',
        number: 'EST-2026',
        clientId: 'client-2',
        client: { id: 'client-2', firstName: 'Bob', lastName: 'Taylor', email: 'bob@taylor.test' },
        status: 'draft',
        total: '5500.00',
        currency: 'GBP',
        validUntil: new Date('2026-12-31'),
        notes: 'Subject to terms',
        createdAt: new Date('2026-11-05'),
        updatedAt: new Date('2026-11-05'),
      });

      const req = new Request('http://localhost/api/v1/finance/estimates/est-456/pdf');
      const params = Promise.resolve({ id: 'est-456' });
      const res = await getEstimatePdf(req, { params });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toBe(
        'attachment; filename="Estimate_EST-2026.pdf"'
      );

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);
      const signature = String.fromCharCode(...new Uint8Array(arrayBuf.slice(0, 5)));
      expect(signature).toBe('%PDF-');
    });

    it('propagates 403 Forbidden for cross-tenant access rejection', async () => {
      vi.mocked(getEstimate).mockRejectedValue(
        Object.assign(new Error('Forbidden'), { statusCode: 403 })
      );

      const req = new Request('http://localhost/api/v1/finance/estimates/est-foreign/pdf');
      const params = Promise.resolve({ id: 'est-foreign' });
      const res = await getEstimatePdf(req, { params });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });
  });
});
