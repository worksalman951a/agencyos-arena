/**
 * Unit tests for the cross-origin decision used by middleware and the
 * Server-Action boundary (`lib/security/origin.ts`).
 *
 * These pin the contract, not the wiring:
 *  - unsafe methods need a trusted Origin (or Referer);
 *  - a missing origin on an unsafe method is refused, not assumed same-origin;
 *  - safe methods are never refused (navigations carry no Origin);
 *  - `null` origins, malformed values and look-alike hosts are untrusted;
 *  - the trusted list comes from configuration, never from request headers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_TOKEN_PATHS,
  checkRequestOrigin,
  isTrustedOrigin,
  trustedOrigins,
} from '@/lib/security/origin';

const APP = 'http://localhost:3001';

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request(`${APP}/api/v1/crm/accounts`, {
    method,
    headers,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('trustedOrigins', () => {
  it('defaults to the localhost application URL', () => {
    vi.stubEnv('BETTER_AUTH_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('TRUSTED_ORIGINS', '');
    // Empty strings are falsy, so the localhost fallback applies — same
    // precedence as lib/auth-server.ts.
    expect(trustedOrigins()).toEqual([APP]);
  });

  it('honours BETTER_AUTH_URL and additional TRUSTED_ORIGINS', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://agency.example');
    vi.stubEnv('TRUSTED_ORIGINS', 'https://app.example, https://preview.example');
    expect(trustedOrigins()).toEqual([
      'https://agency.example',
      'https://app.example',
      'https://preview.example',
    ]);
  });

  it('deduplicates an origin repeated in TRUSTED_ORIGINS', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://agency.example');
    vi.stubEnv('TRUSTED_ORIGINS', 'https://agency.example');
    expect(trustedOrigins()).toEqual(['https://agency.example']);
  });
});

describe('isTrustedOrigin', () => {
  const origins = ['https://agency.example'];

  it('accepts an exact match, including a path', () => {
    expect(isTrustedOrigin('https://agency.example', origins)).toBe(true);
    expect(isTrustedOrigin('https://agency.example/dashboard', origins)).toBe(true);
  });

  it('rejects a different host, scheme or port', () => {
    expect(isTrustedOrigin('https://agency.example.evil.com', origins)).toBe(false);
    expect(isTrustedOrigin('https://evilagency.example', origins)).toBe(false);
    expect(isTrustedOrigin('http://agency.example', origins)).toBe(false);
    expect(isTrustedOrigin('https://agency.example:8443', origins)).toBe(false);
  });

  it('rejects the opaque "null" origin, missing values and garbage', () => {
    expect(isTrustedOrigin('null', ['null'])).toBe(false);
    expect(isTrustedOrigin(null, origins)).toBe(false);
    expect(isTrustedOrigin('', origins)).toBe(false);
    expect(isTrustedOrigin('not a url', origins)).toBe(false);
    expect(isTrustedOrigin('javascript:alert(1)', origins)).toBe(false);
  });
});

describe('checkRequestOrigin', () => {
  const origins = [APP];

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('allows %s from the trusted origin', (method) => {
    const verdict = checkRequestOrigin(request(method, { origin: APP }), { origins });
    expect(verdict).toEqual({ ok: true, origin: APP });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s from a foreign origin', (method) => {
    const verdict = checkRequestOrigin(request(method, { origin: 'https://evil.example' }), {
      origins,
    });
    expect(verdict).toEqual({ ok: false, status: 403, reason: 'untrusted-origin' });
  });

  it('refuses an unsafe request with no Origin and no Referer', () => {
    expect(checkRequestOrigin(request('POST'), { origins })).toEqual({
      ok: false,
      status: 403,
      reason: 'missing-origin',
    });
  });

  it('refuses an unsafe request that only has a foreign Referer', () => {
    const verdict = checkRequestOrigin(request('POST', { referer: 'https://evil.example/form' }), {
      origins,
    });
    expect(verdict).toEqual({ ok: false, status: 403, reason: 'untrusted-origin' });
  });

  it('falls back to a trusted Referer when Origin is absent', () => {
    const verdict = checkRequestOrigin(request('POST', { referer: `${APP}/crm/accounts` }), {
      origins,
    });
    expect(verdict).toEqual({ ok: true, origin: `${APP}/crm/accounts` });
  });

  it('refuses a malformed Origin header rather than treating it as absent', () => {
    const verdict = checkRequestOrigin(request('POST', { origin: 'null' }), { origins });
    expect(verdict).toEqual({ ok: false, status: 403, reason: 'untrusted-origin' });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'never refuses %s, even with no Origin (navigations, Server Component fetches)',
    (method) => {
      expect(checkRequestOrigin(request(method), { origins }).ok).toBe(true);
    }
  );

  it('ignores X-Forwarded-Host / Forwarded when deciding (spoofable headers)', () => {
    // A cross-site POST that forges the forwarding headers must still fail:
    // only configured origins count.
    const verdict = checkRequestOrigin(
      request('POST', {
        origin: 'https://evil.example',
        'x-forwarded-host': 'localhost:3001',
        forwarded: 'host=localhost:3001',
      }),
      { origins }
    );
    expect(verdict.ok).toBe(false);
  });
});

describe('PUBLIC_TOKEN_PATHS', () => {
  it('lists the token-credential routes so the CSRF allow-list stays reviewable', () => {
    expect(PUBLIC_TOKEN_PATHS).toEqual(
      expect.arrayContaining([
        '/api/v1/invitations/',
        '/api/v1/portal/invitations/',
        '/api/v1/documents/links/',
      ])
    );
  });
});
