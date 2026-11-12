/**
 * Data-loading helper for portal Server Components.
 *
 * Same shape as `lib/page-data.ts`, but the failure states belong to the client
 * surface: an unauthenticated request goes to the portal login page (never the
 * team login), and a suspended/revoked access renders an explanation instead of a
 * generic notice.
 */

import { redirect } from 'next/navigation';

export type PortalPageResult<T> =
  { ok: true; data: T } | { ok: false; reason: 'inactive' | 'not-found' | 'error' };

function statusCodeOf(error: unknown): number | undefined {
  return (error as { statusCode?: number } | null | undefined)?.statusCode;
}

export async function loadPortalPageData<T>(load: () => Promise<T>): Promise<PortalPageResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    const statusCode = statusCodeOf(error);

    // redirect() throws a control-flow error; never swallow it.
    if (statusCode === 401) {
      redirect('/portal/login');
    }

    if (statusCode === 403) {
      return { ok: false, reason: 'inactive' };
    }

    if (statusCode === 404) {
      return { ok: false, reason: 'not-found' };
    }

    console.error('[portal-page] failed to load data:', error);
    return { ok: false, reason: 'error' };
  }
}
