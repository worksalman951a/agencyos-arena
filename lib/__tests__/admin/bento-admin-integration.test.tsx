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
  usePathname: () => '/admin/users',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock bento theme provider
const mockUseBentoShell = vi.fn();
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBentoShell(),
  BentoThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { UsersClient } from '@/app/admin/users/users-client';
import { InvitationsClient } from '@/app/admin/invitations/invitations-client';
import { RolesClient } from '@/app/admin/roles/roles-client';
import { AuditLogsClient } from '@/app/admin/audit-logs/audit-logs-client';

describe('Phase 8A: Premium Administration & RBAC Integration Tests', () => {
  describe('Users Directory Client', () => {
    const mockUsers = [
      {
        id: 'usr-1',
        organizationId: 'org-1',
        name: 'Sarah Admin',
        email: 'sarah@agency.com',
        image: null,
        role: 'admin',
        roles: ['Billing Specialist'],
        status: 'active',
        createdAt: new Date('2026-01-10'),
        updatedAt: new Date('2026-01-10'),
      },
      {
        id: 'usr-2',
        organizationId: 'org-1',
        name: 'John Suspended',
        email: 'john@agency.com',
        image: null,
        role: 'employee',
        roles: [],
        status: 'suspended',
        createdAt: new Date('2026-02-15'),
        updatedAt: new Date('2026-02-15'),
      },
    ];

    it('renders Bento users register when useBentoShell is enabled', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<UsersClient users={mockUsers} />);

      expect(screen.getByText('Users & Members')).toBeInTheDocument();
      expect(screen.getByText('Total Members')).toBeInTheDocument();
      expect(screen.getByText('Active Accounts')).toBeInTheDocument();
      expect(screen.getAllByText('Sarah Admin').length).toBeGreaterThan(0);
      expect(screen.getAllByText('sarah@agency.com').length).toBeGreaterThan(0);
    });

    it('renders legacy table view when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<UsersClient users={mockUsers} />);

      expect(screen.getByText('Users')).toBeInTheDocument();
      expect(screen.getByText('Sarah Admin')).toBeInTheDocument();
      expect(screen.getByText('sarah@agency.com')).toBeInTheDocument();
    });
  });

  describe('Invitations Client', () => {
    const mockInvitations = [
      {
        id: 'inv-1',
        organizationId: 'org-1',
        roleId: 'role-1',
        invitedBy: 'usr-admin',
        acceptedAt: null,
        email: 'newhire@agency.com',
        roleName: 'Account Executive',
        status: 'pending',
        expiresAt: new Date('2026-03-20'),
        createdAt: new Date('2026-03-13'),
      },
    ];
    const mockRoles = [{ id: 'role-1', name: 'Account Executive' }];

    it('renders Bento invitations register when useBentoShell is enabled', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<InvitationsClient invitations={mockInvitations} roles={mockRoles} />);

      expect(screen.getByText('Team Invitations')).toBeInTheDocument();
      expect(screen.getByText('Pending Acceptance')).toBeInTheDocument();
      expect(screen.getAllByText('newhire@agency.com').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Account Executive').length).toBeGreaterThan(0);
    });

    it('renders legacy invitations table when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<InvitationsClient invitations={mockInvitations} roles={mockRoles} />);

      expect(screen.getByText('Invitations')).toBeInTheDocument();
      expect(screen.getByText('newhire@agency.com')).toBeInTheDocument();
    });
  });

  describe('Roles & Permissions Client', () => {
    const mockRoles = [
      {
        id: 'role-sys-owner',
        organizationId: 'org-1',
        name: 'owner',
        description: 'Organization owner with full administrative authority',
        isSystem: true,
        permissions: [
          { id: 'p1', code: 'user.read', description: null },
          { id: 'p2', code: 'user.create', description: null },
          { id: 'p3', code: 'role.update', description: null },
        ],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
      {
        id: 'role-custom-qa',
        organizationId: 'org-1',
        name: 'QA Engineer',
        description: 'Quality assurance and testing auditor',
        isSystem: false,
        permissions: [
          { id: 'p4', code: 'project.read', description: null },
          { id: 'p5', code: 'task.read', description: null },
        ],
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-01'),
      },
    ];

    it('renders Bento roles view with system vs custom role metrics', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(<RolesClient roles={mockRoles} />);

      expect(screen.getByText('Roles & Granular Permissions')).toBeInTheDocument();
      expect(screen.getByText('Total Registered Roles')).toBeInTheDocument();
      expect(screen.getByText('System Roles')).toBeInTheDocument();
      expect(screen.getByText('Custom Roles')).toBeInTheDocument();
      expect(screen.getAllByText('QA Engineer').length).toBeGreaterThan(0);
    });

    it('renders legacy table view when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(<RolesClient roles={mockRoles} />);

      expect(screen.getByText('Roles & Permissions')).toBeInTheDocument();
      expect(screen.getByText('QA Engineer')).toBeInTheDocument();
      expect(screen.getByText('Quality assurance and testing auditor')).toBeInTheDocument();
    });
  });

  describe('Audit Logs Client', () => {
    const mockLogs = [
      {
        id: 'log-1',
        organizationId: 'org-1',
        actorId: 'usr-1',
        actorName: 'Sarah Admin',
        actor: { id: 'usr-1', name: 'Sarah Admin', email: 'sarah@agency.com' },
        action: 'user.role_assigned',
        entityType: 'User',
        entityId: 'usr-2',
        before: { role: 'employee' },
        after: { role: 'admin' },
        metadata: { ip: '10.0.0.1' },
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        createdAt: new Date('2026-03-01T14:30:00Z'),
      },
    ];

    it('renders Bento audit logs view with forensic details', () => {
      mockUseBentoShell.mockReturnValue(true);
      render(
        <AuditLogsClient
          logs={mockLogs}
          total={1}
          currentPage={1}
          totalPages={1}
          actions={['user.role_assigned']}
          isFiltered={false}
        />
      );

      expect(screen.getByText('Audit Activity Log')).toBeInTheDocument();
      expect(screen.getByText('Total Audit Entries')).toBeInTheDocument();
      expect(screen.getAllByText('user.role_assigned').length).toBeGreaterThan(0);
      expect(screen.getAllByText('by Sarah Admin').length).toBeGreaterThan(0);
    });

    it('renders legacy audit table when useBentoShell is disabled', () => {
      mockUseBentoShell.mockReturnValue(false);
      render(
        <AuditLogsClient
          logs={mockLogs}
          total={1}
          currentPage={1}
          totalPages={1}
          actions={['user.role_assigned']}
          isFiltered={false}
        />
      );

      expect(screen.getByText('Audit Log')).toBeInTheDocument();
      expect(screen.getAllByText('user.role_assigned').length).toBeGreaterThan(0);
      expect(screen.getByText('Sarah Admin')).toBeInTheDocument();
    });
  });
});
