import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BentoLeadsView, type LeadItem } from '@/components/crm/bento-leads-view';
import {
  BentoLeadRecordView,
  type LeadDetailRecord,
} from '@/components/crm/bento-lead-record-view';
import { LeadsClient } from '@/app/crm/leads/leads-client';
import { LeadDetailClient } from '@/app/crm/leads/[id]/lead-detail-client';
import { BentoShellProvider } from '@/components/providers/bento-theme-provider';

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

const mockLeads: LeadItem[] = [
  {
    id: 'lead-1',
    organizationId: 'org-1',
    source: 'website',
    status: 'new',
    priority: 'high',
    expectedValue: '25000',
    contactId: 'con-1',
    accountId: 'acc-1',
    ownerId: 'usr-1',
    pipelineId: null,
    stageId: null,
    notes: 'Inquired about enterprise package.',
    contact: { id: 'con-1', firstName: 'Alice', lastName: 'Walker' },
    account: { id: 'acc-1', name: 'Acme Ventures' },
    convertedOpportunity: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-02T00:00:00Z'),
    deletedAt: null,
  },
  {
    id: 'lead-2',
    organizationId: 'org-1',
    source: 'referral',
    status: 'qualified',
    priority: 'medium',
    expectedValue: '10000',
    contactId: null,
    accountId: null,
    ownerId: null,
    pipelineId: null,
    stageId: null,
    notes: null,
    contact: null,
    account: null,
    convertedOpportunity: null,
    createdAt: new Date('2026-03-05T00:00:00Z'),
    updatedAt: new Date('2026-03-06T00:00:00Z'),
    deletedAt: null,
  },
];

const mockDetailLead: LeadDetailRecord = {
  id: 'lead-1',
  organizationId: 'org-1',
  source: 'website',
  status: 'new',
  priority: 'high',
  expectedValue: '25000',
  contactId: 'con-1',
  accountId: 'acc-1',
  ownerId: 'usr-1',
  pipelineId: null,
  stageId: null,
  notes: 'Inquired about enterprise package.',
  contact: { id: 'con-1', firstName: 'Alice', lastName: 'Walker' },
  account: { id: 'acc-1', name: 'Acme Ventures' },
  convertedOpportunity: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  updatedAt: new Date('2026-03-02T00:00:00Z'),
  deletedAt: null,
};

