import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BentoProposalsView, type ProposalItem } from '@/components/sales/bento-proposals-view';
import {
  BentoProposalRecordView,
  type ProposalDetailData,
} from '@/components/sales/bento-proposal-record-view';
import { BentoQuotationsView, type QuotationItem } from '@/components/sales/bento-quotations-view';
import {
  BentoQuotationRecordView,
  type QuotationDetailData,
} from '@/components/sales/bento-quotation-record-view';

const mockProposals: ProposalItem[] = [
  {
    id: 'prop-1',
    organizationId: 'org-test',
    number: 'PROP-001',
    title: 'Enterprise Architecture Modernization',
    status: 'sent',
    subtotal: 70000,
    tax: 5000.5,
    total: 75000.5,
    currency: 'USD',
    validUntil: '2026-12-31T00:00:00.000Z',
    notes: 'Includes cloud infrastructure and automated CI/CD pipeline setup',
    opportunityId: 'opp-1',
    contactId: 'contact-1',
    opportunity: { id: 'opp-1', title: 'Cloud Transformation Deal' },
    contact: { id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@acme.com' },
    creator: { id: 'user-1', name: 'Jane Admin' },
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-05T12:00:00.000Z',
  },
  {
    id: 'prop-2',
    organizationId: 'org-test',
    number: 'PROP-002',
    title: 'Brand Strategy Redesign',
    status: 'accepted',
    subtotal: 20000,
    tax: 2000,
    total: 22000,
    currency: 'USD',
    validUntil: null,
    notes: null,
    opportunityId: null,
    contactId: null,
    opportunity: null,
    contact: null,
    creator: null,
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-11-02T12:00:00.000Z',
  },
];

const mockQuotations: QuotationItem[] = [
  {
    id: 'quot-1',
    organizationId: 'org-test',
    number: 'QUOT-001',
    title: 'Infrastructure Maintenance Retainer',
    status: 'draft',
    subtotal: 10000,
    tax: 1000,
    total: 11000,
    currency: 'USD',
    validUntil: '2026-12-15T00:00:00.000Z',
    notes: 'Monthly monitoring and emergency patch support',
    opportunityId: 'opp-1',
    contactId: 'contact-1',
    opportunity: { id: 'opp-1', title: 'Cloud Transformation Deal' },
    contact: { id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@acme.com' },
    creator: { id: 'user-1', name: 'Jane Admin' },
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-04T12:00:00.000Z',
  },
];

describe('Bento Sales Phase 4A Integration: Proposals Directory', () => {
  it('renders proposals register, StatStrip metrics, and formatted totals', () => {
    const onSearchChange = vi.fn();
    const onStatusFilterChange = vi.fn();

    render(
      <BentoProposalsView
        proposals={mockProposals}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={onSearchChange}
        onStatusFilterChange={onStatusFilterChange}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Proposals' })).toBeDefined();
    expect(
      screen.getAllByText('Enterprise Architecture Modernization').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Brand Strategy Redesign').length).toBeGreaterThanOrEqual(1);

    // Formatted currency
    expect(screen.getAllByText(/USD 75,000.50/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/USD 22,000.00/i).length).toBeGreaterThanOrEqual(1);

    // StatStrip aggregated volume
    expect(screen.getByText('Register Value')).toBeDefined();
  });

  it('selects active proposal and reveals right rail detail', () => {
    render(
      <BentoProposalsView
        proposals={mockProposals}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
      />
    );

    // Initial selection is first item
    expect(screen.getAllByText('#PROP-001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cloud Transformation Deal').length).toBeGreaterThanOrEqual(1);

    // Click second item
    fireEvent.click(screen.getAllByText('Brand Strategy Redesign')[0]);
    expect(screen.getAllByText('#PROP-002').length).toBeGreaterThanOrEqual(1);
  });

  it('handles search input submissions', () => {
    const onSearchChange = vi.fn();
    render(
      <BentoProposalsView
        proposals={mockProposals}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={onSearchChange}
        onStatusFilterChange={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText(/Search proposals by title/i);
    fireEvent.change(input, { target: { value: 'Architecture' } });
    fireEvent.submit(input.closest('form')!);

    expect(onSearchChange).toHaveBeenCalledWith('Architecture');
  });

  it('displays multi-currency indicator if proposals have different currencies', () => {
    const mixedProps: ProposalItem[] = [
      { ...mockProposals[0], currency: 'USD', total: 50000 },
      { ...mockProposals[1], currency: 'EUR', total: 40000 },
    ];

    render(
      <BentoProposalsView
        proposals={mixedProps}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
      />
    );

    expect(screen.getByText('2 currencies')).toBeDefined();
    expect(screen.getByText('multiple currencies')).toBeDefined();
  });

  it('renders expired filter button and triggers onStatusFilterChange', () => {
    const onStatusFilterChange = vi.fn();
    render(
      <BentoProposalsView
        proposals={mockProposals}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={vi.fn()}
        onStatusFilterChange={onStatusFilterChange}
      />
    );

    const expiredFilterBtn = screen.getByRole('button', { name: 'Expired' });
    fireEvent.click(expiredFilterBtn);
    expect(onStatusFilterChange).toHaveBeenCalledWith('expired');
  });
});

describe('Bento Sales Phase 4A Integration: Proposal Record View', () => {
  it('renders proposal line items, financial totals, and document operations', () => {
    const detailData: ProposalDetailData = {
      ...mockProposals[0],
      updater: null,
      items: [
        {
          id: 'item-1',
          description: 'Cloud Migration Engineering Hours',
          quantity: 100,
          unitPrice: 700,
          taxRate: 7.14,
          amount: 70000,
          sortOrder: 1,
        },
      ],
    };

    render(
      <BentoProposalRecordView
        proposal={detailData}
        versions={[
          {
            id: 'v-1',
            organizationId: 'org-test',
            proposalId: 'prop-1',
            version: 1,
            title: 'Initial Scope',
            status: 'draft',
            subtotal: '70000',
            tax: '5000.50',
            total: '75000.50',
            currency: 'USD',
            notes: 'Initial snapshot',
            createdAt: new Date('2026-11-01T12:00:00.000Z'),
            createdBy: 'user-1',
          },
        ]}
      />
    );

    expect(screen.getByText('Enterprise Architecture Modernization')).toBeDefined();
    expect(screen.getByText('Cloud Migration Engineering Hours')).toBeDefined();
    expect(screen.getAllByText(/USD 75,000.50/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Version 1')).toBeDefined();
    expect(screen.getByText('Edit in Builder')).toBeDefined();
  });
});

describe('Bento Sales Phase 4A Integration: Quotations Directory & Record', () => {
  it('renders quotations directory with active stats and items', () => {
    render(
      <BentoQuotationsView
        quotations={mockQuotations}
        total={1}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Quotations' })).toBeDefined();
    expect(
      screen.getAllByText('Infrastructure Maintenance Retainer').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/USD 11,000.00/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders quotation record view with line items and subtotal breakdown', () => {
    const detailData: QuotationDetailData = {
      ...mockQuotations[0],
      updater: null,
      items: [
        {
          id: 'qitem-1',
          description: 'Dedicated Engineer SLA 24/7',
          quantity: 1,
          unitPrice: 10000,
          taxRate: 10,
          amount: 10000,
          sortOrder: 1,
        },
      ],
    };

    render(<BentoQuotationRecordView quotation={detailData} />);

    expect(screen.getByText('Infrastructure Maintenance Retainer')).toBeDefined();
    expect(screen.getByText('Dedicated Engineer SLA 24/7')).toBeDefined();
    expect(screen.getAllByText(/USD 11,000.00/i).length).toBeGreaterThanOrEqual(1);
  });
});
