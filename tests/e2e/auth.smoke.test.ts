/**
 * E2E smoke tests for authentication flows.
 *
 * These tests run in a real browser (Chromium) against a running dev server.
 * Requires DATABASE_URL and BETTER_AUTH_SECRET environment variables.
 * Skips gracefully if prerequisites are not available.
 */

import { test, expect } from '@playwright/test';

const canRun = !!(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);

// Port 3000 is reserved for a different local project; AgencyOS runs on 3001.
const baseURL = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';

test.describe('Auth smoke tests', () => {
  test.use({ baseURL });

  test.skip(!canRun, 'Skipping E2E auth smoke test: DATABASE_URL or BETTER_AUTH_SECRET not set');

  test('registration page loads successfully', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL('/register');
    await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible();
  });

  test('login page loads successfully', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });

  test('dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('landing page redirects unauthenticated visitors to login', async ({ page }) => {
    await page.goto('/');
    // "/" is a client-side router that sends visitors without a session to /login.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });
});

test.describe('Auth HTTP smoke tests', () => {
  test.use({ baseURL });

  test.skip(
    !canRun,
    'Skipping E2E auth HTTP smoke test: DATABASE_URL or BETTER_AUTH_SECRET not set'
  );

  test('should register a user through the Better Auth HTTP endpoint', async ({ request }) => {
    const uniqueEmail = `e2e-reg-${Date.now()}@test-agencyos.invalid`;
    const res = await request.post('/api/auth/sign-up/email', {
      data: {
        email: uniqueEmail,
        password: 'e2e-test-password-123',
        name: 'E2E Register Test',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.user.email).toBe(uniqueEmail);
    expect(body.user.id).toBeDefined();
  });

  test('should reject duplicate registration through the Better Auth HTTP endpoint', async ({
    request,
  }) => {
    const uniqueEmail = `e2e-dup-${Date.now()}@test-agencyos.invalid`;
    // First registration
    await request.post('/api/auth/sign-up/email', {
      data: {
        email: uniqueEmail,
        password: 'e2e-test-password-123',
        name: 'E2E Dup Test',
      },
    });
    // Second registration with same email should fail
    const res = await request.post('/api/auth/sign-up/email', {
      data: {
        email: uniqueEmail,
        password: 'e2e-test-password-123',
        name: 'E2E Dup Test',
      },
    });
    expect(res.ok()).toBeFalsy();
  });

  test('should reject invalid login credentials through the Better Auth HTTP endpoint', async ({
    request,
  }) => {
    const res = await request.post('/api/auth/sign-in/email', {
      data: {
        email: 'nonexistent@test-agencyos.invalid',
        password: 'wrong-password',
      },
    });
    expect(res.ok()).toBeFalsy();
  });
});
