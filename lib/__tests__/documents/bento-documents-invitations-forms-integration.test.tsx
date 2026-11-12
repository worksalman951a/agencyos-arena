import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock next/navigation
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useParams: () => ({ id: 'contract-1' }),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

let mockIsBento = true;
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockIsBento,
}));

// Components under test
import NewContractPage from '@/app/documents/contracts/new/page';
import EditContractPage from '@/app/documents/contracts/[id]/edit/page';
import NewTemplatePage from '@/app/documents/templates/new/page';
import { TemplateDetailClient } from '@/app/documents/templates/[id]/TemplateDetailClient';
import { NewInvitationForm } from '@/app/admin/invitations/NewInvitationForm';

describe('Phase 10G: Bento Documents & Invitations Forms Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBento = true;

    // Default global fetch mock
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/v1/crm/proposals')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            proposals: [{ id: 'prop-1', number: 'PROP-001', title: 'Website Proposal' }],
          }),
        } as unknown as Response);
      }
      if (urlStr.includes('/api/v1/projects')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [{ id: 'proj-1', name: 'Alpha Redesign' }],
          }),
        } as unknown as Response);
      }
      if (urlStr.includes('/api/v1/documents/contracts/contract-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'contract-1',
            title: 'Master Services Agreement',
            proposalId: 'prop-1',
            projectId: 'proj-1',
            status: 'draft',
          }),
        } as unknown as Response);
      }
      if (urlStr.includes('/api/v1/admin/invitations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'inv-1',
            acceptPath: '/invite/raw-secret-token-123',
          }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 'mock-created-id' }),
      } as unknown as Response);
    }) as unknown as typeof fetch;
  });

  describe('Contract Create & Edit Forms', () => {
    it('renders Bento Contract Create view when isBento is true', async () => {
      render(<NewContractPage />);
      expect(
        await screen.findByRole('heading', { name: 'New Contract', level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Contract Parameters & Scope')).toBeInTheDocument();
      expect(screen.getByText('Document Governance')).toBeInTheDocument();
      expect(screen.getByText('Execution Safeguards')).toBeInTheDocument();
    });

    it('renders Legacy Contract Create view when isBento is false', async () => {
      mockIsBento = false;
      render(<NewContractPage />);
      expect(
        await screen.findByRole('heading', { name: 'New Contract', level: 1 })
      ).toBeInTheDocument();
      expect(screen.queryByText('Document Governance')).not.toBeInTheDocument();
    });

    it('renders Bento Contract Edit form with loaded values and lifecycle tone', async () => {
      render(<EditContractPage />);
      expect(
        await screen.findByRole('heading', { name: /Edit Contract:/i, level: 1 })
      ).toBeInTheDocument();
      expect(screen.getAllByText('DRAFT').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Master Services Agreement').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Document Template Create & Edit Forms', () => {
    it('renders Bento Template Create view and binds template input values', async () => {
      render(<NewTemplatePage />);
      expect(
        screen.getByRole('heading', { name: 'New Document Template', level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Template Specifications & Content')).toBeInTheDocument();
      expect(screen.getByText('Organization Scoped')).toBeInTheDocument();

      const nameInput = screen.getByLabelText(/Template Name/i);
      fireEvent.change(nameInput, { target: { value: 'SaaS Agreement' } });
      expect(screen.getByDisplayValue('SaaS Agreement')).toBeInTheDocument();
    });

    it('renders Bento Template Edit view when edit mode is toggled', async () => {
      const mockTemplate = {
        id: 'tpl-101',
        name: 'Standard Retainer',
        type: 'contract',
        content: 'Retainer terms for {{client_name}}',
        variables: { client_name: '' },
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      render(<TemplateDetailClient template={mockTemplate} />);
      const editButton = screen.getByRole('button', { name: 'Edit Template' });
      fireEvent.click(editButton);

      expect(
        await screen.findByRole('heading', { name: /Edit Template: Standard Retainer/i, level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Template Specifications & Content')).toBeInTheDocument();
      expect(screen.getByText('ORGANIZATION DEFAULT')).toBeInTheDocument();
    });
  });

  describe('Team Invitation Form Modernization', () => {
    const roles = [
      { id: 'role-admin', name: 'Administrator' },
      { id: 'role-member', name: 'Member' },
    ];

    it('renders modern Bento invitation form with role selection and single-use link copy button', async () => {
      const { container } = render(<NewInvitationForm roles={roles} />);
      const emailInput = screen.getByLabelText(/Teammate E-mail/i);
      fireEvent.change(emailInput, { target: { value: 'colleague@agency.test' } });

      const form = container.querySelector('form');
      if (form) {
        fireEvent.submit(form);
      }

      expect(await screen.findByTestId('invitation-link')).toBeInTheDocument();
      expect(screen.getByText(/Single-Use Invitation Link/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy Link/i })).toBeInTheDocument();
    });

    it('renders legacy invitation form when isBento is false', () => {
      mockIsBento = false;
      render(<NewInvitationForm roles={roles} />);
      expect(screen.getByLabelText(/E-mail/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create invitation/i })).toBeInTheDocument();
    });
  });
});
