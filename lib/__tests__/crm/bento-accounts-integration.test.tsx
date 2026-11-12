import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BentoAccountsView, type AccountItem } from '@/components/crm/bento-accounts-view';
import {
  BentoAccountRecordView,
  type AccountDetailRecord,
} from '@/components/crm/bento-account-record-view';
import { AccountsClient } from '@/app/crm/accounts/accounts-client';
import { AccountDetailClient } from '@/app/crm/accounts/[id]/account-detail-client';
import { BentoShellProvider } from '@/components/providers/bento-theme-provider';

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

const mockAccounts: AccountItem[] = [
  {
    id: 'acc-1',
    organizationId: 'org-1',
    name: 'Acme Corp',
    website: 'https://acme.com',
    address: '123 Market St, San Francisco, CA',
    status: 'active',
    contactCount: 5,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    deletedAt: null,
  },
  {
    id: 'acc-2',
    organizationId: 'org-1',
    name: 'Beta Global',
    website: null,
    address: null,
    status: 'inactive',
    contactCount: 0,
    createdAt: new Date('2026-03-10T00:00:00Z'),
    updatedAt: new Date('2026-03-11T00:00:00Z'),
    deletedAt: null,
  },
];

const mockDetailAccount: AccountDetailRecord = {
  id: 'acc-1',
  organizationId: 'org-1',
  name: 'Acme Corp',
  website: 'https://acme.com',
  address: '123 Market St, San Francisco, CA',
  status: 'active',
  contactCount: 2,
  contacts: [
    {
      id: 'con-1',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@acme.com',
      phone: '+1 555-0100',
    },
    {
      id: 'con-2',
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@acme.com',
      phone: null,
    },
  ],
  createdAt: new Date('2026-01-15T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  deletedAt: null,
};

describe('Bento Accounts Integration Suite (Phase 3B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BentoAccountsView Component', () => {
    it('renders accounts list with count and initials badge', () => {
      render(
        <BentoAccountsView
          accounts={mockAccounts}
          total={2}
          totalPages={1}
          page={1}
          searchVal=""
          onSearchChange={vi.fn()}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument();
      expect(screen.getByText('2 accounts in your organization workspace')).toBeInTheDocument();

      const acmeElements = screen.getAllByText('Acme Corp');
      expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Beta Global')).toBeInTheDocument();
      expect(screen.getAllByText('123 Market St, San Francisco, CA').length).toBeGreaterThanOrEqual(
        1
      );
    });

    it('updates selected account in the detail rail when row is clicked', () => {
      render(
        <BentoAccountsView
          accounts={mockAccounts}
          total={2}
          totalPages={1}
          page={1}
          searchVal=""
          onSearchChange={vi.fn()}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      expect(screen.getByRole('heading', { level: 2, name: 'Acme Corp' })).toBeInTheDocument();

      const secondRow = screen.getByRole('row', { name: /Beta Global/i });
      fireEvent.click(secondRow);

      expect(screen.getByRole('heading', { level: 2, name: 'Beta Global' })).toBeInTheDocument();
      expect(screen.getByText('No website listed')).toBeInTheDocument();
    });

    it('dispatches search callback when search form is submitted', () => {
      const handleSearch = vi.fn();
      render(
        <BentoAccountsView
          accounts={mockAccounts}
          total={2}
          totalPages={1}
          page={1}
          searchVal=""
          onSearchChange={handleSearch}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      const searchInput = screen.getByLabelText('Search accounts');
      fireEvent.change(searchInput, { target: { value: 'Acme' } });
      fireEvent.submit(searchInput.closest('form')!);

      expect(handleSearch).toHaveBeenCalledWith('Acme');
    });

    it('renders empty state properly when accounts list is empty', () => {
      render(
        <BentoAccountsView
          accounts={[]}
          total={0}
          totalPages={0}
          page={1}
          searchVal="NonExistent"
          onSearchChange={vi.fn()}
          onDeleteRequest={vi.fn()}
          deletingId={null}
        />
      );

      expect(screen.getByText('No accounts match “NonExistent”')).toBeInTheDocument();
    });
  });

  describe('BentoAccountRecordView Component', () => {
    it('renders account identity, stat strip, and affiliated contacts', () => {
      render(
        <BentoAccountRecordView
          account={mockDetailAccount}
          onDeleteRequest={vi.fn()}
          deleting={false}
        />
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Acme Corp' })).toBeInTheDocument();
      expect(screen.getByText('Website Verified')).toBeInTheDocument();
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('alice@acme.com')).toBeInTheDocument();
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
      expect(screen.getByText('bob@acme.com')).toBeInTheDocument();
      expect(screen.getByText('People at Acme Corp (2)')).toBeInTheDocument();
    });

    it('renders soft-deleted banner and omits edit/delete buttons when deletedAt is present', () => {
      const deletedAccount: AccountDetailRecord = {
        ...mockDetailAccount,
        deletedAt: new Date('2026-04-01T12:00:00Z'),
      };

      render(
        <BentoAccountRecordView
          account={deletedAccount}
          onDeleteRequest={vi.fn()}
          deleting={false}
        />
      );

      expect(screen.getByText('This account has been deleted')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
    });
  });

  describe('Dual-Presentation & Client Controller Parity', () => {
    it('switches between Bento and Legacy directory layout based on isBento flag', () => {
      const { rerender } = render(
        <BentoShellProvider isBento={false}>
          <AccountsClient accounts={mockAccounts} total={2} totalPages={1} page={1} searchVal="" />
        </BentoShellProvider>
      );

      expect(
        screen.getByText('Manage your client organizations and companies (2 total)')
      ).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();

      rerender(
        <BentoShellProvider isBento={true}>
          <AccountsClient accounts={mockAccounts} total={2} totalPages={1} page={1} searchVal="" />
        </BentoShellProvider>
      );

      expect(screen.getByText('2 accounts in your organization workspace')).toBeInTheDocument();
      expect(screen.getByText('Account Overview')).toBeInTheDocument();
    });

    it('switches between Bento and Legacy detail layout based on isBento flag', () => {
      const { rerender } = render(
        <BentoShellProvider isBento={false}>
          <AccountDetailClient account={mockDetailAccount} />
        </BentoShellProvider>
      );

      expect(screen.getByText('Company Details')).toBeInTheDocument();

      rerender(
        <BentoShellProvider isBento={true}>
          <AccountDetailClient account={mockDetailAccount} />
        </BentoShellProvider>
      );

      expect(screen.getByText('Company Identity & Web')).toBeInTheDocument();
      expect(screen.getByText('Commercial Triggers')).toBeInTheDocument();
    });

    it('triggers DELETE request when delete button is confirmed', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as unknown as Response)
      );

      render(
        <BentoShellProvider isBento={true}>
          <AccountsClient accounts={mockAccounts} total={2} totalPages={1} page={1} searchVal="" />
        </BentoShellProvider>
      );

      const deleteBtn = screen.getByRole('button', { name: /Delete/i });
      fireEvent.click(deleteBtn);

      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('/api/v1/crm/accounts/acc-1', {
          method: 'DELETE',
        });
        expect(mockRefresh).toHaveBeenCalled();
      });

      confirmSpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });
});

