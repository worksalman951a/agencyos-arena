/**
 * Unit tests for Better Auth origin configuration.
 *
 * Verifies that baseURL and trustedOrigins are resolved correctly from
 * environment variables for:
 * - Localhost development (default fallback)
 * - GitHub Codespaces forwarded HTTPS URLs (via BETTER_AUTH_URL / TRUSTED_ORIGINS)
 * - Arbitrary external origins are NOT trusted by default
 *
 * Prisma and better-auth are mocked so these tests run without a database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Shape of the config object passed to betterAuth() */
interface AuthConfig {
  baseURL: string;
  trustedOrigins: string[];
  advanced: {
    defaultCookieAttributes: {
      secure: boolean;
      sameSite: string;
      httpOnly: boolean;
      path: string;
    };
  };
  [key: string]: unknown;
}

const betterAuthMock = vi.fn((config: AuthConfig) => config);
const prismaAdapterMock = vi.fn((_prisma: unknown, opts: Record<string, unknown>) => opts);

vi.mock('better-auth', () => ({ betterAuth: betterAuthMock }));
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: prismaAdapterMock }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

const envKeys = ['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL', 'TRUSTED_ORIGINS', 'NODE_ENV'];

/** Set env vars and reset module registry so auth-server re-evaluates.
 * Explicitly stubs all four env keys so unspecified ones are deleted,
 * not left over from CI or previous tests. */
function applyEnv(env: Record<string, string | undefined>) {
  vi.unstubAllEnvs();
  for (const key of envKeys) {
    const value = env[key];
    if (value !== undefined) {
      vi.stubEnv(key, value);
    } else {
      vi.stubEnv(key, undefined); // explicitly delete unset vars
    }
  }
  vi.resetModules();
}

afterEach(() => {
  vi.unstubAllEnvs();
  betterAuthMock.mockClear();
  prismaAdapterMock.mockClear();
  vi.resetModules();
});

function getConfig() {
  return betterAuthMock.mock.calls[betterAuthMock.mock.calls.length - 1]?.[0] ?? null;
}

describe('Auth origin configuration', () => {
  it('preserves sign-in access during verification rollout and leaves vendor raw-token delivery disabled', async () => {
    applyEnv({ NODE_ENV: 'test' });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.emailAndPassword).toMatchObject({ requireEmailVerification: false });
    expect(config.emailVerification).toBeUndefined();
  });

  beforeEach(() => {
    betterAuthMock.mockClear();
    prismaAdapterMock.mockClear();
    vi.unstubAllEnvs();
  });

  it('defaults to localhost:3001 baseURL when no env vars are set', async () => {
    applyEnv({});
    vi.stubEnv('NODE_ENV', 'development');

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.baseURL).toBe('http://localhost:3001');
    expect(config.trustedOrigins).toEqual(['http://localhost:3001']);
    expect(config.advanced.defaultCookieAttributes.secure).toBe(false);
  });

  it('uses BETTER_AUTH_URL as baseURL when set', async () => {
    applyEnv({
      BETTER_AUTH_URL: 'https://curly-lamp-qv47qr54vqj5c96xx-3001.app.github.dev',
      NODE_ENV: 'development',
    });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.baseURL).toBe('https://curly-lamp-qv47qr54vqj5c96xx-3001.app.github.dev');
    expect(config.trustedOrigins).toEqual([
      'https://curly-lamp-qv47qr54vqj5c96xx-3001.app.github.dev',
    ]);
    expect(config.advanced.defaultCookieAttributes.secure).toBe(true);
  });

  it('falls back to NEXT_PUBLIC_APP_URL when BETTER_AUTH_URL is not set', async () => {
    applyEnv({
      NEXT_PUBLIC_APP_URL: 'https://example-codespace-3001.app.github.dev',
      NODE_ENV: 'development',
    });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.baseURL).toBe('https://example-codespace-3001.app.github.dev');
    expect(config.trustedOrigins).toEqual(['https://example-codespace-3001.app.github.dev']);
  });

  it('adds TRUSTED_ORIGINS entries alongside baseURL', async () => {
    applyEnv({
      BETTER_AUTH_URL: 'https://primary-3001.app.github.dev',
      TRUSTED_ORIGINS:
        'https://secondary-3001.app.github.dev, https://tertiary-3001.app.github.dev',
      NODE_ENV: 'development',
    });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.baseURL).toBe('https://primary-3001.app.github.dev');
    expect(config.trustedOrigins).toContain('https://primary-3001.app.github.dev');
    expect(config.trustedOrigins).toContain('https://secondary-3001.app.github.dev');
    expect(config.trustedOrigins).toContain('https://tertiary-3001.app.github.dev');
    expect(config.trustedOrigins.length).toBe(3);
  });

  it('deduplicates trustedOrigins when a TRUSTED_ORIGINS entry equals baseURL', async () => {
    applyEnv({
      BETTER_AUTH_URL: 'https://dup-3001.app.github.dev',
      TRUSTED_ORIGINS: 'https://dup-3001.app.github.dev, https://extra-3001.app.github.dev',
      NODE_ENV: 'development',
    });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    const dupCount = config.trustedOrigins.filter(
      (o) => o === 'https://dup-3001.app.github.dev'
    ).length;
    expect(dupCount).toBe(1);
    expect(config.trustedOrigins).toContain('https://extra-3001.app.github.dev');
    expect(config.trustedOrigins.length).toBe(2);
  });

  it('does not trust arbitrary external origins by default', async () => {
    applyEnv({
      BETTER_AUTH_URL: 'http://localhost:3001',
      TRUSTED_ORIGINS: '',
      NODE_ENV: 'development',
    });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.baseURL).toBe('http://localhost:3001');
    expect(config.trustedOrigins).toEqual(['http://localhost:3001']);
    expect(config.trustedOrigins).not.toContain(
      'https://curly-lamp-qv47qr54vqj5c96xx-3001.app.github.dev'
    );
  });

  it('sets secure cookie attribute to true for HTTPS baseURL', async () => {
    applyEnv({
      BETTER_AUTH_URL: 'https://curly-lamp-qv47qr54vqj5c96xx-3001.app.github.dev',
      NODE_ENV: 'development',
    });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.advanced.defaultCookieAttributes.secure).toBe(true);
    expect(config.advanced.defaultCookieAttributes.sameSite).toBe('lax');
    expect(config.advanced.defaultCookieAttributes.httpOnly).toBe(true);
  });

  it('sets secure cookie attribute to false for HTTP localhost', async () => {
    applyEnv({
      BETTER_AUTH_URL: 'http://localhost:3001',
      NODE_ENV: 'development',
    });

    await import('@/lib/auth-server');

    const config = getConfig() as AuthConfig;
    expect(config.advanced.defaultCookieAttributes.secure).toBe(false);
  });
});
