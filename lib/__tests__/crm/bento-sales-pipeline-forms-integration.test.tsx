import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/crm',
  useSearchParams: () => new URLSearchParams({ pipelineId: 'pipe-1' }),
}));

// Mock bento theme provider
let mockUseBento = true;
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBento,
  BentoThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CreateOpportunityPage from '@/app/crm/opportunities/new/page';
import { EditOpportunityForm } from '@/app/crm/opportunities/[id]/edit/EditOpportunityForm';
import { ConvertForm } from '@/app/crm/leads/[id]/convert/ConvertForm';
import CreatePipelinePage from '@/app/crm/pipelines/new/page';
import { EditPipelineForm } from '@/app/crm/pipelines/[id]/edit/EditPipelineForm';
import CreatePipelineStagePage from '@/app/crm/pipeline-stages/new/page';
import { EditPipelineStageForm } from '@/app/crm/pipeline-stages/[id]/edit/EditPipelineStageForm';

describe('Bento Sales & Pipeline Forms Integration (Phase 10E)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBento = true;
  });

  describe('Opportunity Create & Edit Forms', () => {
    const mockOpportunity = {
      id: 'opp-1',
      title: 'Enterprise ERP Implementation',
      description: 'Full stack enterprise transformation',
      value: '150000.00',
      currency: 'USD',
      closeDate: new Date('2026-12-15'),
      ownerId: 'usr-1',
      status: 'open',
      probability: '75',
      lossReason: null,
      contactId: 'ct-1',
      accountId: 'acc-1',
      leadId: 'ld-1',
      pipelineId: 'pipe-1',
      stageId: 'stg-1',
    };

    it('renders legacy new opportunity form when Bento is disabled', () => {
      mockUseBento = false;
      render(<CreateOpportunityPage />);

      expect(
        screen.getByRole('heading', { level: 3, name: 'New Opportunity' })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create Opportunity' })).toBeInTheDocument();
    });

    it('renders Bento new opportunity view when Bento is enabled', () => {
      mockUseBento = true;
      render(<CreateOpportunityPage />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'New Sales Opportunity' })
      ).toBeInTheDocument();
      expect(screen.getByText('Opportunity Specifications')).toBeInTheDocument();
      expect(screen.getByText('Pipeline & Relational Scope')).toBeInTheDocument();
    });

    it('renders legacy edit opportunity form when Bento is disabled', () => {
      mockUseBento = false;
      render(<EditOpportunityForm opportunity={mockOpportunity} />);

      expect(
        screen.getByRole('heading', { level: 3, name: 'Edit Opportunity' })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Opportunity' })).toBeInTheDocument();
    });

    it('renders Bento edit opportunity view when Bento is enabled', () => {
      mockUseBento = true;
      render(<EditOpportunityForm opportunity={mockOpportunity} />);

      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /Edit Opportunity: Enterprise ERP Implementation/i,
        })
      ).toBeInTheDocument();
      expect(screen.getByText('Opportunity Specifications')).toBeInTheDocument();
    });
  });

  describe('Lead-to-Opportunity Conversion Flow', () => {
    const mockLead = {
      id: 'lead-123456',
      source: 'Website Contact',
      status: 'qualified',
      expectedValue: '25000.00',
      contactId: 'ct-1',
      accountId: 'acc-1',
      ownerId: 'usr-1',
      pipelineId: 'pipe-1',
      stageId: 'stg-1',
      convertedOpportunity: null,
    };

    it('renders legacy conversion form when Bento is disabled', () => {
      mockUseBento = false;
      render(<ConvertForm leadId="lead-123456" lead={mockLead} />);

      expect(
        screen.getByRole('heading', { level: 3, name: 'Convert to Opportunity' })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Convert to Opportunity' })).toBeInTheDocument();
    });

    it('renders Bento conversion view when Bento is enabled', () => {
      mockUseBento = true;
      render(<ConvertForm leadId="lead-123456" lead={mockLead} />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Convert Lead to Opportunity' })
      ).toBeInTheDocument();
      expect(screen.getByText('New Opportunity Specifications')).toBeInTheDocument();
      expect(screen.getByText('Originating Lead')).toBeInTheDocument();
    });

    it('renders Bento already-converted view if lead was previously converted', () => {
      mockUseBento = true;
      const convertedLead = {
        ...mockLead,
        convertedOpportunity: {
          id: 'opp-99',
          title: 'Existing Converted Deal',
          status: 'won',
          value: '50000.00',
          currency: 'USD',
        },
      };
      render(<ConvertForm leadId="lead-123456" lead={convertedLead} />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Lead Already Converted' })
      ).toBeInTheDocument();
      expect(screen.getByText('Converted Opportunity Details')).toBeInTheDocument();
    });
  });

  describe('Pipeline & Stage Create / Edit Forms', () => {
    const mockPipeline = {
      id: 'pipe-1',
      name: 'Inbound Sales',
      description: 'Deals originating from inbound inquiries',
      isDefault: true,
    };

    const mockStage = {
      id: 'stg-1',
      pipelineId: 'pipe-1',
      name: 'Solution Pitch',
      order: 2,
      color: '#10b981',
      probability: 60,
      isWon: false,
      isLost: false,
    };

    it('renders legacy and Bento pipeline creation forms', () => {
      mockUseBento = false;
      const { unmount } = render(<CreatePipelinePage />);
      expect(screen.getByRole('heading', { level: 3, name: 'New Pipeline' })).toBeInTheDocument();
      unmount();

      mockUseBento = true;
      render(<CreatePipelinePage />);
      expect(
        screen.getByRole('heading', { level: 1, name: 'New Sales Pipeline' })
      ).toBeInTheDocument();
      expect(screen.getByText('Pipeline Parameters')).toBeInTheDocument();
    });

    it('renders legacy and Bento pipeline edit forms', () => {
      mockUseBento = false;
      const { unmount } = render(<EditPipelineForm pipeline={mockPipeline} />);
      expect(screen.getByRole('heading', { level: 3, name: 'Edit Pipeline' })).toBeInTheDocument();
      unmount();

      mockUseBento = true;
      render(<EditPipelineForm pipeline={mockPipeline} />);
      expect(
        screen.getByRole('heading', { level: 1, name: /Edit Pipeline: Inbound Sales/i })
      ).toBeInTheDocument();
    });

    it('renders legacy and Bento stage creation forms', () => {
      mockUseBento = false;
      const { unmount } = render(<CreatePipelineStagePage />);
      expect(screen.getByRole('heading', { level: 3, name: 'New Stage' })).toBeInTheDocument();
      unmount();

      mockUseBento = true;
      render(<CreatePipelineStagePage />);
      expect(
        screen.getByRole('heading', { level: 1, name: 'New Pipeline Stage' })
      ).toBeInTheDocument();
      expect(screen.getByText('Stage Specifications')).toBeInTheDocument();
    });

    it('renders legacy and Bento stage edit forms', () => {
      mockUseBento = false;
      const { unmount } = render(<EditPipelineStageForm stage={mockStage} />);
      expect(screen.getByRole('heading', { level: 3, name: 'Edit Stage' })).toBeInTheDocument();
      unmount();

      mockUseBento = true;
      render(<EditPipelineStageForm stage={mockStage} />);
      expect(
        screen.getByRole('heading', { level: 1, name: /Edit Stage: Solution Pitch/i })
      ).toBeInTheDocument();
    });
  });
});
