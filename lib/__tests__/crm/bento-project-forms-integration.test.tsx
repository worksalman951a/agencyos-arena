import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock next/navigation
const mockPush = vi.fn();
const mockRefresh = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => mockSearchParams,
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
import NewProjectPage from '@/app/projects/new/page';
import { EditProjectForm } from '@/app/projects/[id]/edit/EditProjectForm';
import NewProjectTemplatePage from '@/app/projects/templates/new/page';
import EditProjectTemplatePage from '@/app/projects/templates/[id]/edit/page';
import NewChangeOrderPage from '@/app/projects/change-orders/new/page';
import EditChangeOrderPage from '@/app/projects/change-orders/[id]/page';
import NewTimeEntryPage from '@/app/projects/time-entries/new/page';
import EditTimeEntryPage from '@/app/projects/time-entries/[id]/page';

describe('Phase 10F: Bento Project Management Forms Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBento = true;
    mockSearchParams = new URLSearchParams();

    // Default global fetch mock
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            contacts: [
              { id: 'contact-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@acme.com' },
              { id: 'contact-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@acme.com' },
            ],
          }),
        } as Response);
      }
      if (urlStr.includes('/api/v1/projects/templates')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'tpl-1', name: 'Web Dev Template', description: 'Standard web build' },
          ],
        } as Response);
      }
      if (urlStr.includes('/api/v1/crm/projects')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                id: 'proj-1',
                name: 'Alpha Project',
                tasks: [{ id: 'task-1', title: 'Task 1' }],
              },
            ],
          }),
        } as Response);
      }
      if (urlStr.includes('/api/v1/projects/members')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [{ id: 'user-1', name: 'Dev Lead', email: 'lead@agency.com' }],
          }),
        } as Response);
      }
      if (urlStr.includes('/api/v1/projects/change-orders/co-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projectId: 'proj-1',
            project: { name: 'Alpha Project' },
            description: 'Scope change addendum',
            amount: '5000.00',
            status: 'pending',
            approvedBy: null,
          }),
        } as Response);
      }
      if (urlStr.includes('/api/v1/projects/time-entries/te-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            userId: 'user-1',
            taskId: 'task-1',
            date: '2026-11-10T00:00:00.000Z',
            hours: '4.5',
            description: 'Built Bento view components',
            billable: true,
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 'mock-created-id' }),
      } as unknown as Response);
    }) as unknown as typeof fetch;
  });

  describe('Project Create & Edit Forms', () => {
    it('renders Bento Project Create view when isBento is true', async () => {
      render(<NewProjectPage />);
      expect(
        await screen.findByRole('heading', { name: 'Create New Project', level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Project Parameters & Scope')).toBeInTheDocument();
      expect(screen.getByText('Project Governance')).toBeInTheDocument();
    });

    it('renders Legacy Project Create view when isBento is false', async () => {
      mockIsBento = false;
      render(<NewProjectPage />);
      expect(
        await screen.findByRole('heading', { name: 'New Project', level: 1 })
      ).toBeInTheDocument();
      expect(screen.queryByText('Project Governance')).not.toBeInTheDocument();
    });

    it('renders Bento Project Edit form with project values and delete handler', async () => {
      const mockProject = {
        id: 'proj-123',
        name: 'Website Redesign',
        status: 'active',
        budget: '15000',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-01'),
        description: 'Redesign client corporate site',
        clientId: 'contact-1',
        templateId: 'tpl-1',
        deletedAt: null,
        client: { id: 'contact-1', firstName: 'Alice', lastName: 'Smith' },
      };

      render(<EditProjectForm project={mockProject} />);
      expect(screen.getByText('Edit Project: Website Redesign')).toBeInTheDocument();
      expect(screen.getByText('Project Governance')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
  });

  describe('Project Template Create & Edit Forms', () => {
    it('renders Bento Template Create view and binds template input values', async () => {
      render(<NewProjectTemplatePage />);
      expect(
        screen.getByRole('heading', { name: 'New Project Template', level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Template Specifications')).toBeInTheDocument();
      expect(screen.getByText('Template Identity')).toBeInTheDocument();

      const nameInput = screen.getByLabelText(/Template Name/i);
      fireEvent.change(nameInput, { target: { value: 'Mobile App Template' } });
      expect(screen.getByDisplayValue('Mobile App Template')).toBeInTheDocument();
    });

    it('renders Bento Template Edit view and displays blueprint context', async () => {
      const params = Promise.resolve({ id: 'tpl-1' });
      render(<EditProjectTemplatePage params={params} />);
      expect(
        await screen.findByRole('heading', { name: /Edit Template:/i, level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Blueprint Context')).toBeInTheDocument();
    });
  });

  describe('Change Order Create & Edit Forms', () => {
    it('renders Bento Change Order Create view with financial variance StatStrip', async () => {
      render(<NewChangeOrderPage />);
      expect(
        await screen.findByRole('heading', { name: 'New Change Order', level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Scope Modification Parameters')).toBeInTheDocument();
      expect(screen.getByText('Commercial Audit')).toBeInTheDocument();
      expect(screen.getByText('Financial Safeguards')).toBeInTheDocument();
    });

    it('renders Bento Change Order Edit view with amount precision and status indicators', async () => {
      const params = Promise.resolve({ id: 'co-1' });
      render(<EditChangeOrderPage params={params} />);
      expect(
        await screen.findByRole('heading', { name: /Edit Change Order:/i, level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('$5,000')).toBeInTheDocument();
      expect(screen.getAllByText('PENDING').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Time Entry Create & Edit Forms', () => {
    it('renders Bento Time Entry Create view with effort tracking and billing status', async () => {
      render(<NewTimeEntryPage />);
      expect(
        await screen.findByRole('heading', { name: 'Log Time Entry', level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('Time Allocation Parameters')).toBeInTheDocument();
      expect(screen.getByText('Attribution Context')).toBeInTheDocument();
      expect(screen.getAllByText('BILLABLE').length).toBeGreaterThanOrEqual(1);
    });

    it('renders Bento Time Entry Edit view with loaded duration and attribution context', async () => {
      const params = Promise.resolve({ id: 'te-1' });
      render(<EditTimeEntryPage params={params} />);
      expect(
        await screen.findByRole('heading', { name: /Edit Time Entry:/i, level: 1 })
      ).toBeInTheDocument();
      expect(screen.getByText('4.5 hrs')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
  });
});
