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
  usePathname: () => '/automation/notifications',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock bento theme provider
const mockUseBentoShell = vi.fn();
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBentoShell(),
  BentoThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { NotificationsClient } from '@/app/automation/notifications/notifications-client';
import { NotificationPreferencesClient } from '@/app/automation/preferences/notification-preferences-client';
import { WorkflowRuleDetailClient } from '@/app/automation/rules/[id]/workflow-rule-detail-client';
import type { NotificationResponse } from '@/lib/services/automation/notification-service';

describe('Phase 7B: Premium Notifications & Preferences Integration Tests', () => {
  const mockNotifications: NotificationResponse[] = [
    {
      id: 'notif-1',
      organizationId: 'org-1',
      userId: 'user-me',
      type: 'lead.assigned',
      channel: 'in_app',
      read: false,
      payload: {
        title: 'New Lead Assigned: Acme Corp',
        message: 'Lead estimated at $50,000 has been routed to you.',
        recordType: 'lead',
        recordId: 'lead-123',
      },
      sentAt: new Date('2026-03-05T09:00:00Z'),
      createdAt: new Date('2026-03-05T09:00:00Z'),
    },
    {
      id: 'notif-2',
      organizationId: 'org-1',
      userId: 'user-me',
      type: 'project.milestone',
      channel: 'in_app',
      read: true,
      payload: {
        title: 'Milestone Approved',
        message: 'Sprint 2 architecture review signed off.',
        recordType: 'project',
        recordId: 'proj-456',
      },
      sentAt: new Date('2026-03-04T12:00:00Z'),
      createdAt: new Date('2026-03-04T12:00:00Z'),
    },
  ];

  const mockPreferences = {
    channels: {
      in_app: true,
      email: false,
    },
    mutedTypes: ['workflow'],
  };

  describe('Notification Center Client', () => {
    it('renders Bento Notification Center when useBentoShell is enabled', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<NotificationsClient notifications={mockNotifications} />);

      expect(screen.getByText('Notification Center')).toBeInTheDocument();
      expect(screen.getByText('Total Notifications')).toBeInTheDocument();
      expect(screen.getByText('Unread Messages')).toBeInTheDocument();
      expect(screen.getAllByText('New Lead Assigned: Acme Corp').length).toBeGreaterThan(0);
      expect(screen.getByText('View Related Record')).toBeInTheDocument();
    });

    it('renders legacy table view when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<NotificationsClient notifications={mockNotifications} />);

      expect(screen.getByText('Notifications')).toBeInTheDocument();
      expect(screen.getByText('Inbox')).toBeInTheDocument();
      expect(screen.getByText(/1 unread of 2/)).toBeInTheDocument();
      expect(screen.getByText('lead.assigned')).toBeInTheDocument();
      expect(screen.getByText('project.milestone')).toBeInTheDocument();
    });
  });

  describe('Notification Preferences Client', () => {
    it('renders Bento Preferences view with configured channels metric', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<NotificationPreferencesClient preferences={mockPreferences} />);

      expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
      expect(screen.getByText('Configured Channels')).toBeInTheDocument();
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
      expect(screen.getByText('Muted Categories')).toBeInTheDocument();
      expect(screen.getByText('Save preferences')).toBeInTheDocument();
    });

    it('renders legacy preferences layout when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<NotificationPreferencesClient preferences={mockPreferences} />);

      expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
      expect(
        screen.getByText('Choose which channels you receive notifications on.')
      ).toBeInTheDocument();
      expect(screen.getByText('Save preferences')).toBeInTheDocument();
    });
  });

  describe('Automation Follow-Up: Zero-run execution metric regression', () => {
    it('displays "No runs yet" and "—" rather than 100% Success Rate when executions are empty', () => {
      mockUseBentoShell.mockReturnValue(true);
      const emptyExecutionsRule = {
        id: 'rule-empty',
        organizationId: 'org-1',
        name: 'Empty Executions Rule',
        trigger: 'record.created' as const,
        conditions: {},
        actions: { list: [{ type: 'log' as const, message: 'Execution initiated' }] },
        enabled: true,
        createdAt: new Date('2026-03-01'),
        updatedAt: new Date('2026-03-01'),
      };

      render(<WorkflowRuleDetailClient rule={emptyExecutionsRule} executions={[]} />);

      expect(screen.getAllByText('Empty Executions Rule').length).toBeGreaterThan(0);
      expect(screen.getByText('Total Dispatches')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.getByText('No runs yet')).toBeInTheDocument();
      expect(screen.queryByText('100%')).not.toBeInTheDocument();
    });
  });
});
