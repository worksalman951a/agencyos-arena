import { describe, it, expect, vi } from 'vitest';
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
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock bento theme provider
const mockUseBentoShell = vi.fn();
vi.mock('@components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBentoShell(),
  BentoThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBentoShell(),
  BentoThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Import client wrappers
import { ProjectFilesClient } from '@/app/projects/[id]/files/project-files-client';
import { ApprovalsClient } from '@/app/projects/approvals/approvals-client';
import { ChangeOrdersClient } from '@/app/projects/change-orders/change-orders-client';
import { TimeEntriesClient } from '@/app/projects/time-entries/time-entries-client';
import { ProjectTemplatesClient } from '@/app/projects/templates/project-templates-client';

describe('Phase 6B: Premium Project Operations Integration Tests', () => {
  describe('Project Files Client & Bento Integration', () => {
    const mockFiles = [
      {
        id: 'file-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        taskId: null,
        fileAssetId: 'asset-1',
        userId: 'user-1',
        createdAt: new Date('2026-03-01'),
        updatedAt: new Date('2026-03-01'),
        fileAsset: {
          id: 'asset-1',
          originalName: 'design-spec.pdf',
          mimeType: 'application/pdf',
          size: 204800,
        },
        task: null,
        user: { id: 'user-1', name: 'Alice Designer', email: 'alice@example.com' },
      },
    ];

    it('renders Bento view when useBentoShell is true', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(
        <ProjectFilesClient
          projectId="proj-1"
          projectName="E-commerce Redesign"
          files={mockFiles}
          tasks={[]}
        />
      );

      expect(screen.getByText('Project Assets & Documents')).toBeInTheDocument();
      expect(screen.getByText('Total Attachments')).toBeInTheDocument();
      expect(screen.getAllByText('design-spec.pdf').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/200.0 KB/).length).toBeGreaterThan(0);
    });

    it('renders legacy table view when useBentoShell is false', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(
        <ProjectFilesClient
          projectId="proj-1"
          projectName="E-commerce Redesign"
          files={mockFiles}
          tasks={[]}
        />
      );

      expect(screen.getByText('Project Files')).toBeInTheDocument();
      expect(screen.getByText('design-spec.pdf')).toBeInTheDocument();
      expect(screen.getByText('application/pdf')).toBeInTheDocument();
    });
  });

  describe('Project Approvals Client & Bento Integration', () => {
    const mockApprovals = [
      {
        id: 'app-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        contactId: 'contact-1',
        approvedBy: null,
        approvedAt: null,
        createdBy: 'user-1',
        feedback: 'Design approved for staging deployment',
        status: 'approved',
        createdAt: new Date('2026-03-02'),
        updatedAt: new Date('2026-03-02'),
        project: { id: 'proj-1', name: 'Alpha Portal' },
        contact: { id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@client.com' },
        creator: null,
      },
      {
        id: 'app-2',
        organizationId: 'org-1',
        projectId: 'proj-2',
        contactId: null,
        approvedBy: 'user-2',
        approvedAt: new Date('2026-03-03'),
        createdBy: 'user-2',
        feedback: 'Please revise security posture',
        status: 'changes_requested',
        createdAt: new Date('2026-03-03'),
        updatedAt: new Date('2026-03-03'),
        project: { id: 'proj-2', name: 'Beta API' },
        contact: null,
        creator: { id: 'user-2', name: 'Bob Lead', email: 'bob@agency.com' },
      },
    ];

    it('renders Bento approvals with status indicators and inspector', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<ApprovalsClient approvals={mockApprovals} />);

      expect(screen.getByText('Project Approvals')).toBeInTheDocument();
      expect(screen.getByText('Approved Gates')).toBeInTheDocument();
      expect(screen.getByText('Changes Requested')).toBeInTheDocument();
      expect(screen.getAllByText('Alpha Portal').length).toBeGreaterThan(0);
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('renders legacy table view when useBentoShell is false', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<ApprovalsClient approvals={mockApprovals} />);

      expect(screen.getByText('Approvals')).toBeInTheDocument();
      expect(screen.getByText('Alpha Portal')).toBeInTheDocument();
      expect(screen.getByText('Bob Lead')).toBeInTheDocument();
    });
  });

  describe('Change Orders Client & Bento Integration', () => {
    const mockChangeOrders = [
      {
        id: 'co-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        description: 'Additional payment gateway integration',
        amount: '4500.00',
        status: 'approved',
        approvedBy: 'user-1',
        createdAt: new Date('2026-03-04'),
        updatedAt: new Date('2026-03-04'),
        project: { id: 'proj-1', name: 'Mobile App' },
        approver: { id: 'user-1', name: 'Sarah Director', email: 'sarah@agency.com' },
      },
    ];

    it('renders Bento change orders with monetary aggregations', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<ChangeOrdersClient changeOrders={mockChangeOrders} totalApprovedAmount={4500} />);

      expect(screen.getByText('Change Orders')).toBeInTheDocument();
      expect(screen.getByText('Approved Scope Total')).toBeInTheDocument();
      expect(screen.getAllByText(/4,500\.00/).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Additional payment gateway integration').length).toBeGreaterThan(
        0
      );
    });

    it('renders legacy table view when useBentoShell is false', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<ChangeOrdersClient changeOrders={mockChangeOrders} totalApprovedAmount={4500} />);

      expect(screen.getByText('Change Orders')).toBeInTheDocument();
      expect(screen.getByText('$4500.00')).toBeInTheDocument();
      expect(screen.getByText('Sarah Director')).toBeInTheDocument();
    });
  });

  describe('Time Entries Client & Bento Integration', () => {
    const mockTimeEntries = [
      {
        id: 'te-1',
        organizationId: 'org-1',
        userId: 'user-1',
        taskId: 'task-1',
        date: new Date('2026-03-05'),
        hours: '4.5',
        description: 'Implemented Bento Shell UI components',
        billable: true,
        createdAt: new Date('2026-03-05'),
        user: { id: 'user-1', name: 'Dan Developer', email: 'dan@agency.com' },
        task: {
          id: 'task-1',
          title: 'Frontend Phase 6B',
          projectId: 'proj-1',
          project: { id: 'proj-1', name: 'Client Portal' },
        },
      },
      {
        id: 'te-2',
        organizationId: 'org-1',
        userId: 'user-2',
        taskId: null,
        date: new Date('2026-03-06'),
        hours: '1.5',
        description: 'Internal retrospective and planning',
        billable: false,
        createdAt: new Date('2026-03-06'),
        user: { id: 'user-2', name: 'Emma Manager', email: 'emma@agency.com' },
        task: null,
      },
    ];

    it('renders Bento timesheets with billable utilization metrics', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(
        <TimeEntriesClient
          timeEntries={mockTimeEntries}
          totalHours={6.0}
          billableHours={4.5}
          nonBillableHours={1.5}
        />
      );

      expect(screen.getByText('Time Entries')).toBeInTheDocument();
      expect(screen.getByText('Total Hours Logged')).toBeInTheDocument();
      expect(screen.getByText('6.0 hrs')).toBeInTheDocument();
      expect(screen.getByText('Billable Hours')).toBeInTheDocument();
      expect(screen.getAllByText(/4\.5 hrs/).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Implemented Bento Shell UI components').length).toBeGreaterThan(
        0
      );
    });

    it('renders legacy table view when useBentoShell is false', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(
        <TimeEntriesClient
          timeEntries={mockTimeEntries}
          totalHours={6.0}
          billableHours={4.5}
          nonBillableHours={1.5}
        />
      );

      expect(screen.getByText('Time Entries')).toBeInTheDocument();
      expect(screen.getByText('Dan Developer')).toBeInTheDocument();
      expect(screen.getByText('4.5 hrs')).toBeInTheDocument();
      expect(screen.getByText('Yes')).toBeInTheDocument();
    });
  });

  describe('Project Templates Client & Bento Integration', () => {
    const mockTemplates = [
      {
        id: 'tpl-1',
        organizationId: 'org-1',
        name: 'Full-Stack Web App Blueprint',
        description: 'Standard 6-week architecture and development workflow',
        projectCount: 8,
        createdAt: new Date('2026-01-15'),
        updatedAt: new Date('2026-01-15'),
      },
    ];

    it('renders Bento templates view with metrics and blueprint inspector', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<ProjectTemplatesClient templates={mockTemplates} />);

      expect(screen.getByText('Project Templates')).toBeInTheDocument();
      expect(screen.getByText('Configured Templates')).toBeInTheDocument();
      expect(screen.getByText('Projects Instantiated')).toBeInTheDocument();
      expect(screen.getAllByText('Full-Stack Web App Blueprint').length).toBeGreaterThan(0);
      expect(
        screen.getAllByText('Standard 6-week architecture and development workflow').length
      ).toBeGreaterThan(0);
    });

    it('renders legacy table view when useBentoShell is false', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<ProjectTemplatesClient templates={mockTemplates} />);

      expect(screen.getByText('Project Templates')).toBeInTheDocument();
      expect(screen.getByText('Full-Stack Web App Blueprint')).toBeInTheDocument();
      expect(screen.getByText('Use')).toBeInTheDocument();
    });
  });
});
