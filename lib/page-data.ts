/**
 * Shared data-loading helper for Server Components.
 *
 * Server Components run in the Node.js runtime where `fetch('/api/...')` has no
 * origin and throws `Failed to parse URL`. Rather than calling our own HTTP API
 * (which also means forwarding cookies and re-validating the session over the
 * network), Server Components call the service layer directly.
 *
 * The services already perform the full authorization sequence — session
 * validation, RBAC permission check, organization scoping and PII masking — so
 * calling them in-process preserves exactly the same guarantees as the HTTP
 * route would.
 *
 * `loadPageData` maps authorization outcomes onto page states instead of
 * silently rendering an empty list:
 *
 *   401 -> redirect to /login (never render protected shell)
 *   403 -> "you do not have access" notice
 *   404 -> "not found" notice (missing, or hidden by organization isolation)
 *   other -> "unable to load" notice (with the error logged server-side)
 */

import { redirect } from 'next/navigation';

export type PageLoadResult<T> =
  { ok: true; data: T } | { ok: false; reason: 'forbidden' | 'not-found' | 'error' };

function statusCodeOf(error: unknown): number | undefined {
  return (error as { statusCode?: number } | null | undefined)?.statusCode;
}

export async function loadPageData<T>(load: () => Promise<T>): Promise<PageLoadResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    const statusCode = statusCodeOf(error);

    // redirect() throws a control-flow error; it must not be swallowed.
    if (statusCode === 401) {
      redirect('/login');
    }

    if (statusCode === 403) {
      return { ok: false, reason: 'forbidden' };
    }

    if (statusCode === 404) {
      return { ok: false, reason: 'not-found' };
    }

    console.error('[server-page] failed to load data:', error);
    return { ok: false, reason: 'error' };
  }
}
