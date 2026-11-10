/**
 * Playwright fixtures for AgencyOS end-to-end tests.
 *
 * Every test gets its own user and its own organization, created through the
 * real HTTP endpoints (sign-up → bootstrap). Nothing is shared between tests,
 * nothing is written into an existing developer's organization, and no test
 * touches data it did not create itself.
 *
 * The suite is skipped when there is no database configured, so `npm run
 * test:e2e` behaves like `npm run test:integration`: it runs in CI (or against a
 * developer's isolated test database) and skips cleanly everywhere else.
 */

/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures receive a `use()` callback; it is not a React hook. */

import { expect, request as playwrightRequest, test as base } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-arena-password-2026';

/** Tests need a database and an auth secret; without them they are skipped. */
export const canRunE2E = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);

/** Same resolution order as playwright.config.ts; port 3001 belongs to AgencyOS. */
export const APP_URL =
  process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';

export interface TestAccount {
  email: string;
  password: string;
  organizationName: string;
  /** Value of the Better Auth session cookie. */
  sessionToken: string;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * POST with backoff while the auth rate limiter is throttling us.
 *
 * Better Auth rate-limits sign-up/sign-in per IP, and the whole suite runs from
 * one address. Rather than weaken that protection for tests, the fixture waits
 * for the window to pass — a deliberate 429 is not a product failure.
 */
async function postWithRateLimitRetry(
  api: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext['post']>[1],
  attempts = 4
): Promise<Awaited<ReturnType<APIRequestContext['post']>>> {
  let response = await api.post(path, options);
  for (let attempt = 1; attempt < attempts && response.status() === 429; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    response = await api.post(path, options);
  }
  return response;
}

function sessionCookieFrom(headers: Array<{ name: string; value: string }>): string | null {
  for (const header of headers) {
    if (header.name.toLowerCase() !== 'set-cookie') continue;
    const match = /better-auth\.session_token=([^;]+)/.exec(header.value);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

/**
 * Register a user, sign them in and bootstrap their organization.
 *
 * Mirrors the onboarding flow a real user goes through; the returned cookie is
 * what the browser would hold after logging in.
 */
export async function createAccount(api: APIRequestContext, label: string): Promise<TestAccount> {
  const email = `e2e-${label}-${uniqueSuffix()}@e2e.agencyos.invalid`;
  const organizationName = `E2E ${label} ${uniqueSuffix()}`;

  const signUp = await postWithRateLimitRetry(api, '/api/auth/sign-up/email', {
    // Better Auth enforces a same-origin check (CSRF); a raw HTTP client has to
    // send Origin explicitly, exactly like the browser does.
    headers: { Origin: APP_URL, Accept: 'application/json' },
    data: { email, password: E2E_PASSWORD, name: `E2E ${label}` },
  });
  expect(signUp.status(), `sign-up failed (${signUp.status()}): ${await signUp.text()}`).toBe(200);

  const signIn = await postWithRateLimitRetry(api, '/api/auth/sign-in/email', {
    headers: { Origin: APP_URL, Accept: 'application/json' },
    data: { email, password: E2E_PASSWORD },
  });
  expect(signIn.status(), `sign-in failed (${signIn.status()}): ${await signIn.text()}`).toBe(200);

  const sessionToken = sessionCookieFrom(await signIn.headersArray());
  expect(sessionToken, 'sign-in did not return a session cookie').toBeTruthy();

  const bootstrap = await postWithRateLimitRetry(api, '/api/auth/bootstrap-organization', {
    headers: {
      Cookie: `better-auth.session_token=${sessionToken}`,
      Origin: APP_URL,
      Accept: 'application/json',
    },
    data: { organizationName },
  });
  expect(bootstrap.status(), `bootstrap failed: ${await bootstrap.text()}`).toBe(200);

  return { email, password: E2E_PASSWORD, organizationName, sessionToken: sessionToken! };
}

/** Attach the account's session cookie to a browser context. */
export async function signInBrowser(
  context: BrowserContext,
  account: TestAccount,
  baseURL: string
): Promise<void> {
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: account.sessionToken,
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Guard shared by every spec: skip the whole file when there is no database. */
export function requireDatabase(): void {
  base.skip(!canRunE2E, 'E2E tests need DATABASE_URL and BETTER_AUTH_SECRET');
}

export interface E2EFixtures {
  appUrl: string;
  /** Page already authenticated as `account`. */
  authedPage: Page;
}

/**
 * Worker-scoped fixtures.
 *
 * One account is created per worker rather than per test: Better Auth rate-limits
 * the sign-up endpoint, and a release candidate should not need a rate-limit
 * exemption just to run its tests. Tests stay independent by creating their own
 * records inside the shared workspace, and the isolation test creates a second
 * account on purpose.
 */
export interface E2EWorkerFixtures {
  api: APIRequestContext;
  account: TestAccount;
}

/**
 * Extends the base test with an authenticated page.
 *
 * `account` is created per test (unique email + unique organization), so tests
 * stay independent and a failure never leaves another test with bad data.
 */
export const test = base.extend<E2EFixtures, E2EWorkerFixtures>({
  appUrl: async ({}, use) => {
    await use(APP_URL);
  },
  api: [
    async ({}, use) => {
      const context = await playwrightRequest.newContext({ baseURL: APP_URL });
      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],
  account: [
    async ({ api }, use) => {
      await use(await createAccount(api, 'account'));
    },
    { scope: 'worker' },
  ],
  authedPage: async ({ page, account, appUrl }, use) => {
    await signInBrowser(page.context(), account, appUrl);
    await use(page);
  },
});

export { expect };
