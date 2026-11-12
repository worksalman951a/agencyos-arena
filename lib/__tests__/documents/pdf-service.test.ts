import { describe, it, expect } from 'vitest';
import { generateInvoicePdf, generateEstimatePdf } from '@/lib/services/documents/pdf-service';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';

describe('Phase 11A: Server-Side PDF Generation Service', () => {
  const mockInvoice: InvoiceResponse = {
    id: 'inv-test-1',
    organizationId: 'org-test-1',
    number: 'INV-2026-001',
    clientId: 'client-1',
    title: 'Q4 Product Design & Marketing Engagement',
    status: 'sent',
    subtotal: '12500.00',
    tax: '1250.00',
    total: '13750.00',
    currency: 'USD',
    dueDate: new Date('2026-12-15'),
    notes: 'Payment due within 30 days. Thank you for your business.',
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: null,
    createdAt: new Date('2026-11-12'),
    updatedAt: new Date('2026-11-12'),
    creator: { id: 'user-1', name: 'Billing Admin', email: 'billing@agency.test' },
    updater: null,
    client: { id: 'client-1', firstName: 'John', lastName: 'Doe' },
    items: [
      {
        id: 'item-1',
        invoiceId: 'inv-test-1',
        description: 'Brand Identity Design System & Guidelines',
        quantity: '1',
        unitPrice: '5000.00',
        taxRate: '10.00',
        amount: '5000.00',
        createdAt: new Date(),
      },
      {
        id: 'item-2',
        invoiceId: 'inv-test-1',
        description: 'Next.js Frontend Architecture & Web Application Implementation',
        quantity: '50',
        unitPrice: '150.00',
        taxRate: '10.00',
        amount: '7500.00',
        createdAt: new Date(),
      },
    ],
    payments: [],
  };

  const mockEstimate: EstimateResponse = {
    id: 'est-test-1',
    organizationId: 'org-test-1',
    number: 'EST-2026-042',
    clientId: 'client-1',
    client: {
      id: 'client-1',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@enterprise.test',
    },
    status: 'sent',
    total: '24000.00',
    currency: 'EUR',
    validUntil: new Date('2026-12-31'),
    notes: 'Estimate valid for 45 days. Deliverable schedule commences upon contract signature.',
    createdAt: new Date('2026-11-10'),
    updatedAt: new Date('2026-11-10'),
  };

  describe('Invoice PDF Generation', () => {
    it('produces valid PDF bytes with "%PDF-" signature', () => {
      const pdfBytes = generateInvoicePdf(mockInvoice, {
        brandName: 'Acme Digital Agency',
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      // Verify %PDF- magic bytes signature
      const header = String.fromCharCode(...pdfBytes.slice(0, 5));
      expect(header).toBe('%PDF-');
    });

    it('formats currency, numbers, and multiple line items cleanly', () => {
      const pdfBytes = generateInvoicePdf(mockInvoice);
      const pdfString = Buffer.from(pdfBytes).toString('latin1');

      // Verify core invoice numbers and branding appear in PDF output
      expect(pdfString).toContain('INV-2026-001');
      expect(pdfString).toContain('INVOICE');
      expect(pdfString).toContain('John Doe');
      expect(pdfString).toContain('13,750.00');
    });

    it('supports long line-item pagination without crashing', () => {
      const manyItems = Array.from({ length: 35 }, (_, i) => ({
        id: `item-${i}`,
        invoiceId: 'inv-test-1',
        description: `Deliverable milestone item #${i + 1} with extended scope documentation`,
        quantity: '1',
        unitPrice: '100.00',
        taxRate: '0.00',
        amount: '100.00',
        createdAt: new Date(),
      }));

      const longInvoice: InvoiceResponse = {
        ...mockInvoice,
        items: manyItems,
      };

      const pdfBytes = generateInvoicePdf(longInvoice);
      expect(pdfBytes.length).toBeGreaterThan(4000);
      const pdfString = Buffer.from(pdfBytes).toString('latin1');
      expect(pdfString).toContain('Page 1 of');
    });
  });

  describe('Estimate PDF Generation', () => {
    it('produces valid PDF bytes with "%PDF-" signature and currency formatting', () => {
      const pdfBytes = generateEstimatePdf(mockEstimate, {
        brandName: 'Starlight Creative',
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const header = String.fromCharCode(...pdfBytes.slice(0, 5));
      expect(header).toBe('%PDF-');

      const pdfString = Buffer.from(pdfBytes).toString('latin1');
      expect(pdfString).toContain('EST-2026-042');
      expect(pdfString).toContain('ESTIMATE / QUOTE');
      expect(pdfString).toContain('Jane Smith');
      expect(pdfString).toContain('24,000.00');
    });

    it('falls back gracefully when branding or optional fields are missing', () => {
      const bareEstimate: EstimateResponse = {
        id: 'est-bare',
        organizationId: 'org-test-1',
        number: 'EST-BARE',
        clientId: 'client-none',
        client: null,
        status: 'draft',
        total: '0.00',
        currency: 'USD',
        validUntil: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const pdfBytes = generateEstimatePdf(bareEstimate);
      expect(pdfBytes.length).toBeGreaterThan(500);
      const pdfString = Buffer.from(pdfBytes).toString('latin1');
      expect(pdfString).toContain('EST-BARE');
      expect(pdfString).toContain('Valued Client');
    });
  });
});
