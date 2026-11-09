/**
 * Tests for the Server Component data-loading helper.
 *
 * Server Components now call the service layer in-process instead of fetching
 * their own API over HTTP. `loadPageData` maps the authorization outcomes the
 * services throw onto page states, so a permission problem is never rendered as
 * a misleading empty table (the previous behaviour was `if (!res.ok) return []`).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

function errorWithStatus(message: string, statusCode: number) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

describe('loadPageData', () => {
  it('returns the data on success', async () => {
    const result = await loadPageData(async () => [{ id: 'a' }]);

    expect(result).toEqual({ ok: true, data: [{ id: 'a' }] });
  });

  it('redirects to /login when the service reports 401', async () => {
    // next/navigation's redirect() throws a NEXT_REDIRECT control-flow error.
    await expect(
      loadPageData(async () => {
        throw errorWithStatus('Unauthenticated', 401);
      })
    ).rejects.toMatchObject({ digest: expect.stringContaining('/login') });
  });

  it('reports forbidden for 403 instead of rendering an empty list', async () => {
    const result = await loadPageData(async () => {
      throw errorWithStatus('Forbidden: insufficient permissions', 403);
    });

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('reports not-found for 404', async () => {
    const result = await loadPageData(async () => {
      throw errorWithStatus('Not found', 404);
    });

    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('reports a generic error for anything else', async () => {
    const result = await loadPageData(async () => {
      throw errorWithStatus('Database unavailable', 500);
    });

    expect(result).toEqual({ ok: false, reason: 'error' });
  });

  it('reports a generic error when the failure has no status code', async () => {
    const result = await loadPageData(async () => {
      throw new Error('boom');
    });

    expect(result).toEqual({ ok: false, reason: 'error' });
  });
});

describe('PageStateNotice', () => {
  it('explains a permission problem and offers a way back', () => {
    render(<PageStateNotice reason="forbidden" backHref="/crm/contacts" backLabel="Back" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/crm/contacts');
  });

  it('explains a missing record', () => {
    render(<PageStateNotice reason="not-found" />);

    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('explains a load failure', () => {
    render(<PageStateNotice reason="error" />);

    expect(screen.getByText(/unable to load/i)).toBeInTheDocument();
  });
});
