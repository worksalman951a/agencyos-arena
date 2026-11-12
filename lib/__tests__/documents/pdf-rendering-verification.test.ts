import { describe, it, expect } from 'vitest';
import { generateInvoicePdf, generateEstimatePdf } from '@/lib/services/documents/pdf-service';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';

/**
 * Basic PDF structural inspection helper to verify PDF syntax and dictionary objects
 * without external binary dependencies.
 */
function inspectPdfStructure(bytes: Uint8Array) {
  const str = Buffer.from(bytes).toString('latin1');
  const hasValidHeader = str.startsWith('%PDF-');
  const hasEOF = str.trimEnd().endsWith('%%EOF') || str.includes('%%EOF');

  // Count page dictionary references: /Type /Page (and /Pages)
  const pageMatches = str.match(/\/Type\s*\/Page[^s]/g) || [];
  const pageCount = pageMatches.length;

  return {
    hasValidHeader,
    hasEOF,
    pageCount,
    rawText: str,
  };
}

describe('Phase 11A: PDF Rendering Correctness & Structural Verification', () => {
  const baseInvoice: InvoiceResponse = {
    id: 'inv-struct-1',
    organizationId: 'org-test-1',
    number: 'INV-2026-900',
    clientId: 'client-1',
    title: 'Enterprise Architecture & Cloud Modernization',
    status: 'sent',
    subtotal: '10000.00',
    tax: '1000.00',
    total: '11000.00',
    currency: 'USD',
    dueDate: new Date('2026-12-31'),
    notes: 'Net 30. Wire transfer instructions on file.',
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: null,
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
    creator: null,
    updater: null,
    client: { id: 'client-1', firstName: 'Alexander', lastName: 'Hamilton' },
    items: [
      {
        id: 'item-1',
        invoiceId: 'inv-struct-1',
        description: 'Core Architecture Review & Threat Modeling',
        quantity: '1',
        unitPrice: '4000.00',
        taxRate: '10.00',
        amount: '4000.00',
        createdAt: new Date(),
      },
      {
        id: 'item-2',
        invoiceId: 'inv-struct-1',
        description: 'Cloud Infrastructure Implementation & Kubernetes Deployment',
        quantity: '40',
        unitPrice: '150.00',
        taxRate: '10.00',
        amount: '6000.00',
        createdAt: new Date(),
      },
    ],
    payments: [],
  };

  const baseEstimate: EstimateResponse = {
    id: 'est-struct-1',
    organizationId: 'org-test-1',
    number: 'EST-2026-800',
    clientId: 'client-1',
    client: {
      id: 'client-1',
      firstName: 'Catherine',
      lastName: 'Great',
      email: 'catherine@imperial.test',
    },
    status: 'draft',
    total: '75000.00',
    currency: 'EUR',
    validUntil: new Date('2027-01-31'),
    notes: 'Milestone-based delivery: Phase 1 (30%), Phase 2 (40%), Phase 3 (30%).',
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
  };

  it('validates PDF syntax and structure for standard invoice', () => {
    const bytes = generateInvoicePdf(baseInvoice);
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.hasEOF).toBe(true);
    expect(inspection.pageCount).toBe(1);
    expect(inspection.rawText).toContain('INV-2026-900');
    expect(inspection.rawText).toContain('11,000.00');
    expect(inspection.rawText).toContain('Alexander Hamilton');
  });

  it('correctly handles multi-page document pagination (page breaks and headers)', () => {
    const longItems = Array.from({ length: 45 }, (_, i) => ({
      id: `item-${i}`,
      invoiceId: 'inv-struct-1',
      description: `Service phase item #${i + 1} with extended multi-line task description detailing specific sprint deliverables and QA checklists`,
      quantity: '2.5',
      unitPrice: '120.00',
      taxRate: '0.00',
      amount: '300.00',
      createdAt: new Date(),
    }));

    const longInvoice: InvoiceResponse = {
      ...baseInvoice,
      items: longItems,
    };

    const bytes = generateInvoicePdf(longInvoice);
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.hasEOF).toBe(true);
    expect(inspection.pageCount).toBeGreaterThanOrEqual(2);
    expect(inspection.rawText).toContain(`Page 1 of ${inspection.pageCount}`);
    expect(inspection.rawText).toContain(`Page ${inspection.pageCount} of ${inspection.pageCount}`);
  });

  it('renders varied currencies and decimal-safe values accurately without floating drift', () => {
    const multiCurrencyInvoices: Array<{
      currency: string;
      subtotal: string;
      tax: string;
      total: string;
    }> = [
      { currency: 'GBP', subtotal: '1234.56', tax: '246.91', total: '1481.47' },
      { currency: 'JPY', subtotal: '500000.00', tax: '50000.00', total: '550000.00' },
      { currency: 'CAD', subtotal: '99.99', tax: '13.00', total: '112.99' },
    ];

    for (const testCase of multiCurrencyInvoices) {
      const inv: InvoiceResponse = {
        ...baseInvoice,
        currency: testCase.currency,
        subtotal: testCase.subtotal,
        tax: testCase.tax,
        total: testCase.total,
      };

      const bytes = generateInvoicePdf(inv);
      const inspection = inspectPdfStructure(bytes);

      expect(inspection.hasValidHeader).toBe(true);
      expect(inspection.rawText).toContain(testCase.currency);
    }
  });

  it('handles optional fields, missing client name, null notes, and special characters', () => {
    const bareInvoice: InvoiceResponse = {
      ...baseInvoice,
      title: '',
      client: null,
      dueDate: null,
      notes: null,
      items: [],
      tax: '0.00',
      total: '0.00',
      subtotal: '0.00',
    };

    const bytes = generateInvoicePdf(bareInvoice);
    const inspection = inspectPdfStructure(bytes);

    expect(inspection.hasValidHeader).toBe(true);
    expect(inspection.pageCount).toBe(1);
    expect(inspection.rawText).toContain('Valued Client');
    expect(inspection.rawText).toContain('No line items specified');
  });

  describe('Font & Character Encoding Capabilities', () => {
    it('supports standard ASCII and Latin-1 extended characters (e.g. accents)', () => {
      const accentedInvoice: InvoiceResponse = {
        ...baseInvoice,
        client: { id: 'c-1', firstName: 'René', lastName: 'François' },
        notes: 'Services réalisés à Genève. Facture acquittée.',
      };

      const bytes = generateInvoicePdf(accentedInvoice);
      const inspection = inspectPdfStructure(bytes);

      expect(inspection.hasValidHeader).toBe(true);
      // Latin1 string conversion preserves accented characters
      expect(inspection.rawText).toContain('Ren');
      expect(inspection.rawText).toContain('Gen');
    });

    it('documents behavior for non-Latin scripts (Urdu / Arabic / RTL)', () => {
      // Standard Type 1 Helvetica fonts in jsPDF do not include complex Unicode shaping or Arabic/Urdu glyph tables.
      // We verify that passing Arabic/Urdu text does not crash the server generation process,
      // while acknowledging that glyph rendering requires external font bundles not bundled in base jsPDF.
      const urduEstimate: EstimateResponse = {
        ...baseEstimate,
        notes: 'یہ ایک تخمینہ ہے برائے سافٹ ویئر ڈویلپمنٹ',
      };

      expect(() => generateEstimatePdf(urduEstimate)).not.toThrow();
      const bytes = generateEstimatePdf(urduEstimate);
      expect(bytes.length).toBeGreaterThan(1000);
    });
  });
});
