import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { BentoExpensesView } from '@/components/finance/bento-expenses-view';
import { BentoExpenseRecordView } from '@/components/finance/bento-expense-record-view';
import { BentoFinancialReportsView } from '@/components/finance/bento-financial-reports-view';
import type { ExpenseResponse } from '@/lib/services/crm/expense-service';
import type { DashboardMetrics } from '@/lib/services/dashboard/dashboard-service';

vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: vi.fn(() => true),
}));

const mockExpenses: ExpenseResponse[] = [
  {
    id: 'exp-1',
    organizationId: 'org-test',
    projectId: 'proj-12345678',
    category: 'Travel & Lodging',
    amount: '450.00',
    expenseDate: new Date('2026-11-01'),
    receiptUrl: 'https://example.com/receipt-1.pdf',
    billable: true,
    createdAt: new Date('2026-11-01'),
  },
  {
    id: 'exp-2',
    organizationId: 'org-test',
    projectId: null,
    category: 'Software Subscriptions',
    amount: '120.00',
    expenseDate: new Date('2026-11-05'),
    receiptUrl: null,
    billable: false,
    createdAt: new Date('2026-11-05'),
  },
];

const mockMetrics: DashboardMetrics = {
  headline: {
    currency: 'USD',
    invoicedMinor: 1000000,
    collectedMinor: 750000,
    outstandingMinor: 250000,
    overdueMinor: 50000,
  },
  otherCurrencies: [
    {
      currency: 'EUR',
      invoicedMinor: 500000,
      collectedMinor: 500000,
      outstandingMinor: 0,
      overdueMinor: 0,
    },
  ],
  invoiceCount: 15,
  issuedInvoiceCount: 12,
  defaultCurrency: 'USD',
};

const mockStatuses = [
  { status: 'paid', currency: 'USD', count: 8, totalMinor: 750000 },
  { status: 'sent', currency: 'USD', count: 3, totalMinor: 200000 },
  { status: 'overdue', currency: 'USD', count: 1, totalMinor: 50000 },
];

const mockEstimates = [
  { status: 'accepted', total: '15000.00', currency: 'USD' },
  { status: 'sent', total: '5000.00', currency: 'USD' },
];

describe('Bento Phase 5B Integration: Finance Expenses & Financial Reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders BentoExpensesView with StatStrip metrics and expense register', () => {
    render(
      <BentoExpensesView
        expenses={mockExpenses}
        currency="USD"
        categories={['Travel & Lodging', 'Software Subscriptions']}
        summary={{
          count: 2,
          totalAmount: '570.00',
          billableAmount: '450.00',
        }}
        pagination={{
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        }}
        filters={{
          q: '',
          category: '',
          billable: '',
          from: '',
          to: '',
          sort: 'date_desc',
          page: '1',
          pageSize: '20',
        }}
        isFiltered={false}
      />
    );

    // Assert StatStrip metric labels
    expect(screen.getByText('Total Expenses')).toBeInTheDocument();
    expect(screen.getByText('Billable Expenses')).toBeInTheDocument();
    expect(screen.getByText('Internal Expenses')).toBeInTheDocument();

    // Assert row presence via getAllByText
    expect(screen.getAllByText('Travel & Lodging').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Software Subscriptions').length).toBeGreaterThan(0);
  });

  it('allows clicking an expense row to inspect details in the Expense Inspector', () => {
    render(
      <BentoExpensesView
        expenses={mockExpenses}
        currency="USD"
        categories={['Travel & Lodging', 'Software Subscriptions']}
        summary={{
          count: 2,
          totalAmount: '570.00',
          billableAmount: '450.00',
        }}
        pagination={{
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        }}
        filters={{
          q: '',
          category: '',
          billable: '',
          from: '',
          to: '',
          sort: 'date_desc',
          page: '1',
          pageSize: '20',
        }}
        isFiltered={false}
      />
    );

    const rows = screen.getAllByRole('button');
    const softwareRow = rows.find((r) => r.textContent?.includes('Software Subscriptions'));
    expect(softwareRow).toBeDefined();
    if (softwareRow) {
      fireEvent.click(softwareRow);
    }

    expect(screen.getByText('Expense Inspector')).toBeInTheDocument();
  });

  it('renders BentoExpenseRecordView with commercial details and receipt link', () => {
    render(
      <BentoExpenseRecordView
        expense={{
          ...mockExpenses[0],
          currency: 'USD',
        }}
      />
    );

    expect(screen.getByText('Expense: Travel & Lodging')).toBeInTheDocument();
    expect(screen.getByText('Recorded Amount')).toBeInTheDocument();
    expect(screen.getByText('Attached Document')).toBeInTheDocument();
    expect(screen.getByText('Open Attachment')).toBeInTheDocument();
  });

  it('renders BentoFinancialReportsView with multi-currency matrix and estimates pipeline', () => {
    render(
      <BentoFinancialReportsView
        metrics={mockMetrics}
        statuses={mockStatuses}
        estimates={mockEstimates}
        expenses={[
          { amount: '450.00', billable: true },
          { amount: '120.00', billable: false },
        ]}
      />
    );

    expect(screen.getByText('Financial Reports')).toBeInTheDocument();
    expect(screen.getByText('Multi-Currency Revenue Matrix')).toBeInTheDocument();
    expect(screen.getByText('Commercial Estimates Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Expense Allocation & Operating Costs')).toBeInTheDocument();
  });
});
