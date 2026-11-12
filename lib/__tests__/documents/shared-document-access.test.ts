import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET as getPublicDocLink } from '@/app/api/v1/documents/links/[token]/route';
import { GET as getPublicDocPdf } from '@/app/api/v1/documents/links/[token]/pdf/route';
import { verifyDocumentLink } from '@/lib/services/documents/link-service';
import { generateSharedDocumentPdf } from '@/lib/services/documents/pdf-service';

vi.mock('@/lib/services/documents/link-service', () => ({
  verifyDocumentLink: vi.fn(),
}));

function inspectPdfStructure(bytes: Uint8Array) {
  const header = String.fromCharCode(...bytes.slice(0, 8));
  const text = new TextDecoder('latin1').decode(bytes);
  return {
    hasValidHeader: header.startsWith('%PDF-'),
    hasEof: text.includes('%%EOF'),
    pageCount: (text.match(/\/Type\s*\/Page\b/g) || []).length,
    rawText: text,
  };
}

describe('Phase 11C: Secure Shared Documents & Public PDF Downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSnapshot: import('@/lib/services/documents/link-service').SharedDocumentPublicSnapshot =
    {
      entityType: 'proposal',
      number: 'PROP-999',
      title: 'Acme Cloud Modernization',
      status: 'sent',
      currency: 'USD',
      validUntil: '2026-12-31T00:00:00.000Z',
      subtotal: '25000.00',
      tax: '2500.00',
      total: '27500.00',
      notes: 'Payment terms: Net 30 upon milestone approval.',
      clientName: 'Alice Walker',
      items: [
        {
          description: 'Architecture review & discovery',
          quantity: '1',
          unitPrice: '10000.00',
          taxRate: '10',
          amount: '10000.00',
        },
        {
          description: 'Microservices migration sprint',
          quantity: '1',
          unitPrice: '15000.00',
          taxRate: '10',
          amount: '15000.00',
        },
      ],
      branding: {
        brandName: 'Starlight Agency',
        brandColor: '#2563eb',
        logoUrl: null,
      },
    };

  describe('GET /api/v1/documents/links/[token]', () => {
    it('returns document metadata and snapshot for valid token', async () => {
      vi.mocked(verifyDocumentLink).mockResolvedValue({
        id: 'link-1',
        documentId: 'doc-1',
        documentTitle: 'PROP-999 — Acme Cloud Modernization',
        documentType: 'proposal',
        expiresAt: new Date(Date.now() + 86400000),
        accessCount: 1,
        maxAccess: 10,
        snapshot: mockSnapshot,
      });

      const req = new Request('http://localhost/api/v1/documents/links/valid-token-123');
      const params = Promise.resolve({ token: 'valid-token-123' });
      const res = await getPublicDocLink(req, { params });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.documentTitle).toBe('PROP-999 — Acme Cloud Modernization');
      expect(data.snapshot.total).toBe('27500.00');
    });

    it('returns 404 for invalid/unrecognized token without revealing internal data', async () => {
      vi.mocked(verifyDocumentLink).mockRejectedValue(
        Object.assign(new Error('Invalid link'), { statusCode: 404 })
      );

      const req = new Request('http://localhost/api/v1/documents/links/bad-token');
      const params = Promise.resolve({ token: 'bad-token' });
      const res = await getPublicDocLink(req, { params });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Link not found');
    });

    it('returns 410 for expired link', async () => {
      vi.mocked(verifyDocumentLink).mockRejectedValue(
        Object.assign(new Error('Link expired'), { statusCode: 410 })
      );

      const req = new Request('http://localhost/api/v1/documents/links/expired-token');
      const params = Promise.resolve({ token: 'expired-token' });
      const res = await getPublicDocLink(req, { params });

      expect(res.status).toBe(410);
      const data = await res.json();
      expect(data.error).toBe('Link expired');
    });

    it('returns 403 when link access limit is reached', async () => {
      vi.mocked(verifyDocumentLink).mockRejectedValue(
        Object.assign(new Error('Link access limit reached'), { statusCode: 403 })
      );

      const req = new Request('http://localhost/api/v1/documents/links/exhausted-token');
      const params = Promise.resolve({ token: 'exhausted-token' });
      const res = await getPublicDocLink(req, { params });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Link access limit reached');
    });
  });

  describe('GET /api/v1/documents/links/[token]/pdf', () => {
    it('generates and streams PDF attachment with safe headers for valid token', async () => {
      vi.mocked(verifyDocumentLink).mockResolvedValue({
        id: 'link-1',
        documentId: 'doc-1',
        documentTitle: 'PROP-999 — Acme Cloud Modernization',
        documentType: 'proposal',
        expiresAt: new Date(Date.now() + 86400000),
        accessCount: 1,
        maxAccess: 10,
        snapshot: mockSnapshot,
      });

      const req = new Request('http://localhost/api/v1/documents/links/valid-token-123/pdf');
      const params = Promise.resolve({ token: 'valid-token-123' });
      const res = await getPublicDocPdf(req, { params });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('cache-control')).toBe('private, no-cache, no-store, must-revalidate');
      expect(res.headers.get('content-disposition')).toContain('attachment');

      const arrayBuf = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      const inspection = inspectPdfStructure(bytes);
      expect(inspection.hasValidHeader).toBe(true);
      expect(inspection.hasEof).toBe(true);
    });

    it('returns 410 when token is expired and denies PDF generation', async () => {
      vi.mocked(verifyDocumentLink).mockRejectedValue(
        Object.assign(new Error('Link expired'), { statusCode: 410 })
      );

      const req = new Request('http://localhost/api/v1/documents/links/expired-token/pdf');
      const params = Promise.resolve({ token: 'expired-token' });
      const res = await getPublicDocPdf(req, { params });

      expect(res.status).toBe(410);
      const data = await res.json();
      expect(data.error).toBe('Link expired');
    });
  });

  describe('generateSharedDocumentPdf unit rendering', () => {
    it('renders proposal snapshot to authentic PDF bytes', () => {
      const bytes = generateSharedDocumentPdf(mockSnapshot);
      const inspection = inspectPdfStructure(bytes);

      expect(inspection.hasValidHeader).toBe(true);
      expect(inspection.hasEof).toBe(true);
      expect(inspection.rawText).toContain('Starlight Agency');
      expect(inspection.rawText).toContain('PROP-999');
      expect(inspection.rawText).toContain('Alice Walker');
    });

    it('renders contract snapshot truthfully without fabricating cryptographic stamps', () => {
      const contractSnapshot = {
        entityType: 'contract',
        number: 'CONT-500',
        title: 'Enterprise Master Services Agreement',
        status: 'draft',
        notes: 'Binding terms of engagement and delivery milestones.',
        signedAt: null,
        signatureReference: null,
        clientName: 'Contoso Ltd',
        branding: { brandName: 'Starlight Agency', brandColor: '#0f172a', logoUrl: null },
      };

      const bytes = generateSharedDocumentPdf(contractSnapshot);
      const inspection = inspectPdfStructure(bytes);

      expect(inspection.hasValidHeader).toBe(true);
      expect(inspection.rawText).toContain('Enterprise Master Services Agreement');
      expect(inspection.rawText).toContain('Pending Execution');
      expect(inspection.rawText).not.toContain('Signed and Executed');
    });

    it('renders signed contract snapshot with authentic recorded acceptance metadata', () => {
      const signedSnapshot = {
        entityType: 'contract',
        number: 'CONT-500',
        title: 'Enterprise Master Services Agreement',
        status: 'signed',
        notes: 'Binding terms of engagement and delivery milestones.',
        signedAt: '2026-11-10T14:30:00.000Z',
        signatureReference: 'AUDIT-REF-7721',
        clientName: 'Jane Doe',
        branding: { brandName: 'Starlight Agency', brandColor: '#0f172a', logoUrl: null },
      };

      const bytes = generateSharedDocumentPdf(signedSnapshot);
      const inspection = inspectPdfStructure(bytes);

      expect(inspection.hasValidHeader).toBe(true);
      expect(inspection.rawText).toContain('Signed and Executed');
      expect(inspection.rawText).toContain('Jane Doe');
      expect(inspection.rawText).toContain('AUDIT-REF-7721');
    });
  });
});
