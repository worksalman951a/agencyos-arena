/**
 * Unit tests for `middleware.ts`: the layer that actually enforces the origin
 * rule over `/api/v1/*` and `bootstrap-organization`, and that owns address
 * normalization for rate limiting.
 *
 * These call the exported middleware function with real `Request` objects, so
 * they assert the routing decisions rather than a helper's opinion of them.
 * The end-to-end version (a live server, real cookies) lives in
 * `integration/security.integration.test.ts`; this file is the fast guard that
 * runs on every unit-test invocation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieGet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
}));

const { middleware } = await import('@/middleware');

const APP = 'http://localhost:3001';
const CLIENT_ADDRESS_HEADER = 'x-agencyos-client-address';

function req(pathname: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Request(`${APP}${pathname}`, { method, headers });
}

/** Header bag a `NextResponse.next({ request: { headers } })` carries forward. */
function forwardedHeaders(response: Response): Headers {
  // NextResponse stores the mutated request headers on the internal headers;
  // for `next()` the entry surfaces as `x-middleware-request-*` overrides.
  return (response as unknown as { headers: Headers }).headers;
}

beforeEach(() => {
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: 'session-token' });
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware CSRF enforcement', () => {
  it('rejects a foreign-origin POST to /api/v1', async () => {
    const response = await middleware(
      req('/api/v1/crm/accounts', 'POST', { origin: 'https://evil.example' })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Cross-origin request rejected' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects a POST to /api/v1 with no Origin and no Referer', async () => {
    const response = await middleware(req('/api/v1/crm/accounts', 'POST'));
    expect(response.status).toBe(403);
  });

  it('lets a trusted-origin POST through to the handler', async () => {
    const response = await middleware(req('/api/v1/crm/accounts', 'POST', { origin: APP }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('lets a trusted Referer through when Origin is absent', async () => {
    const response = await middleware(
      req('/api/v1/crm/accounts', 'POST', { referer: `${APP}/crm/accounts/new` })
    );
    expect(response.status).toBe(200);
  });

  it('rejects foreign-origin PUT/PATCH/DELETE across modules', async () => {
    for (const [path, method] of [
      ['/api/v1/portal/approvals/abc/respond', 'POST'],
      ['/api/v1/settings/organization', 'PUT'],
      ['/api/v1/portal/preferences', 'PUT'],
      ['/api/v1/admin/invitations', 'POST'],
      ['/api/v1/documents/links', 'DELETE'],
    ] as const) {
      const response = await middleware(req(path, method, { origin: 'https://evil.example' }));
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it('protects the bootstrap handler that lives outside Better Auth', async () => {
    const blocked = await middleware(
      req('/api/auth/bootstrap-organization', 'POST', { origin: 'https://evil.example' })
    );
    expect(blocked.status).toBe(403);

    const allowed = await middleware(
      req('/api/auth/bootstrap-organization', 'POST', { origin: APP })
    );
    expect(allowed.status).toBe(200);
  });

  it('leaves Better Auth endpoints to the vendor check', async () => {
    // Not 403-with-our-body: the request must reach Better Auth, which applies
    // its own origin + Fetch Metadata validation.
    const response = await middleware(
      req('/api/auth/sign-in/email', 'POST', { origin: 'https://evil.example' })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('never refuses safe methods from any origin', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const response = await middleware(
        req('/api/v1/crm/accounts', method, { origin: 'https://evil.example' })
      );
      expect(response.status, method).toBeLessThan(400);
    }
  });

  it('protects token endpoints without exempting them from CSRF', async () => {
    const blocked = await middleware(
      req('/api/v1/portal/invitations/tok/accept', 'POST', { origin: 'https://evil.example' })
    );
    expect(blocked.status).toBe(403);
  });
});

describe('middleware client-address normalization', () => {
  it('overwrites a client-supplied address header', async () => {
    const response = await middleware(
      req('/api/v1/crm/accounts', 'GET', {
        [CLIENT_ADDRESS_HEADER]: '9.9.9.9',
        'x-forwarded-for': '203.0.113.7',
      })
    );
    const forwarded = forwardedHeaders(response).get(
      `x-middleware-request-${CLIENT_ADDRESS_HEADER}`
    );
    expect(forwarded).toBe('203.0.113.7');
    expect(forwarded).not.toBe('9.9.9.9');
  });

  it('ignores a forged chain unless the deployment trusts a proxy', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '');
    const response = await middleware(
      req('/api/v1/crm/accounts', 'GET', { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    );
    const forwarded = forwardedHeaders(response).get(
      `x-middleware-request-${CLIENT_ADDRESS_HEADER}`
    );
    // A chain with no declared proxy is client-written and must not be used.
    expect(forwarded).toBeNull();
  });

  it('uses the last hop when a proxy is trusted', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '1');
    const response = await middleware(
      req('/api/v1/crm/accounts', 'GET', { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })
    );
    expect(forwardedHeaders(response).get(`x-middleware-request-${CLIENT_ADDRESS_HEADER}`)).toBe(
      '203.0.113.7'
    );
  });
});

describe('middleware session gate (unchanged behaviour)', () => {
  it('redirects an unauthenticated page request to /login', async () => {
    cookieGet.mockReturnValue(undefined);
    const response = await middleware(req('/dashboard'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${APP}/login`);
  });

  it('redirects an unauthenticated portal request to /portal/login', async () => {
    cookieGet.mockReturnValue(undefined);
    const response = await middleware(req('/portal/projects'));
    expect(response.headers.get('location')).toBe(`${APP}/portal/login`);
  });

  it('allows a signed-in page request through', async () => {
    const response = await middleware(req('/dashboard'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
