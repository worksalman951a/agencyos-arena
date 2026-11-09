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
  createdByUser: null,
  updatedByUser: null,
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

  it('asks for confirmation in an accessible dialog before deleting', async () => {
    // window.confirm must never be used again: it is blocking, unstyled and
    // untestable. The confirmation lives in the design-system AlertDialog.
    const confirmSpy = vi.spyOn(window, 'confirm');

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

    // Opening the dialog must not delete anything yet.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText(/will be marked as deleted and removed from the contacts list/i)
    ).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(contactApiCalls().some(([, options]) => options?.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Delete contact' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/crm/contacts');
    });

    expect(
      contactApiCalls().some(
        ([url, options]) => options?.method === 'DELETE' && url.includes('contact_1')
      )
    ).toBe(true);

    confirmSpy.mockRestore();
  });

  it('cancelling the dialog leaves the contact untouched', async () => {
    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    expect(contactApiCalls().some(([, options]) => options?.method === 'DELETE')).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('Contact Detail page - actions', () => {
  it('does not offer a redundant "New Contact" action on a contact', async () => {
    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    // Creating a contact belongs to the Contacts list page.
    expect(screen.queryByRole('link', { name: /new contact/i })).not.toBeInTheDocument();
  });

  it('keeps Edit and Back to Contacts', async () => {
    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/crm/contacts/contact_1/edit'
    );
    expect(screen.getByRole('link', { name: /Back to Contacts/i })).toHaveAttribute(
      'href',
      '/crm/contacts'
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});

describe('Contact Detail page - audit identities', () => {
  it('shows resolved creator and updater names instead of raw user ids', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return jsonResponse({
          ...mockContact,
          createdBy: 'user_creator_1',
          updatedBy: 'user_updater_2',
          createdByUser: { id: 'user_creator_1', name: 'Ada Lovelace' },
          updatedByUser: { id: 'user_updater_2', name: 'Grace Hopper' },
        });
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });

    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    // Raw database ids must not be the displayed value.
    expect(screen.queryByText('user_creator_1')).not.toBeInTheDocument();
    expect(screen.queryByText('user_updater_2')).not.toBeInTheDocument();
  });

  it('says the user is unavailable when identity cannot be resolved', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return jsonResponse({
          ...mockContact,
          createdBy: 'user_creator_1',
          updatedBy: null,
          createdByUser: null,
          updatedByUser: null,
        });
      }
      return jsonResponse({});
    });

    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('User unavailable')).toBeInTheDocument();
    });

    expect(screen.queryByText('user_creator_1')).not.toBeInTheDocument();
    // No creator/updater at all renders an em dash, not an empty cell.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('Contact Detail page - soft-deleted contact', () => {
  const deletedContact = {
    ...mockContact,
    deletedAt: '2026-02-03T10:30:00Z',
  };

  beforeEach(() => {
    mockFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.includes('/api/v1/crm/contacts/')) {
        return jsonResponse(deletedContact);
      }
      return jsonResponse({});
    });
  });

  it('shows a clear deleted-state banner instead of presenting it as active', async () => {
    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('This contact has been deleted')).toBeInTheDocument();
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/no longer appears in the contacts list/i)).toBeInTheDocument();
  });

  it('does not offer Edit or Delete for a deleted contact', async () => {
    render(<ContactDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('This contact has been deleted')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // Navigation back to the list must remain available.
    expect(screen.getByRole('link', { name: /Back to Contacts/i })).toBeInTheDocument();
  });
});
