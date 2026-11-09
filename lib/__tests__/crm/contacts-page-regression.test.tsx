/**
 * Regression test for Contacts page loading-state loop.
 *
 * Verifies that contacts are fetched exactly once on initial load and that
 * no repeated fetching / loading-state loop occurs when the page is idle.
 * This guards against the bug where `toast` (a non-referentially-stable
 * function from `useToast()`) was included in the `useEffect` dependency
 * array, causing the effect to re-run on every render and triggering an
 * infinite fetch loop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import ContactsPage from '@/app/crm/contacts/page';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockPush = vi.fn();
const mockRefresh = vi.fn();

/** Query string exposed by the mocked useSearchParams(). */
let mockQueryString = '';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockQueryString),
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockContactsResponse = {
  contacts: [
    {
      id: 'contact_1',
      organizationId: 'org_1',
      accountId: null,
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      phone: '5551234567',
      status: 'active',
      source: 'website',
      isMasked: false,
      createdBy: null,
      updatedBy: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      deletedAt: null,
    },
  ],
  total: 1,
  totalPages: 1,
  page: 1,
};

function contactsApiCallCount() {
  return mockFetch.mock.calls.filter(
    ([url]) => typeof url === 'string' && url.includes('/api/v1/crm/contacts')
  ).length;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockQueryString = '';
  mockFetch.mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : String(url);
    if (u.includes('/api/v1/crm/contacts')) {
      return Promise.resolve(
        new Response(JSON.stringify(mockContactsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
  mockPush.mockReset();
  mockRefresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Contacts page - loading-state loop regression', () => {
  it('fetches contacts exactly once on initial load and does not re-fetch while idle', async () => {
    render(<ContactsPage />);

    // Wait for the initial contacts fetch to complete
    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    // Should be exactly 1 call on initial load
    expect(contactsApiCallCount()).toBe(1);

    // Wait additional time to catch any loading-state loop
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should still be exactly 1 call — no repeated fetching
    expect(contactsApiCallCount()).toBe(1);
  });

  it('shows loading state during initial fetch, then hides it', async () => {
    let resolveFetch: (val: Response) => void = () => {};
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts')) {
        return new Promise((resolve) => {
          resolveFetch = resolve as (val: Response) => void;
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    render(<ContactsPage />);

    // Should show loading state while fetch is pending
    expect(screen.getByText(/Loading contacts…/)).toBeInTheDocument();

    // Resolve the fetch
    resolveFetch(
      new Response(JSON.stringify(mockContactsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    // Loading state should be gone after fetch completes
    expect(screen.queryByText(/Loading contacts…/)).not.toBeInTheDocument();
  });

  it('does not enter a fetch loop when contacts list is empty', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts')) {
        return Promise.resolve(
          new Response(JSON.stringify({ contacts: [], total: 0, totalPages: 0, page: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    render(<ContactsPage />);

    // Wait for the empty state to render
    await waitFor(() => {
      expect(screen.getByText('No contacts found.')).toBeInTheDocument();
    });

    // Should be exactly 1 call even with empty results
    expect(contactsApiCallCount()).toBe(1);

    // Wait additional time to confirm no loop with empty data
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(contactsApiCallCount()).toBe(1);
  });
});

describe('Contacts page - soft-delete filter', () => {
  it('asks the API to exclude deleted contacts by default', async () => {
    render(<ContactsPage />);

    await waitFor(() => {
      expect(contactsApiCallCount()).toBe(1);
    });

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('includeDeleted=false');
  });

  it('requests deleted contacts only when the explicit filter is on', async () => {
    mockQueryString = 'includeDeleted=true';

    render(<ContactsPage />);

    await waitFor(() => {
      expect(contactsApiCallCount()).toBe(1);
    });

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('includeDeleted=true');
    expect(screen.getByRole('link', { name: 'Hide deleted' })).toHaveAttribute(
      'href',
      '/crm/contacts'
    );
  });

  it('marks deleted rows when the deleted filter is on', async () => {
    mockQueryString = 'includeDeleted=true';

    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              contacts: [
                {
                  ...mockContactsResponse.contacts[0],
                  deletedAt: '2026-02-03T10:30:00Z',
                },
              ],
              total: 1,
              totalPages: 1,
              page: 1,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    render(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Deleted').length).toBeGreaterThan(0);
    // A deleted row offers no Delete action (it is already deleted).
    expect(screen.queryByRole('button', { name: /^Delete$/ })).not.toBeInTheDocument();
  });
});

describe('Contacts page - delete confirmation', () => {
  it('uses an accessible dialog instead of window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText(/will be marked as deleted and removed from the contacts list/i)
    ).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();

    // Nothing is deleted until the dialog is confirmed.
    expect(
      mockFetch.mock.calls.some(
        ([, options]) => (options as RequestInit | undefined)?.method === 'DELETE'
      )
    ).toBe(false);

    confirmSpy.mockRestore();
  });
});
