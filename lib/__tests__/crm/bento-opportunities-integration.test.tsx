import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  BentoOpportunitiesView,
  type OpportunityItem,
} from '@/components/crm/bento-opportunities-view';
import {
  BentoOpportunityRecordView,
  type OpportunityDetailRecord,
} from '@/components/crm/bento-opportunity-record-view';
import { BentoPipelinesView, type PipelineItem } from '@/components/crm/bento-pipelines-view';
import {
  BentoPipelineStagesView,
  type PipelineStageItem,
} from '@/components/crm/bento-pipeline-stages-view';

const mockOpportunities: OpportunityItem[] = [
  {
    id: 'opp-1',
    organizationId: 'org-test',
    title: 'Enterprise Cloud Migration',
    description: 'Full stack enterprise transformation deal',
    value: '75000.50',
    currency: 'USD',
    closeDate: '2026-12-15T00:00:00.000Z',
    ownerId: 'user-1',
    status: 'open',
    probability: '60',
    lossReason: null,
    pipelineId: 'pipe-1',
    stageId: 'stage-1',
    contactId: 'contact-1',
    accountId: 'acc-1',
    leadId: 'lead-1',
    contact: { id: 'contact-1', firstName: 'John', lastName: 'Doe' },
    account: { id: 'acc-1', name: 'Acme Global Corp' },
    lead: { id: 'lead-1', source: 'website', status: 'converted' },
    pipeline: { id: 'pipe-1', name: 'Enterprise Sales' },
    stage: { id: 'stage-1', name: 'Proposal Review', isWon: false, isLost: false },
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-05T12:00:00.000Z',
    deletedAt: null,
  },
  {
    id: 'opp-2',
    organizationId: 'org-test',
    title: 'Brand Refresh Strategy',
    description: 'Corporate brand overhaul and digital presence',
    value: '25000.00',
    currency: 'USD',
    closeDate: null,
    ownerId: null,
    status: 'won',
    probability: '100',
    lossReason: null,
    pipelineId: 'pipe-1',
    stageId: 'stage-won',
    contactId: null,
    accountId: 'acc-2',
    leadId: null,
    contact: null,
    account: { id: 'acc-2', name: 'TechStart Inc' },
    lead: null,
    pipeline: { id: 'pipe-1', name: 'Enterprise Sales' },
    stage: { id: 'stage-won', name: 'Closed Won', isWon: true, isLost: false },
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-11-02T12:00:00.000Z',
    deletedAt: null,
  },
];

