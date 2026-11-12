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
  usePathname: () => '/automation/rules',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock bento theme provider
const mockUseBentoShell = vi.fn();
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBentoShell(),
  BentoThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { WorkflowRulesClient } from '@/app/automation/rules/workflow-rules-client';
import { WorkflowRuleDetailClient } from '@/app/automation/rules/[id]/workflow-rule-detail-client';
import type {
  WorkflowRuleResponse,
  WorkflowExecutionResponse,
} from '@/lib/services/automation/workflow-service';

describe('Phase 7A: Premium Automation Bento Integration Tests', () => {
  const mockRules: WorkflowRuleResponse[] = [
    {
      id: 'rule-1',
      organizationId: 'org-1',
      name: 'Auto-Assign High Value Leads',
      trigger: 'record.created',
      conditions: {
        mode: 'all',
        all: [{ field: 'estimatedValue', operator: 'gte', value: 10000 }],
      },
      actions: {
        list: [
          { type: 'assign_record_owner', userId: 'user-vip-rep' },
          { type: 'notify_user', userId: 'user-vip-rep', title: 'High value lead assigned' },
        ],
      },
      enabled: true,
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-01'),
    },
    {
      id: 'rule-2',
      organizationId: 'org-1',
      name: 'Archive Closed Projects',
      trigger: 'record.status_changed',
      conditions: {},
      actions: {
        list: [{ type: 'log', message: 'Project status transitioned to closed' }],
      },
      enabled: false,
      createdAt: new Date('2026-03-02'),
      updatedAt: new Date('2026-03-02'),
    },
  ];

  const mockExecutions: WorkflowExecutionResponse[] = [
    {
      id: 'exec-1',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'lead',
      recordId: 'lead-999',
      status: 'succeeded',
      resultLog: { assigned: true, notificationsSent: 1 },
      attempts: 1,
      lastAttemptAt: new Date('2026-03-05T10:00:00Z'),
      createdAt: new Date('2026-03-05T10:00:00Z'),
    },
    {
      id: 'exec-2',
      organizationId: 'org-1',
      ruleId: 'rule-1',
      recordType: 'lead',
      recordId: 'lead-1000',
      status: 'failed',
      resultLog: { error: 'Target user does not belong to organization' },
      attempts: 2,
      lastAttemptAt: new Date('2026-03-05T11:00:00Z'),
      createdAt: new Date('2026-03-05T11:00:00Z'),
    },
  ];

  describe('Automation Rules Directory Client', () => {
    it('renders Bento view when useBentoShell is enabled', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<WorkflowRulesClient workflows={mockRules} />);

      expect(screen.getByText('Automation Rules')).toBeInTheDocument();
      expect(screen.getByText('Total Active Rules')).toBeInTheDocument();
      expect(screen.getByText('Enabled Rules')).toBeInTheDocument();
      expect(screen.getAllByText('Auto-Assign High Value Leads').length).toBeGreaterThan(0);
      expect(screen.getAllByText('record.created').length).toBeGreaterThan(0);
    });

    it('renders legacy table view when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<WorkflowRulesClient workflows={mockRules} />);

      expect(screen.getByText('Workflow Rules')).toBeInTheDocument();
      expect(screen.getByText('Auto-Assign High Value Leads')).toBeInTheDocument();
      expect(screen.getByText('Archive Closed Projects')).toBeInTheDocument();
      expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
    });
  });

  describe('Automation Rule Record / Detail Client', () => {
    it('renders Bento rule detail with trigger blueprint and executions inspector', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<WorkflowRuleDetailClient rule={mockRules[0]} executions={mockExecutions} />);

      expect(screen.getAllByText('Auto-Assign High Value Leads').length).toBeGreaterThan(0);
      expect(screen.getByText('Total Dispatches')).toBeInTheDocument();
      expect(screen.getByText('Success Rate')).toBeInTheDocument();
      expect(screen.getByText('Trigger Conditions')).toBeInTheDocument();
      expect(screen.getByText('Configured Actions')).toBeInTheDocument();
      expect(screen.getAllByText('lead').length).toBeGreaterThan(0);
      expect(screen.getAllByText('lead-999').length).toBeGreaterThan(0);
    });

    it('renders legacy rule view when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<WorkflowRuleDetailClient rule={mockRules[0]} executions={mockExecutions} />);

      expect(screen.getByText('Auto-Assign High Value Leads')).toBeInTheDocument();
      expect(screen.getAllByText('Conditions').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Actions').length).toBeGreaterThan(0);
      expect(screen.getByText('Execution history')).toBeInTheDocument();
      expect(screen.getByText('lead-999')).toBeInTheDocument();
    });
  });
});