describe('Website URL Safe Protocols in Rendered Output', () => {
  it('does not render href with javascript: protocol on account cards or detail view', () => {
    const maliciousAccount: AccountItem = {
      id: 'acc-malicious',
      organizationId: 'org-1',
      name: 'Malicious Corp',
      website: 'javascript:alert(document.cookie)',
      address: '100 Evil Way',
      status: 'active',
      contactCount: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
    };

    const { container } = render(
      <BentoAccountsView
        accounts={[maliciousAccount]}
        total={1}
        totalPages={1}
        page={1}
        searchVal=""
        onSearchChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        deletingId={null}
      />
    );

    // Verify no <a> tag has href containing "javascript:"
    const links = container.querySelectorAll('a');
    for (const link of links) {
      expect(link.getAttribute('href')).not.toMatch(/^javascript:/i);
    }
  });
});

describe('PII Masking Regression Check on Bento Contacts', () => {
  it('ensures contact row aria-label uses "Protected contact" when isMasked is true', async () => {
    const { BentoContactsView } = await import('@/components/crm/bento-contacts-view');

    const maskedContact = {
      id: 'con-1',
      organizationId: 'org-1',
      name: 'Jane Doe',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'j***@example.com',
      phone: '***-***-1234',
      title: 'VP Sales',
      status: 'active',
      source: null,
      isMasked: true,
      createdBy: null,
      updatedBy: null,
      accountId: 'acc-1',
      account: { id: 'acc-1', name: 'Acme Corp' },
      openDealsCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    const { container } = render(
      <BentoContactsView
        contacts={[maskedContact]}
        total={1}
        totalPages={1}
        page={1}
        isLoading={false}
        searchVal=""
        includeDeleted={false}
        onSearchChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        deletingId={null}
      />
    );

    const row = screen.getByRole('row', { name: /Jane Doe, Protected contact/i });
    expect(row).toBeInTheDocument();
    expect(row.getAttribute('aria-label')).not.toContain('j***@example.com');

    const ariaLabels = Array.from(container.querySelectorAll('[aria-label]')).map((el) =>
      el.getAttribute('aria-label')
    );
    for (const label of ariaLabels) {
      expect(label).not.toContain('j***@example.com');
    }
  });
});
