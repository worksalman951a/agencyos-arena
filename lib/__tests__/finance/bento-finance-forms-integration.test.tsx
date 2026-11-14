import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Form and view components
import { NewInvoiceForm } from '@/app/finance/invoices/new/NewInvoiceForm';
import { EditInvoiceForm } from '@/app/finance/invoices/[id]/edit/EditInvoiceForm';
import NewExpensePage from '@/app/finance/expenses/new/page';
import EditExpensePage from '@/app/finance/expenses/[id]/edit/page';
import { BentoInvoiceRecordView } from '@/components/finance/bento-invoice-record-view';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

let mockUseBento = false;
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBento,
}));

describe('Finance Forms Bento Integration and Fallback Parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBento = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/v1/finance/expenses/exp-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'exp-1',
            category: 'Software Subscriptions',
            amount: '299.00',
            expenseDate: '2026-11-01T00:00:00Z',
            receiptUrl: 'https://storage.example.com/receipt.pdf',
            billable: true,
          }),
        });
      }
      if (typeof url === 'string' && url.includes('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            contacts: [
              { id: 'cnt-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    }) as unknown as typeof fetch;
  });

  describe('Invoice Forms', () => {
    const dummyContacts = [{ id: 'cnt-1', label: 'Acme Contact (John)' }];

    it('renders legacy new invoice form when Bento is disabled', () => {
      mockUseBento = false;
      render(<NewInvoiceForm contacts={dummyContacts} />);
      expect(screen.getByLabelText(/Title/i)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Create Invoice' })).toBeDefined();
      expect(screen.getByText('Line Items')).toBeDefined();
    });

    it('renders Bento new invoice view when Bento is enabled', () => {
      mockUseBento = true;
      render(<NewInvoiceForm contacts={dummyContacts} />);
      expect(screen.getByRole('heading', { level: 1, name: 'New Sales Invoice' })).toBeDefined();
      expect(screen.getByText('Commercial Terms & Invoice Header')).toBeDefined();
      expect(screen.getByText('Billable Items & Services')).toBeDefined();
      expect(screen.getByText('Financial Policy & Allocation')).toBeDefined();
    });

    it('renders legacy edit invoice form when Bento is disabled', () => {
      mockUseBento = false;
      const editableInvoice = {
        id: 'inv-1',
        number: 'INV-2026-0001',
        title: 'Platform Development',
        status: 'draft',
        currency: 'USD',
        dueDate: '2026-12-01',
        notes: 'Net 30',
        clientId: 'cnt-1',
        items: [{ description: 'Design Sprint', quantity: '1', unitPrice: '1200', taxRate: '0' }],
      };

      render(
        <EditInvoiceForm
          invoice={editableInvoice}
          contacts={dummyContacts}
          statusOptions={[
            { value: 'draft', label: 'Draft' },
            { value: 'sent', label: 'Sent' },
          ]}
        />
      );

      expect(screen.getByDisplayValue('Platform Development')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDefined();
    });

    it('renders Bento edit invoice view when Bento is enabled', () => {
      mockUseBento = true;
      const editableInvoice = {
        id: 'inv-1',
        number: 'INV-2026-0001',
        title: 'Platform Development',
        status: 'draft',
        currency: 'USD',
        dueDate: '2026-12-01',
        notes: 'Net 30',
        clientId: 'cnt-1',
        items: [{ description: 'Design Sprint', quantity: '1', unitPrice: '1200', taxRate: '0' }],
      };

      render(
        <EditInvoiceForm
          invoice={editableInvoice}
          contacts={dummyContacts}
          statusOptions={[
            { value: 'draft', label: 'Draft' },
            { value: 'sent', label: 'Sent' },
          ]}
        />
      );

      expect(
        screen.getByRole('heading', { level: 1, name: /Edit Invoice: INV-2026-0001/i })
      ).toBeDefined();
      expect(screen.getByText('Billable Items & Services')).toBeDefined();
    });
  });

  // Estimates are historical and read-only. The create, edit and convert pages
  // were deleted with the retirement, so there is nothing left to render for
  // them: only the read-only register and record views remain, and they are
  // covered by `lib/__tests__/sales/estimate-read-only.test.ts` plus the Bento
  // integration suite.
  describe('Estimate forms are gone', () => {
    it.each([
      ['new', 'app/finance/estimates/new/page.tsx'],
      ['edit', 'app/finance/estimates/[id]/edit/page.tsx'],
      ['convert', 'app/finance/estimates/[id]/convert/page.tsx'],
    ])('ships no %s page', (_label, relative) => {
      expect(fs.existsSync(path.join(process.cwd(), relative))).toBe(false);
    });
  });

  describe('Expense Forms', () => {
    it('renders legacy expense creation when Bento is disabled', () => {
      mockUseBento = false;
      render(<NewExpensePage />);
      expect(screen.getByRole('heading', { level: 1, name: 'New Expense' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Create Expense' })).toBeDefined();
    });

    it('renders Bento expense creation view when Bento is enabled', () => {
      mockUseBento = true;
      render(<NewExpensePage />);
      expect(screen.getByRole('heading', { level: 1, name: 'Log New Expense' })).toBeDefined();
      expect(screen.getByText('Expense Currency Notice')).toBeDefined();
      expect(screen.getByText('Expense Details & Accounting Classification')).toBeDefined();
    });

    it('renders legacy expense edit when Bento is disabled', async () => {
      mockUseBento = false;
      render(<EditExpensePage params={Promise.resolve({ id: 'exp-1' })} />);
      expect(await screen.findByRole('heading', { level: 1, name: 'Edit Expense' })).toBeDefined();
      expect(await screen.findByRole('button', { name: 'Save Changes' })).toBeDefined();
    });

    it('renders Bento expense edit view when Bento is enabled', async () => {
      mockUseBento = true;
      render(<EditExpensePage params={Promise.resolve({ id: 'exp-1' })} />);
      expect(await screen.findByText('Expense Currency Notice')).toBeDefined();
      expect(
        (await screen.findAllByRole('button', { name: /Save Changes/i })).length
      ).toBeGreaterThan(0);
    });
  });

  describe('Invoice Detail Payment Recording', () => {
    it('shows Record Payment action in Bento Invoice Record view when permitted', () => {
      const invoiceData = {
        id: 'inv-1',
        organizationId: 'org-1',
        number: 'INV-2026-0001',
        title: 'Platform Maintenance',
        status: 'sent',
        currency: 'USD',
        dueDate: '2026-12-01',
        subtotal: '1000.00',
        tax: '0.00',
        total: '1000.00',
        notes: null,
        clientId: 'cnt-1',
        client: { firstName: 'Jane', lastName: 'Doe' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: 'item-1',
            invoiceId: 'inv-1',
            description: 'Platform Maintenance',
            quantity: '1',
            unitPrice: '1000.00',
            taxRate: '0',
            amount: '1000.00',
          },
        ],
        payments: [],
      };

      render(
        <BentoInvoiceRecordView
          invoice={invoiceData as unknown as InvoiceResponse}
          canUpdate={true}
          isEditable={true}
        />
      );

      expect(screen.getByRole('button', { name: /Record Payment/i })).toBeDefined();
    });
  });
});
