import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BentoInvoicesView } from '@/components/finance/bento-invoices-view';
import { BentoInvoiceRecordView } from '@/components/finance/bento-invoice-record-view';
import { BentoEstimatesView } from '@/components/finance/bento-estimates-view';
import { BentoEstimateRecordView } from '@/components/finance/bento-estimate-record-view';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';

const MOCK_INVOICES: InvoiceResponse[] = [
  {
    id: 'inv-1',
    organizationId: 'org-1',
    number: 'INV-001',
    clientId: 'cli-1',
    projectId: null,
    project: null,
    title: 'Cloud Transformation Q4',
    status: 'sent',
    subtotal: '20000.00',
    tax: '2000.00',
    total: '22000.00',
    currency: 'USD',
    dueDate: new Date('2026-11-30T00:00:00.000Z'),
    notes: 'Payment terms net 30',
    deletedAt: null,
    createdBy: 'usr-1',
    updatedBy: null,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    creator: { id: 'usr-1', name: 'John Doe', email: 'john@agency.com' },
    updater: null,
    client: { id: 'cli-1', firstName: 'Alice', lastName: 'Smith' },
    items: [
      {
        id: 'item-1',
        invoiceId: 'inv-1',
        description: 'Cloud Infrastructure Setup',
        quantity: '1',
        unitPrice: '20000.00',
        taxRate: '10',
        amount: '22000.00',
        createdAt: new Date(),
      },
    ],
    payments: [],
  },
  {
    id: 'inv-2',
    organizationId: 'org-1',
    number: 'INV-002',
    clientId: 'cli-2',
    projectId: null,
    project: null,
    title: 'Brand Refresh Retainer',
    status: 'paid',
    subtotal: '5000.00',
    tax: '0.00',
    total: '5000.00',
    currency: 'USD',
    dueDate: new Date('2026-11-10T00:00:00.000Z'),
    notes: null,
    deletedAt: null,
    createdBy: 'usr-1',
    updatedBy: null,
    createdAt: new Date('2026-11-02T10:00:00.000Z'),
    updatedAt: new Date('2026-11-05T10:00:00.000Z'),
    creator: { id: 'usr-1', name: 'John Doe', email: 'john@agency.com' },
    updater: null,
    client: { id: 'cli-2', firstName: 'Bob', lastName: 'Jones' },
    items: [
      {
        id: 'item-2',
        invoiceId: 'inv-2',
        description: 'Monthly Design Retainer',
        quantity: '1',
        unitPrice: '5000.00',
        taxRate: '0',
        amount: '5000.00',
        createdAt: new Date(),
      },
    ],
    payments: [
      {
        id: 'pay-1',
        invoiceId: 'inv-2',
        amount: '5000.00',
        method: 'wire',
        reference: 'WIRE-9921',
        paidAt: new Date('2026-11-05T10:00:00.000Z'),
        recordedBy: 'John Doe',
        createdAt: new Date('2026-11-05T10:00:00.000Z'),
      },
    ],
  },
];

const MOCK_ESTIMATES: EstimateResponse[] = [
  {
    id: 'est-1',
    organizationId: 'org-1',
    number: 'EST-001',
    clientId: 'cli-1',
    client: { id: 'cli-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@client.com' },
    status: 'sent',
    total: '15000.00',
    currency: 'USD',
    validUntil: new Date('2026-12-01T00:00:00.000Z'),
    notes: 'Preliminary scope for architecture audit',
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
  },
  {
    id: 'est-2',
    organizationId: 'org-1',
    number: 'EST-002',
    clientId: 'cli-2',
    client: { id: 'cli-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@client.com' },
    status: 'accepted',
    total: '8500.00',
    currency: 'USD',
    validUntil: null,
    notes: 'Accepted by client via email',
    createdAt: new Date('2026-11-02T10:00:00.000Z'),
    updatedAt: new Date('2026-11-04T10:00:00.000Z'),
  },
];

describe('Bento Phase 5A Integration: Invoices Directory', () => {
  it('renders invoices register, StatStrip metrics, and formatted totals', () => {
    render(
      <BentoInvoicesView
        invoices={MOCK_INVOICES}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        sortBy="createdAt"
        sortOrder="desc"
        onSearchChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onProjectFilterChange={vi.fn()}
      />
    );

    expect(screen.getByText('Invoices')).toBeDefined();
    expect(screen.getAllByText('Cloud Transformation Q4').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Brand Refresh Retainer')).toBeDefined();
    expect(screen.getByText('Outstanding Debt')).toBeDefined();
    expect(screen.getByText('Collected Volume')).toBeDefined();
  });

  it('triggers search handler when query submitted', () => {
    const onSearchChange = vi.fn();
    render(
      <BentoInvoicesView
        invoices={MOCK_INVOICES}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        sortBy="createdAt"
        sortOrder="desc"
        onSearchChange={onSearchChange}
        onStatusFilterChange={vi.fn()}
        onProjectFilterChange={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText(/Search invoices by number/i);
    fireEvent.change(input, { target: { value: 'Retainer' } });
    fireEvent.submit(input.closest('form')!);

    expect(onSearchChange).toHaveBeenCalledWith('Retainer');
  });
});

describe('Bento Phase 5A Integration: Invoice Record View', () => {
  it('renders line items, payment history, and reconciliation balance', () => {
    render(
      <BentoInvoiceRecordView invoice={MOCK_INVOICES[1]} canUpdate={false} isEditable={false} />
    );

    expect(screen.getAllByText('Brand Refresh Retainer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Monthly Design Retainer')).toBeDefined();
    expect(screen.getByText('WIRE-9921')).toBeDefined();
    expect(screen.getByText('Paid in Full')).toBeDefined();
  });
});

describe('Bento Phase 5A Integration: Estimates Directory', () => {
  it('renders estimates register and status filters', () => {
    render(<BentoEstimatesView estimates={MOCK_ESTIMATES} />);

    expect(screen.getByText('Estimates')).toBeDefined();
    expect(screen.getAllByText('#EST-001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('#EST-002')).toBeDefined();
    expect(screen.getByText('Total Pipeline')).toBeDefined();
    expect(screen.getByText('Accepted Volume')).toBeDefined();
  });

  it('filters estimates using status pills', () => {
    render(<BentoEstimatesView estimates={MOCK_ESTIMATES} />);

    const acceptedTab = screen.getByRole('tab', { name: 'Accepted' });
    fireEvent.click(acceptedTab);

    expect(screen.getAllByText('#EST-002').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('#EST-001')).toBeNull();
  });
});

describe('Bento Phase 5A Integration: Estimate Record View', () => {
  it('renders estimate valuation, notes, and actions bar', () => {
    render(
      <BentoEstimateRecordView
        estimate={MOCK_ESTIMATES[1]}
        clientName="Bob Jones"
        actionsNode={<button type="button">Action</button>}
      />
    );

    expect(screen.getAllByText('Estimate #EST-002').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Bob Jones')).toBeDefined();
    expect(screen.getByText('Convert to Invoice')).toBeDefined();
  });
});