describe('Bento CRM Phase 3D Integration: Opportunities Directory', () => {
  it('renders opportunity list, StatStrip metrics, and formats Decimal values', () => {
    const onSearchChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onDeleteRequest = vi.fn();

    render(
      <BentoOpportunitiesView
        opportunities={mockOpportunities}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={onSearchChange}
        onStatusFilterChange={onStatusFilterChange}
        onDeleteRequest={onDeleteRequest}
        deletingId={null}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Opportunities' })).toBeDefined();
    expect(screen.getAllByText('Enterprise Cloud Migration').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Brand Refresh Strategy').length).toBeGreaterThanOrEqual(1);

    // Formatted currency and decimal values
    expect(screen.getAllByText(/USD 75,000/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/USD 25,000/i).length).toBeGreaterThanOrEqual(1);

    // StatStrip aggregated metrics
    expect(screen.getByText('Pipeline Value')).toBeDefined();
  });

  it('selects active deal on click and reveals right-hand detail rail with lead link', () => {
    render(
      <BentoOpportunitiesView
        opportunities={mockOpportunities}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        deletingId={null}
      />
    );

    // Initial selected is first item
    expect(screen.getAllByText('Acme Global Corp').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('John Doe')).toBeDefined();

    // Click second item
    fireEvent.click(screen.getAllByText('Brand Refresh Strategy')[0]);
    expect(screen.getAllByText('TechStart Inc').length).toBeGreaterThanOrEqual(1);
  });

  it('submits search filter correctly', () => {
    const onSearchChange = vi.fn();
    render(
      <BentoOpportunitiesView
        opportunities={mockOpportunities}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={onSearchChange}
        onStatusFilterChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        deletingId={null}
      />
    );

    const input = screen.getByPlaceholderText(/Search deals by title/i);
    fireEvent.change(input, { target: { value: 'Migration' } });
    fireEvent.submit(input.closest('form')!);

    expect(onSearchChange).toHaveBeenCalledWith('Migration');
  });
});

describe('Bento CRM Phase 3D Integration: Opportunity Record View', () => {
  it('renders deal financial attributes, linked account, lead, and proposals', () => {
    const opp: OpportunityDetailRecord = {
      ...mockOpportunities[0],
      proposals: [
        {
          id: 'prop-1',
          number: 'PROP-001',
          title: 'Cloud Transformation Scope Document',
          status: 'SENT',
          total: '75000.50',
          currency: 'USD',
        },
      ],
      quotations: [
        {
          id: 'quot-1',
          number: 'QUOT-001',
          title: 'Infrastructure Migration Estimate',
          status: 'ACCEPTED',
          total: '75000.50',
          currency: 'USD',
        },
      ],
    };

    render(
      <BentoOpportunityRecordView opportunity={opp} onDeleteRequest={vi.fn()} deleting={false} />
    );

    expect(screen.getAllByText('Enterprise Cloud Migration').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Proposal Review').length).toBeGreaterThanOrEqual(1);

    // Associated entities
    expect(screen.getAllByText('Acme Global Corp').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('John Doe').length).toBeGreaterThanOrEqual(1);

    // Linked proposals and quotes
    expect(screen.getByText(/Cloud Transformation Scope Document/i)).toBeDefined();
    expect(screen.getByText(/Infrastructure Migration Estimate/i)).toBeDefined();
  });
});

describe('Bento CRM Phase 3D Integration: Pipelines Directory', () => {
  const mockPipelines: PipelineItem[] = [
    {
      id: 'pipe-1',
      organizationId: 'org-test',
      name: 'Standard Inbound Sales',
      description: 'Default qualification and proposal pipeline',
      isDefault: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'pipe-2',
      organizationId: 'org-test',
      name: 'Custom Engagements',
      description: 'High touch enterprise consulting',
      isDefault: false,
      createdAt: '2026-11-03T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z',
      deletedAt: null,
    },
  ];

  it('renders pipeline directory with default indicator and details', () => {
    render(
      <BentoPipelinesView
        pipelines={mockPipelines}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        onSearchChange={vi.fn()}
      />
    );

    expect(screen.getAllByText('Standard Inbound Sales').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Custom Engagements').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Bento CRM Phase 3D Integration: Pipeline Stages Directory', () => {
  const mockStages: PipelineStageItem[] = [
    {
      id: 'stage-1',
      pipelineId: 'pipe-1',
      name: 'Initial Qualification',
      order: 1,
      color: '#3b82f6',
      probability: 10,
      isWon: false,
      isLost: false,
      pipeline: { id: 'pipe-1', name: 'Inbound Sales' },
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'stage-2',
      pipelineId: 'pipe-1',
      name: 'Contract Won',
      order: 2,
      color: '#10b981',
      probability: 100,
      isWon: true,
      isLost: false,
      pipeline: { id: 'pipe-1', name: 'Inbound Sales' },
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      deletedAt: null,
    },
  ];

  it('renders stages list with order badges and stage preview', () => {
    render(
      <BentoPipelineStagesView
        stages={mockStages}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        pipelineIdFilter=""
        onSearchChange={vi.fn()}
        onPipelineFilterChange={vi.fn()}
      />
    );

    expect(screen.getAllByText('Initial Qualification').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Contract Won').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Sequence Order')).toBeDefined();
    expect(screen.getByText('Step 1')).toBeDefined();
  });
});

describe('Bento CRM Phase 3D Integration: Mixed Currency Handling', () => {
  it('displays explicit multi-currency indicator when opportunities have different currencies', () => {
    const mixedOpps: OpportunityItem[] = [
      {
        ...mockOpportunities[0],
        id: 'opp-usd',
        currency: 'USD',
        value: '50000.00',
      },
      {
        ...mockOpportunities[1],
        id: 'opp-eur',
        currency: 'EUR',
        value: '40000.00',
      },
    ];

    render(
      <BentoOpportunitiesView
        opportunities={mixedOpps}
        total={2}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        onSearchChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        deletingId={null}
      />
    );

    expect(screen.getByText('2 currencies')).toBeDefined();
    expect(screen.getByText('multiple currencies')).toBeDefined();
  });
});
