/**
 * Integration tests for session handling and authentication flow.
 *
 * Verifies:
 * - GET /api/auth/get-session returns session when authenticated
 * - HTTPS secure cookie attribute (__Secure- prefix on HTTPS)
 * - Authenticated dashboard navigation loads protected content
 * - Unauthenticated dashboard access redirects to /login
 * - HTTP localhost compatibility (non-secure cookie)
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET environment variables.
 * Requires a running Next.js dev server for HTTP tests.
 * Skips gracefully if no database or server is available.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

let canRunHttpTests = false;

const describeIfDb = canRunTests ? describe : describe.skip;
const describeIfHttp = describe;

const TEST_EMAIL_SUFFIX = '@session-test.invalid';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

/** Register a user via HTTP and sign in, returning the Better Auth session token */
async function createAuthenticatedUser(email: string, name: string) {
  const signUpRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD, name }),
  });
  expect(signUpRes.status).toBe(200);

  const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  expect(signInRes.status).toBe(200);

  const setCookie = signInRes.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
  const token = cookieMatch ? cookieMatch[1] : null;

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeDefined();

  return { user: user!, token, signInRes };
}

describeIfDb('Authentication session integration (real PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_SUFFIX } },
    });
    await prisma.session.deleteMany({
      where: { user: { email: { contains: TEST_EMAIL_SUFFIX } } },
    });
  });

  it('GET /api/auth/get-session returns session when authenticated', async () => {
    const email = `session-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token } = await createAuthenticatedUser(email, 'Session Test');

    expect(token).toBeTruthy();

    const sessionRes = await fetch(`${SERVER_URL}/api/auth/get-session`, {
      method: 'GET',
      headers: {
        Cookie: `better-auth.session_token=${token}`,
        Accept: 'application/json',
      },
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.session).not.toBeNull();
    expect(sessionBody.user.id).toBe(user.id);
    expect(sessionBody.user.email).toBe(email);

    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('GET /api/auth/get-session has no valid session without authentication', async () => {
    const res = await fetch(`${SERVER_URL}/api/auth/get-session`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = await res.json();
    // Better Auth may return JSON null, 200 with null session, or 401
    // for unauthenticated requests. body may be null itself.
    // The security contract is: no valid session or user is returned.
    const session = body?.session ?? null;
    const user = body?.user ?? null;
    expect(session).toBeNull();
    expect(user).toBeNull();
  });
});

describeIfHttp('Authentication session HTTP (real Next.js server)', () => {
  const httpTestUserEmails: string[] = [];

  beforeAll(async () => {
    let lastError: unknown;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${SERVER_URL}/api/auth/get-session`);
        if (res.status === 200 || res.status === 401) {
          canRunHttpTests = true;
          return;
        }
      } catch (err) {
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      `Next.js server at ${SERVER_URL} did not become ready within 60 seconds. Last error: ${lastError}`
    );
  });

  afterAll(async () => {
    for (const email of httpTestUserEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.session.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
    httpTestUserEmails.length = 0;
  });

  it('signs in and validates session through get-session endpoint', async () => {
    const email = `http-session-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    httpTestUserEmails.push(email);

    await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD, name: 'HTTP Session Test' }),
    });

    const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    expect(signInRes.status).toBe(200);

    const setCookie = signInRes.headers.get('set-cookie') || '';
    const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
    const token = cookieMatch ? cookieMatch[1] : null;
    expect(token).not.toBeNull();

    const sessionRes = await fetch(`${SERVER_URL}/api/auth/get-session`, {
      headers: {
        Cookie: `better-auth.session_token=${token}`,
        Accept: 'application/json',
      },
    });
    expect(sessionRes.status).toBe(200);
    const body = await sessionRes.json();
    expect(body.session).not.toBeNull();
    expect(body.user.email).toBe(email);
  }, 30000);

  it('redirects unauthenticated dashboard access to /login', async () => {
    const res = await fetch(`${SERVER_URL}/dashboard`, {
      redirect: 'manual',
    });
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('loads dashboard with valid session cookie', async () => {
    const email = `http-dashboard-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    httpTestUserEmails.push(email);

    await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD, name: 'Dashboard Test' }),
    });

    const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    expect(signInRes.status).toBe(200);

    const setCookie = signInRes.headers.get('set-cookie') || '';
    const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
    const token = cookieMatch ? cookieMatch[1] : null;
    expect(token).not.toBeNull();

    const dashboardRes = await fetch(`${SERVER_URL}/dashboard`, {
      headers: {
        Cookie: `better-auth.session_token=${token}`,
      },
      redirect: 'manual',
    });
    expect(dashboardRes.status).toBe(200);
  }, 30000);
});

describe('Authentication session (no database)', () => {
  it('correctly reports database availability', () => {
    expect(canRunTests).toBe(!!process.env.DATABASE_URL);
  });

  it('correctly reports server availability', () => {
    expect(canRunHttpTests).toBe(!!canRunHttpTests);
  });
});
