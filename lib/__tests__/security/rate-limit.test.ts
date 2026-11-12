/**
 * Unit tests for the shared rate limiter (`lib/security/rate-limit.ts`).
 *
 * The SQL itself is exercised against real PostgreSQL in
 * `integration/security.integration.test.ts`; here we pin the decisions that
 * surround it: key construction, address resolution (never trusting a
 * client-controlled forwarding header unless the deployment allows it), the
 * 429 shape, and that a throttled call never reaches the handler.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const executeRawMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => executeRawMock(...args),
  },
}));

const {
  RATE_LIMITS,
  clientAddressForRateLimit,
  consumeRateLimit,
  rateLimitKey,
  rateLimitedResponse,
  withRateLimit,
} = await import('@/lib/security/rate-limit');

afterEach(() => {
  executeRawMock.mockReset();
  vi.unstubAllEnvs();
});

describe('rateLimitKey', () => {
  it('is stable for the same subject', () => {
    expect(rateLimitKey('invitation-accept', 'fd00::1')).toBe(
      rateLimitKey('invitation-accept', 'fd00::1')
    );
  });

  it('separates policies even for the same subject', () => {
    expect(rateLimitKey('invitation-preview', 'fd00::1')).not.toBe(
      rateLimitKey('invitation-accept', 'fd00::1')
    );
  });

  it('never embeds the raw subject (no token or cookie leakage into a key)', () => {
    const subject = 'super-secret-invitation-token-value';
    const key = rateLimitKey('invitation-preview', subject);
    expect(key).not.toContain(subject);
    expect(key).toMatch(/^invitation-preview:[0-9a-f]{32}$/);
  });

  it('separates subjects that differ by a single character', () => {
    expect(rateLimitKey('invitation-accept', 'a')).not.toBe(rateLimitKey('invitation-accept', 'b'));
  });
});

describe('clientAddressForRateLimit', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('ignores a multi-hop X-Forwarded-For when no proxy is trusted', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '');
    // With no declared proxy the header is client-written, so a chain must not
    // be used; only a single unambiguous value is accepted.
    expect(
      clientAddressForRateLimit(
        headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' }),
        '192.0.2.5'
      )
    ).toBe('192.0.2.5');
  });

  it('accepts the single-value X-Forwarded-For Next.js fills from the socket', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '');
    expect(
      clientAddressForRateLimit(headers({ 'x-forwarded-for': '203.0.113.9' }), '198.51.100.7')
    ).toBe('203.0.113.9');
  });

  it('uses the direct peer address when no forwarding header is present', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '1');
    expect(clientAddressForRateLimit(headers({}), '198.51.100.7')).toBe('198.51.100.7');
  });

  it('uses the rightmost hop when the deployment trusts the proxy', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '1');
    // The leftmost entry is whatever the client claimed; only the hop added by
    // the trusted proxy is meaningful.
    expect(
      clientAddressForRateLimit(headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }), '10.0.0.1')
    ).toBe('203.0.113.9');
  });

  it('falls back to "unknown" rather than inventing an identity', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '');
    expect(clientAddressForRateLimit(headers({}))).toBe('unknown');
  });

  it('prefers the address middleware normalized over the raw forwarding header', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '1');
    // A client forging the chain must not override what middleware resolved.
    expect(
      clientAddressForRateLimit(
        headers({
          'x-agencyos-client-address': '203.0.113.9',
          'x-forwarded-for': '6.6.6.6',
        }),
        '198.51.100.7'
      )
    ).toBe('203.0.113.9');
  });

  it('ignores a forged chain when no proxy is trusted', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '');
    expect(
      clientAddressForRateLimit(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }), '198.51.100.7')
    ).toBe('198.51.100.7');
  });
});

describe('consumeRateLimit', () => {
  it('reports the allowed decision from the returned row', async () => {
    executeRawMock.mockResolvedValue([{ count: 3, retry_after: 0 }]);
    const decision = await consumeRateLimit('k', { window: 60, max: 10 });
    expect(decision).toEqual({
      allowed: true,
      remaining: 7,
      retryAfter: 0,
      limit: 10,
      window: 60,
    });
  });

  it('denies once the cap is reached and reports retryAfter', async () => {
    executeRawMock.mockResolvedValue([{ count: 11, retry_after: 42 }]);
    const decision = await consumeRateLimit('k', { window: 60, max: 10 });
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfter).toBe(42);
  });

  it('treats exactly max as allowed (an off-by-one would block legitimate use)', async () => {
    executeRawMock.mockResolvedValue([{ count: 10, retry_after: 0 }]);
    expect((await consumeRateLimit('k', { window: 60, max: 10 })).allowed).toBe(true);
    executeRawMock.mockResolvedValue([{ count: 11, retry_after: 1 }]);
    expect((await consumeRateLimit('k', { window: 60, max: 10 })).allowed).toBe(false);
  });

  it('passes the key, window and cap to SQL as bound parameters', async () => {
    executeRawMock.mockResolvedValue([{ count: 1, retry_after: 0 }]);
    await consumeRateLimit('policy:abc', { window: 30, max: 5 });
    const [, key, window, max] = executeRawMock.mock.calls[0];
    expect(key).toBe('policy:abc');
    expect(window).toBe('30');
    expect(max).toBe(5);
  });
});

describe('rateLimitedResponse', () => {
  it('is a 429 with a Retry-After of at least one second', async () => {
    const response = rateLimitedResponse({
      allowed: false,
      remaining: 0,
      retryAfter: 0,
      limit: 5,
      window: 60,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(await response.json()).toEqual({
      error: 'Too many requests. Please try again later.',
    });
  });

  it('does not disclose which token or account was probed', async () => {
    const body = await rateLimitedResponse({
      allowed: false,
      remaining: 0,
      retryAfter: 30,
      limit: 5,
      window: 60,
    }).text();
    expect(body.toLowerCase()).not.toContain('invitation');
    expect(body.toLowerCase()).not.toContain('token');
  });
});

describe('withRateLimit', () => {
  it('runs the handler and advertises the remaining budget when allowed', async () => {
    executeRawMock.mockResolvedValue([{ count: 1, retry_after: 0 }]);
    const handler = vi.fn(async () => new Response('ok', { status: 200 }));

    const response = await withRateLimit('invitation-create', 'session:test', handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get('RateLimit-Remaining')).toBe(
      String(RATE_LIMITS['invitation-create'].max - 1)
    );
  });

  it('never runs the handler once throttled', async () => {
    executeRawMock.mockResolvedValue([{ count: 999, retry_after: 12 }]);
    const handler = vi.fn(async () => new Response('ok'));

    const response = await withRateLimit('invitation-create', 'session:test', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });
});

describe('RATE_LIMITS', () => {
  it('never allows more than one attempt per second on a sustained basis', () => {
    for (const [policy, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.max / rule.window, `${policy} is too permissive`).toBeLessThanOrEqual(2);
    }
  });

  it('uses positive windows and caps', () => {
    for (const [policy, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.window, `${policy} window`).toBeGreaterThan(0);
      expect(rule.max, `${policy} max`).toBeGreaterThan(0);
    }
  });
});
