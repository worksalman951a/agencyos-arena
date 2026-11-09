/**
 * Regression tests for the Contact Detail page.
 *
 * Two bugs are covered here:
 *
 * 1. Loading-state loop: `toast` (not referentially stable) was in the fetch
 *    effect dependency array, causing an infinite fetch loop.
 * 2. Next.js 16 params: the page destructured `params` synchronously
 *    (`const { id } = params;`). In Next.js 16 `params` is a Promise for client
 *    pages too, so `id` was undefined, the page requested
 *    `/api/v1/crm/contacts/undefined`, got a 404 and displayed
 *    "Contact not found." — and development mode raised
 *    "A param property was accessed directly with params.id".
 *
 * The original test passed a plain `params` object prop, which is not what
 * Next.js supplies. These tests drive the component through a mocked
 * `useParams()` instead, so a regression to synchronous/undefined params fails.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import ContactDetailPage from '@/app/crm/contacts/[id]/page';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockRouter = { push: mockPush, refresh: mockRefresh };

/** Route params returned by the mocked useParams(). */
let mockParams: Record<string, string> = { id: 'contact_1' };

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => mockParams,
}));

const mockContact = {
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
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function contactApiCalls() {
  return mockFetch.mock.calls.filter(
    ([url]) => typeof url === 'string' && url.includes('/api/v1/crm/contacts/')
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockParams = { id: 'contact_1' };
  mockFetch.mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : String(url);
    if (u.includes('/api/v1/crm/contacts/')) {
      return jsonResponse(mockContact);
    }
    return jsonResponse({});
  });
  mockPush.mockReset();
  mockRefresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Contact Detail page - route params', () => {
  it('requests the contact using the route id', async () => {
    mockParams = { id: 'contact_abc123' };

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(contactApiCalls().length).toBe(1);
    });

    // The exact id from the route must reach the API — never "undefined".
    expect(contactApiCalls()[0][0]).toBe('/api/v1/crm/contacts/contact_abc123');
    expect(contactApiCalls()[0][0]).not.toContain('undefined');
  });

  it('does not request the API and reports not-found when the route id is missing', async () => {
    mockParams = {};

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Contact not found.')).toBeInTheDocument();
    });

    expect(contactApiCalls().length).toBe(0);
  });

  it('escapes the route id before interpolating it into the API URL', async () => {
    mockParams = { id: 'contact/../admin' };

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(contactApiCalls().length).toBe(1);
    });

    expect(contactApiCalls()[0][0]).toBe('/api/v1/crm/contacts/contact%2F..%2Fadmin');
  });
});

describe('Contact Detail page - API outcomes', () => {
  it('renders the contact when the API returns it', async () => {
    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('jane@example.com • 5551234567')).toBeInTheDocument();
    expect(screen.queryByText('Contact not found.')).not.toBeInTheDocument();
    expect(screen.queryByText('Unable to load contact.')).not.toBeInTheDocument();
  });

  it('shows "Contact not found." for a 404 (missing, deleted or cross-org contact)', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return jsonResponse({ error: 'Not found' }, 404);
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Contact not found.')).toBeInTheDocument();
    });

    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Unable to load contact.')).not.toBeInTheDocument();
  });

  it('shows an error state (not "not found") when the API fails with 500', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return jsonResponse({ error: 'Internal server error' }, 500);
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load contact.')).toBeInTheDocument();
    });

    expect(screen.queryByText('Contact not found.')).not.toBeInTheDocument();
  });

  it('shows the error state when the request itself rejects', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return Promise.reject(new Error('network down'));
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load contact.')).toBeInTheDocument();
    });
  });

  it('redirects to /login on 401 instead of showing not-found', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return jsonResponse({ error: 'Unauthenticated' }, 401);
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
    expect(screen.queryByText('Contact not found.')).not.toBeInTheDocument();
  });

  it('retries the request after a failure', async () => {
    let attempt = 0;
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        attempt += 1;
        return attempt === 1 ? jsonResponse({}, 500) : jsonResponse(mockContact);
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load contact.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
    expect(contactApiCalls().length).toBe(2);
  });
});

describe('Contact Detail page - loading-state loop regression', () => {
  it('fetches the contact exactly once on initial load and does not re-fetch while idle', async () => {
    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(contactApiCalls().length).toBe(1);

    // Wait additional time to catch any loading-state loop
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(contactApiCalls().length).toBe(1);
  });

  it('shows loading state during initial fetch, then hides it', async () => {
    let resolveFetch: (val: Response) => void = () => {};
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return new Promise((resolve) => {
          resolveFetch = resolve as (val: Response) => void;
        });
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    expect(screen.getByText(/Loading contact…/)).toBeInTheDocument();

    resolveFetch(
      new Response(JSON.stringify(mockContact), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Loading contact…/)).not.toBeInTheDocument();
  });

  it('deletes the contact and navigates back to the contacts list', async () => {
    const mockConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    mockFetch.mockImplementation((url: string | URL, options?: RequestInit) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/') && options?.method === 'DELETE') {
        return jsonResponse({ id: 'contact_1', deletedAt: new Date() });
      }
      if (u.includes('/api/v1/crm/contacts/')) {
        return jsonResponse(mockContact);
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(contactApiCalls().length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/crm/contacts');
    });

    expect(mockConfirm).toHaveBeenCalledWith('Are you sure you want to delete this contact?');
    expect(
      contactApiCalls().some(
        ([url, options]) => options?.method === 'DELETE' && url.includes('contact_1')
      )
    ).toBe(true);

    mockConfirm.mockRestore();
  });
});
