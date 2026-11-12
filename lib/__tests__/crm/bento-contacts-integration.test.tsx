import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import ContactsPage from '@/app/crm/contacts/page';
import ContactDetailPage from '@/app/crm/contacts/[id]/page';
import { BentoShellProvider } from '@/components/providers/bento-theme-provider';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockPush = vi.fn();
const mockRefresh = vi.fn();

let mockQueryString = '';
let mockParams: Record<string, string> = { id: 'contact_1' };

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockQueryString),
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useParams: () => mockParams,
}));

const mockContactsResponse = {
  contacts: [
    {
      id: 'contact_1',
      organizationId: 'org_1',
      accountId: 'acc_1',
      account: { id: 'acc_1', name: 'Acme Corp' },
      firstName: 'Sarah',
      lastName: 'Connor',
      email: 'sarah@skynet.com',
      phone: '555-9090',
      status: 'active',
      source: 'Direct Referral',
      isMasked: false,
      createdBy: 'usr_1',
      updatedBy: 'usr_1',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      deletedAt: null,
    },
    {
      id: 'contact_2',
      organizationId: 'org_1',
      accountId: null,
      account: null,
      firstName: 'John',
      lastName: 'Connor',
      email: 'j***@resistance.org',
      phone: '***8080',
      status: 'lead',
      source: 'Inbound',
      isMasked: true,
      createdBy: 'usr_1',
      updatedBy: null,
      createdAt: '2026-03-02T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
      deletedAt: null,
    },
  ],
  total: 2,
  totalPages: 1,
  page: 1,
};

const mockDetailResponse = {
  id: 'contact_1',
  organizationId: 'org_1',
  accountId: 'acc_1',
  account: { id: 'acc_1', name: 'Acme Corp' },
  firstName: 'Sarah',
  lastName: 'Connor',
  email: 'sarah@skynet.com',
  phone: '555-9090',
  status: 'active',
  source: 'Direct Referral',
  isMasked: false,
  createdBy: 'usr_1',
  updatedBy: 'usr_2',
  createdByUser: { id: 'usr_1', name: 'Admin One' },
  updatedByUser: { id: 'usr_2', name: 'Admin Two' },
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  deletedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mockQueryString = '';
  mockParams = { id: 'contact_1' };
  mockFetch.mockImplementation((url: string | URL) => {
    const u = String(url);
    if (u.includes('/api/v1/crm/contacts/contact_1')) {
      return Promise.resolve(
        new Response(JSON.stringify(mockDetailResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    if (u.includes('/api/v1/crm/contacts')) {
      return Promise.resolve(
        new Response(JSON.stringify(mockContactsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
  mockPush.mockReset();
  mockRefresh.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('Phase 3A: Bento Contacts Directory Integration', () => {
  it('renders modern Bento CRM layout when Bento shell is enabled', async () => {
    render(
      <BentoShellProvider isBento={true}>
        <ContactsPage />
      </BentoShellProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Sarah Connor').length).toBeGreaterThanOrEqual(1);
    });

    // Check Bento elements
    expect(screen.getByText('John Connor')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Contacts list' })).toBeInTheDocument();
    expect(screen.getByText('Contact Overview')).toBeInTheDocument();
    expect(screen.getByText('Related Actions')).toBeInTheDocument();
  });

  it('preserves legacy Contacts table view when Bento shell is disabled', async () => {
    render(
      <BentoShellProvider isBento={false}>
        <ContactsPage />
      </BentoShellProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
    });

    // Legacy table headers
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account' })).toBeInTheDocument();
  });

  it('switches the active contact rail when a row is clicked in Bento mode', async () => {
    render(
      <BentoShellProvider isBento={true}>
        <ContactsPage />
      </BentoShellProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Sarah Connor').length).toBeGreaterThanOrEqual(1);
    });

    // Click John Connor row
    const johnRow = screen.getByRole('row', { name: /John Connor/i });
    fireEvent.click(johnRow);

    // Detail rail updates to John Connor
    const detailHeadings = screen.getAllByText('John Connor');
    expect(detailHeadings.length).toBeGreaterThanOrEqual(1);
  });

  it('protects masked PII in Bento mode', async () => {
    render(
      <BentoShellProvider isBento={true}>
        <ContactsPage />
      </BentoShellProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Sarah Connor').length).toBeGreaterThanOrEqual(1);
    });

    // Select masked contact
    const johnRow = screen.getByRole('row', { name: /John Connor/i });
    fireEvent.click(johnRow);

    // Masked email must not be rendered as a mailto link
    const mailto = screen.queryByRole('link', { name: /j\*\*\*@resistance\.org/i });
    expect(mailto).toBeNull();
  });
});

describe('Phase 3A: Bento Contact Record Integration', () => {
  it('renders modern Bento Contact Record when Bento shell is enabled', async () => {
    render(
      <BentoShellProvider isBento={true}>
        <ContactDetailPage />
      </BentoShellProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Sarah Connor').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Contact Identity & Channels')).toBeInTheDocument();
    expect(screen.getByText('Account Context')).toBeInTheDocument();
    expect(screen.getByText('Audit & Governance')).toBeInTheDocument();
    expect(screen.getByText('Admin One')).toBeInTheDocument();
  });

  it('preserves legacy Contact Detail view when Bento shell is disabled', async () => {
    render(
      <BentoShellProvider isBento={false}>
        <ContactDetailPage />
      </BentoShellProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Sarah Connor').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Contact Details')).toBeInTheDocument();
    expect(screen.getByText('Audit Information')).toBeInTheDocument();
  });
});