describe('Bento Leads Integration Suite (Phase 3C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BentoLeadsView Component', () => {
    it('renders leads list with count and initials badges', () => {
      render(
        <BentoLeadsView
          leads={mockLeads}
          total={2}
          totalPages={1}
          page={1}
          searchVal=""
          statusFilter=""
          priorityFilter=""
          onSearchChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onPriorityFilterChange={vi.fn()}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Leads' })).toBeInTheDocument();
      expect(screen.getByText('2 leads in your organization workspace')).toBeInTheDocument();

      // Check lead row renders
      expect(screen.getAllByText('Alice Walker').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Acme Ventures').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Unassigned Person')).toBeInTheDocument();
    });

    it('updates selected lead in the detail rail when row is clicked', () => {
      render(
        <BentoLeadsView
          leads={mockLeads}
          total={2}
          totalPages={1}
          page={1}
          searchVal=""
          statusFilter=""
          priorityFilter=""
          onSearchChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onPriorityFilterChange={vi.fn()}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      // Default selected is first lead (Alice Walker)
      expect(screen.getByRole('heading', { level: 2, name: 'Alice Walker' })).toBeInTheDocument();

      // Click second lead row
      const secondRow = screen.getByRole('row', { name: /referral lead/i });
      fireEvent.click(secondRow);

      expect(screen.getByRole('heading', { level: 2, name: 'Lead #lead-2' })).toBeInTheDocument();
    });

    it('dispatches search and filter callbacks', () => {
      const handleSearch = vi.fn();
      const handleStatus = vi.fn();
      const handlePriority = vi.fn();

      render(
        <BentoLeadsView
          leads={mockLeads}
          total={2}
          totalPages={1}
          page={1}
          searchVal=""
          statusFilter=""
          priorityFilter=""
          onSearchChange={handleSearch}
          onStatusFilterChange={handleStatus}
          onPriorityFilterChange={handlePriority}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      const searchInput = screen.getByLabelText('Search leads');
      fireEvent.change(searchInput, { target: { value: 'website' } });
      fireEvent.submit(searchInput.closest('form')!);
      expect(handleSearch).toHaveBeenCalledWith('website');

      const statusSelect = screen.getByLabelText('Filter by status');
      fireEvent.change(statusSelect, { target: { value: 'qualified' } });
      expect(handleStatus).toHaveBeenCalledWith('qualified');

      const prioritySelect = screen.getByLabelText('Filter by priority');
      fireEvent.change(prioritySelect, { target: { value: 'high' } });
      expect(handlePriority).toHaveBeenCalledWith('high');
    });

    it('renders empty state when leads list is empty', () => {
      render(
        <BentoLeadsView
          leads={[]}
          total={0}
          totalPages={0}
          page={1}
          searchVal="Unknown"
          statusFilter=""
          priorityFilter=""
          onSearchChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onPriorityFilterChange={vi.fn()}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      expect(screen.getByText('No leads match those filters')).toBeInTheDocument();
    });
  });

  describe('BentoLeadRecordView Component', () => {
    it('renders lead classification, stat strip, and related links', () => {
      render(
        <BentoLeadRecordView lead={mockDetailLead} onDeleteRequest={vi.fn()} deleting={false} />
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Alice Walker' })).toBeInTheDocument();
      expect(screen.getAllByText('$25,000').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('website').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Inquired about enterprise package.')).toBeInTheDocument();
      expect(
        screen.getAllByRole('link', { name: /Convert to Opportunity/i }).length
      ).toBeGreaterThanOrEqual(1);
    });

    it('renders soft-deleted banner and omits edit/convert buttons when deletedAt is present', () => {
      const deletedLead: LeadDetailRecord = {
        ...mockDetailLead,
        deletedAt: new Date('2026-04-01T12:00:00Z'),
      };

      render(<BentoLeadRecordView lead={deletedLead} onDeleteRequest={vi.fn()} deleting={false} />);

      expect(screen.getByText('This lead has been deleted')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Edit/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /Convert to Opportunity/i })
      ).not.toBeInTheDocument();
    });

    it('renders converted banner and opportunity link when converted', () => {
      const convertedLead: LeadDetailRecord = {
        ...mockDetailLead,
        status: 'converted',
        convertedOpportunity: {
          id: 'opp-101',
          title: 'Acme Enterprise Deal',
          status: 'open',
          value: '25000',
          currency: 'USD',
          createdAt: new Date(),
        },
      };

      render(
        <BentoLeadRecordView lead={convertedLead} onDeleteRequest={vi.fn()} deleting={false} />
      );

      expect(screen.getByText('Lead successfully converted')).toBeInTheDocument();
      expect(screen.getAllByText('Acme Enterprise Deal').length).toBeGreaterThanOrEqual(1);
      expect(
        screen.queryByRole('link', { name: /Convert to Opportunity/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('Dual-Presentation & Client Controller Parity', () => {
    it('switches between Bento and Legacy directory layout based on isBento flag', () => {
      const { rerender } = render(
        <BentoShellProvider isBento={false}>
          <LeadsClient
            leads={mockLeads}
            total={2}
            totalPages={1}
            page={1}
            searchVal=""
            statusFilter=""
            priorityFilter=""
          />
        </BentoShellProvider>
      );

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Expected Value')).toBeInTheDocument();

      rerender(
        <BentoShellProvider isBento={true}>
          <LeadsClient
            leads={mockLeads}
            total={2}
            totalPages={1}
            page={1}
            searchVal=""
            statusFilter=""
            priorityFilter=""
          />
        </BentoShellProvider>
      );

      expect(screen.getByText('2 leads in your organization workspace')).toBeInTheDocument();
      expect(screen.getByText('Lead Overview')).toBeInTheDocument();
    });

    it('switches between Bento and Legacy detail layout based on isBento flag', () => {
      const { rerender } = render(
        <BentoShellProvider isBento={false}>
          <LeadDetailClient lead={mockDetailLead} />
        </BentoShellProvider>
      );

      expect(screen.getByText('Lead Details')).toBeInTheDocument();

      rerender(
        <BentoShellProvider isBento={true}>
          <LeadDetailClient lead={mockDetailLead} />
        </BentoShellProvider>
      );

      expect(screen.getByText('Triage & Classification')).toBeInTheDocument();
      expect(screen.getByText('Commercial Next Steps')).toBeInTheDocument();
    });

    it('triggers DELETE request when delete button is confirmed', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as unknown as Response)
      );

      render(
        <BentoShellProvider isBento={true}>
          <LeadsClient
            leads={mockLeads}
            total={2}
            totalPages={1}
            page={1}
            searchVal=""
            statusFilter=""
            priorityFilter=""
          />
        </BentoShellProvider>
      );

      const deleteBtn = screen.getByRole('button', { name: /Delete/i });
      fireEvent.click(deleteBtn);

      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('/api/v1/crm/leads/lead-1', {
          method: 'DELETE',
        });
        expect(mockRefresh).toHaveBeenCalled();
      });

      confirmSpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });
});
