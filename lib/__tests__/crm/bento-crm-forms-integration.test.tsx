import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Import the form components
import CreateLeadPage from '@/app/crm/leads/new/page';
import { EditLeadForm } from '@/app/crm/leads/[id]/edit/EditLeadForm';
import NewContactPage from '@/app/crm/contacts/new/page';
import { EditContactForm } from '@/app/crm/contacts/[id]/edit/EditContactForm';
import NewAccountPage from '@/app/crm/accounts/new/page';
import { EditAccountForm } from '@/app/crm/accounts/[id]/edit/EditAccountForm';

// Mocks
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

let mockUseBento = false;
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBento,
}));

describe('CRM Forms Bento Integration and Fallback Parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBento = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/v1/crm/accounts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accounts: [
              { id: 'acc-1', name: 'Acme Corp' },
              { id: 'acc-2', name: 'Stark Industries' },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    }) as unknown as typeof fetch;
  });

  describe('Lead Forms', () => {
    it('renders legacy lead creation form when Bento shell is disabled', () => {
      mockUseBento = false;
      render(<CreateLeadPage />);

      expect(screen.getByRole('heading', { level: 3, name: 'New Lead' })).toBeDefined();
      expect(screen.getByLabelText(/Source/i)).toBeDefined();
      expect(screen.getByLabelText(/Status/i)).toBeDefined();
      expect(screen.getByLabelText(/Priority/i)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Create Lead' })).toBeDefined();
    });

    it('renders Bento lead creation view when Bento shell is enabled', () => {
      mockUseBento = true;
      render(<CreateLeadPage />);

      expect(screen.getByRole('heading', { level: 1, name: 'New Lead Enquiry' })).toBeDefined();
      expect(screen.getByText('Lead Qualification & Identity')).toBeDefined();
      expect(screen.getByText('Lead Lifecycle Guidance')).toBeDefined();
      expect(screen.getByText('Duplicate Prevention')).toBeDefined();
      expect(screen.getAllByRole('button', { name: /Create Lead/i }).length).toBeGreaterThan(0);
    });

    it('renders legacy lead edit form when Bento shell is disabled', () => {
      mockUseBento = false;
      const initialLead = {
        id: 'lead-1',
        source: 'Website',
        status: 'contacted',
        priority: 'high',
        expectedValue: '5000',
        contactId: 'cnt-1',
        accountId: 'acc-1',
        ownerId: 'usr-1',
        pipelineId: 'pipe-1',
        stageId: 'stg-1',
        notes: 'Priority VIP',
      };

      render(<EditLeadForm lead={initialLead} />);

      expect(screen.getByRole('heading', { level: 3, name: 'Edit Lead' })).toBeDefined();
      expect(screen.getByDisplayValue('Website')).toBeDefined();
      expect(screen.getByDisplayValue('5000')).toBeDefined();
      expect(screen.getByDisplayValue('Priority VIP')).toBeDefined();
    });

    it('renders Bento lead edit view when Bento shell is enabled', () => {
      mockUseBento = true;
      const initialLead = {
        id: 'lead-1',
        source: 'Website',
        status: 'contacted',
        priority: 'high',
        expectedValue: '5000',
        contactId: 'cnt-1',
        accountId: 'acc-1',
        ownerId: 'usr-1',
        pipelineId: 'pipe-1',
        stageId: 'stg-1',
        notes: 'Priority VIP',
      };

      render(<EditLeadForm lead={initialLead} />);

      expect(screen.getByRole('heading', { level: 1, name: /Edit Lead/i })).toBeDefined();
      expect(screen.getByText('Lead Qualification & Identity')).toBeDefined();
      expect(screen.getByText('Lead Lifecycle Guidance')).toBeDefined();
      expect(screen.getByDisplayValue('Website')).toBeDefined();
      expect(screen.getByDisplayValue('5000')).toBeDefined();
      expect(
        screen.getAllByRole('button', { name: /Save Lead Changes|Save Changes/i }).length
      ).toBeGreaterThan(0);
    });
  });

  describe('Contact Forms', () => {
    it('renders legacy contact creation form when Bento shell is disabled', () => {
      mockUseBento = false;
      render(<NewContactPage />);

      expect(screen.getByRole('heading', { level: 3, name: 'New Contact' })).toBeDefined();
      expect(screen.getByLabelText(/Last Name/i)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Create Contact' })).toBeDefined();
    });

    it('renders Bento contact creation view when Bento shell is enabled', () => {
      mockUseBento = true;
      render(<NewContactPage />);

      expect(screen.getByRole('heading', { level: 1, name: 'Register New Contact' })).toBeDefined();
      expect(screen.getByText('Personal Details & Communications')).toBeDefined();
      expect(screen.getByText('Privacy & Masking Rules')).toBeDefined();
      expect(screen.getAllByRole('button', { name: /Create Contact/i }).length).toBeGreaterThan(0);
    });

    it('renders legacy contact edit form when Bento shell is disabled', () => {
      mockUseBento = false;
      const initialContact = {
        id: 'cnt-1',
        firstName: 'Diana',
        lastName: 'Prince',
        email: 'diana@themyscira.gov',
        phone: '555-0200',
        accountId: 'acc-1',
        status: 'active',
        source: 'event',
      };

      render(<EditContactForm contact={initialContact} />);

      expect(screen.getByRole('heading', { level: 3, name: 'Edit Contact' })).toBeDefined();
      expect(screen.getByDisplayValue('Diana')).toBeDefined();
      expect(screen.getByDisplayValue('Prince')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Save Contact' })).toBeDefined();
    });

    it('renders Bento contact edit view when Bento shell is enabled', () => {
      mockUseBento = true;
      const initialContact = {
        id: 'cnt-1',
        firstName: 'Diana',
        lastName: 'Prince',
        email: 'diana@themyscira.gov',
        phone: '555-0200',
        accountId: 'acc-1',
        status: 'active',
        source: 'event',
      };

      render(<EditContactForm contact={initialContact} />);

      expect(screen.getByRole('heading', { level: 1, name: 'Edit: Diana Prince' })).toBeDefined();
      expect(screen.getByText('Personal Details & Communications')).toBeDefined();
      expect(screen.getByText('Privacy & Masking Rules')).toBeDefined();
      expect(screen.getByDisplayValue('Diana')).toBeDefined();
      expect(screen.getByDisplayValue('Prince')).toBeDefined();
      expect(
        screen.getAllByRole('button', { name: /Save Changes|Save Contact Changes/i }).length
      ).toBeGreaterThan(0);
    });
  });

  describe('Account Forms', () => {
    it('renders legacy account creation form when Bento shell is disabled', () => {
      mockUseBento = false;
      render(<NewAccountPage />);

      expect(screen.getByRole('heading', { level: 3, name: 'New Account' })).toBeDefined();
      expect(screen.getByLabelText(/Account Name/i)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Create Account' })).toBeDefined();
    });

    it('renders Bento account creation view when Bento shell is enabled', () => {
      mockUseBento = true;
      render(<NewAccountPage />);

      expect(screen.getByRole('heading', { level: 1, name: 'Register New Account' })).toBeDefined();
      expect(screen.getByText('Company Information & Status')).toBeDefined();
      expect(screen.getByText('Account Directory Role')).toBeDefined();
      expect(screen.getAllByRole('button', { name: /Create Account/i }).length).toBeGreaterThan(0);
    });

    it('renders legacy account edit form when Bento shell is disabled', () => {
      mockUseBento = false;
      const initialAccount = {
        id: 'acc-1',
        name: 'Wayne Enterprises',
        website: 'https://wayne.example.com',
        address: '1007 Mountain Drive, Gotham',
        status: 'active',
      };

      render(<EditAccountForm account={initialAccount} />);

      expect(screen.getByRole('heading', { level: 3, name: 'Edit Account' })).toBeDefined();
      expect(screen.getByDisplayValue('Wayne Enterprises')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Save Account' })).toBeDefined();
    });

    it('renders Bento account edit view when Bento shell is enabled', () => {
      mockUseBento = true;
      const initialAccount = {
        id: 'acc-1',
        name: 'Wayne Enterprises',
        website: 'https://wayne.example.com',
        address: '1007 Mountain Drive, Gotham',
        status: 'active',
      };

      render(<EditAccountForm account={initialAccount} />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Edit: Wayne Enterprises' })
      ).toBeDefined();
      expect(screen.getByText('Company Information & Status')).toBeDefined();
      expect(screen.getByText('Account Directory Role')).toBeDefined();
      expect(screen.getByDisplayValue('Wayne Enterprises')).toBeDefined();
      expect(
        screen.getAllByRole('button', { name: /Save Changes|Save Account Changes/i }).length
      ).toBeGreaterThan(0);
    });
  });
});
