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
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock bento theme provider
let mockUseBento = true;
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBento,
  BentoThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import EditUserPage from '@/app/admin/users/[id]/page';
import EditRolePage from '@/app/admin/roles/[id]/page';
import EditFeatureFlagPage from '@/app/admin/feature-flags/[id]/page';

describe('Bento Admin Create/Edit Forms Integration (Phase 10D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBento = true;

    // Default global fetch mock
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/admin/users/usr-1')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'usr-1',
              email: 'sarah@agency.com',
              name: 'Sarah Admin',
              role: 'admin',
              roles: ['Administrator'],
              status: 'active',
            }),
        });
      }
      if (url.includes('/api/v1/admin/roles/role-custom-1')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'role-custom-1',
              name: 'Finance Reviewer',
              description: 'Can review and reconcile client invoices',
              isSystem: false,
              permissions: [{ id: 'p1', code: 'invoice.read', description: 'Read invoices' }],
            }),
        });
      }
      if (url.includes('/api/v1/admin/roles?type=permissions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 'p1', code: 'invoice.read', description: 'Read invoices' },
              { id: 'p2', code: 'invoice.create', description: 'Create invoices' },
              { id: 'p3', code: 'user.read', description: 'View members' },
            ]),
        });
      }
      if (url.includes('/api/v1/admin/roles')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 'role-1', name: 'Administrator', isSystem: true },
              { id: 'role-custom-1', name: 'Finance Reviewer', isSystem: false },
            ]),
        });
      }
      if (url.includes('/api/v1/admin/feature-flags/flag-1')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'flag-1',
              flagKey: 'bento_crm_v2',
              enabled: true,
              description: 'Enable Bento CRM Layouts across workspace',
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  describe('User Management Detail / Edit Form (/admin/users/[id])', () => {
    it('renders legacy user edit form when Bento shell is disabled', async () => {
      mockUseBento = false;
      render(<EditUserPage params={Promise.resolve({ id: 'usr-1' })} />);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Edit Member' })
      ).toBeInTheDocument();
      expect(await screen.findByText('sarah@agency.com')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
      expect(screen.getByLabelText('Status')).toBeInTheDocument();
    });

    it('renders Bento user edit view when Bento shell is enabled', async () => {
      mockUseBento = true;
      render(<EditUserPage params={Promise.resolve({ id: 'usr-1' })} />);

      expect(
        await screen.findByRole('heading', { level: 1, name: /Edit Member: Sarah Admin/i })
      ).toBeInTheDocument();
      expect(screen.getByText('Role Assignment & Authority')).toBeInTheDocument();
      expect(screen.getByText('Member Governance Profile')).toBeInTheDocument();
      expect(
        (await screen.findAllByRole('button', { name: /Save Changes/i })).length
      ).toBeGreaterThan(0);
    });
  });

  describe('Role & Permissions Editor (/admin/roles/[id])', () => {
    it('renders legacy role edit form when Bento shell is disabled', async () => {
      mockUseBento = false;
      render(<EditRolePage params={Promise.resolve({ id: 'role-custom-1' })} />);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Edit Role' })
      ).toBeInTheDocument();
      expect(await screen.findByDisplayValue('Finance Reviewer')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    });

    it('renders Bento role edit view with permission categorisation when Bento is enabled', async () => {
      mockUseBento = true;
      render(<EditRolePage params={Promise.resolve({ id: 'role-custom-1' })} />);

      expect(
        await screen.findByRole('heading', { level: 1, name: /Edit Role: Finance Reviewer/i })
      ).toBeInTheDocument();
      expect(await screen.findByText('Role Metadata')).toBeInTheDocument();
      expect(screen.getByText('Governance Summary')).toBeInTheDocument();
      expect(screen.getByText(/invoice Scope/i)).toBeInTheDocument();
      expect(
        (await screen.findAllByRole('button', { name: /Save Changes/i })).length
      ).toBeGreaterThan(0);
    });
  });

  describe('Feature Flag Configuration Editor (/admin/feature-flags/[id])', () => {
    it('renders legacy feature flag edit form when Bento shell is disabled', async () => {
      mockUseBento = false;
      render(<EditFeatureFlagPage params={Promise.resolve({ id: 'flag-1' })} />);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Edit Feature Flag' })
      ).toBeInTheDocument();
      expect(await screen.findByDisplayValue('bento_crm_v2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    });

    it('renders Bento feature flag edit view when Bento shell is enabled', async () => {
      mockUseBento = true;
      render(<EditFeatureFlagPage params={Promise.resolve({ id: 'flag-1' })} />);

      expect(
        await screen.findByRole('heading', { level: 1, name: /Edit Feature Flag:/i })
      ).toBeInTheDocument();
      expect(screen.getByText('Configuration Parameters')).toBeInTheDocument();
      expect(screen.getByText('Security & Deployment')).toBeInTheDocument();
      expect(
        (await screen.findAllByRole('button', { name: /Save Changes/i })).length
      ).toBeGreaterThan(0);
    });
  });
});
