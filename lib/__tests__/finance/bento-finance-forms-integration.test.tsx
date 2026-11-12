import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Form and view components
import { NewInvoiceForm } from '@/app/finance/invoices/new/NewInvoiceForm';
import { EditInvoiceForm } from '@/app/finance/invoices/[id]/edit/EditInvoiceForm';
import NewEstimatePage from '@/app/finance/estimates/new/page';
import EditEstimatePage from '@/app/finance/estimates/[id]/edit/page';
import NewExpensePage from '@/app/finance/expenses/new/page';
import EditExpensePage from '@/app/finance/expenses/[id]/edit/page';
import ConvertEstimatePage from '@/app/finance/estimates/[id]/convert/page';
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
      if (typeof url === 'string' && url.includes('/api/v1/finance/estimates/est-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'est-1',
            number: 'EST-2026-0001',
            status: 'draft',
            total: '1500.00',
            currency: 'USD',
            validUntil: '2026-12-31',
            notes: 'Test estimate notes',
          }),
        });
      }
      if (typeof url === 'string' && url.includes('/api/v1/finance/estimates/est-accepted')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'est-accepted',
            number: 'EST-2026-0002',
            status: 'accepted',
            total: '2500.00',
            currency: 'USD',
          }),
        });
      }
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

  describe('Estimate Forms & Conversion', () => {
    it('renders legacy estimate creation when Bento is disabled', () => {
      mockUseBento = false;
      render(<NewEstimatePage />);
      expect(screen.getByRole('heading', { level: 1, name: 'New Estimate' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Create Estimate' })).toBeDefined();
    });

    it('renders Bento estimate creation view when Bento is enabled', () => {
      mockUseBento = true;
      render(<NewEstimatePage />);
      expect(screen.getByRole('heading', { level: 1, name: 'New Cost Estimate' })).toBeDefined();
      expect(screen.getByText('Estimate Details & Prospect Association')).toBeDefined();
      expect(screen.getByText('Estimate Lifecycle & Conversion')).toBeDefined();
    });

    it('renders legacy estimate edit when Bento is disabled', async () => {
      mockUseBento = false;
      render(<EditEstimatePage params={Promise.resolve({ id: 'est-1' })} />);
      expect(await screen.findByRole('heading', { level: 1, name: 'Edit Estimate' })).toBeDefined();
      expect(await screen.findByRole('button', { name: 'Save Changes' })).toBeDefined();
    });

    it('renders Bento estimate edit view when Bento is enabled', async () => {
      mockUseBento = true;
      render(<EditEstimatePage params={Promise.resolve({ id: 'est-1' })} />);
      expect(
        await screen.findByRole('heading', { level: 1, name: /Edit Estimate: EST-2026-0001/i })
      ).toBeDefined();
      expect(
        (await screen.findAllByRole('button', { name: /Save Changes/i })).length
      ).toBeGreaterThan(0);
    });

    it('renders legacy estimate conversion when Bento is disabled', async () => {
      mockUseBento = false;
      render(<ConvertEstimatePage params={Promise.resolve({ id: 'est-accepted' })} />);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Convert to Invoice' })
      ).toBeDefined();
      expect(await screen.findByRole('button', { name: 'Convert to Invoice' })).toBeDefined();
    });

    it('renders Bento estimate conversion view when Bento is enabled', async () => {
      mockUseBento = true;
      render(<ConvertEstimatePage params={Promise.resolve({ id: 'est-accepted' })} />);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Convert Estimate to Invoice' })
      ).toBeDefined();
      expect(await screen.findByText('Transaction Guarantees')).toBeDefined();
      expect(await screen.findByRole('button', { name: /Convert to Invoice/i })).toBeDefined();
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
