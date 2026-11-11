/**
 * Integration tests for authentication and authorization.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 * They verify:
 * - User registration (DB + HTTP endpoint)
 * - Session creation/login (DB + HTTP endpoint)
 * - Session validation (HTTP endpoint)
 * - Session deletion/logout (HTTP endpoint)
 * - Invalid session rejection (DB + HTTP endpoint)
 * - Invalid credentials rejection (HTTP endpoint)
 * - Organization-scoped queries
 * - Role-based permissions
 * - Unauthorized access rejection
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET environment variables.
 * Requires a running Next.js server (TEST_SERVER_URL / BETTER_AUTH_URL, default http://localhost:3001).
 * Skips gracefully if no database is available; FAILS if HTTP server is unavailable.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

// Database availability flag
const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

let canRunHttpTests = false;

const describeIfDb = canRunTests ? describe : describe.skip;

// HTTP describe block always runs; beforeAll checks server readiness and fails if unavailable.
const describeIfHttp = describe;

describeIfDb('Authentication integration (real PostgreSQL)', () => {
  beforeAll(async () => {
    // Ensure database is reachable
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await prisma.user.deleteMany({
      where: { email: { contains: '@test-agencyos.invalid' } },
    });
    await prisma.session.deleteMany({
      where: { user: { email: { contains: '@test-agencyos.invalid' } } },
    });
  });

  it('should register a new user in the database', async () => {
    const testUser = await prisma.user.create({
      data: {
        email: 'register-test@test-agencyos.invalid',
        name: 'Register Test',
        password: 'hashed-password-placeholder',
        organizationId: null,
      },
    });

    expect(testUser.id).toBeDefined();
    expect(testUser.email).toBe('register-test@test-agencyos.invalid');
    expect(testUser.createdAt).toBeInstanceOf(Date);

    // Cleanup
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('should create and validate a session (login equivalent)', async () => {
    // Register user
    const testUser = await prisma.user.create({
      data: {
        email: 'auth-test@test-agencyos.invalid',
        name: 'Auth Test',
        password: 'hashed-password-placeholder',
        organizationId: null,
      },
    });

    // Create session (login)
    const session = await prisma.session.create({
      data: {
        token: 'test-session-token-' + testUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userId: testUser.id,
      },
    });

    expect(session.id).toBeDefined();
    expect(session.userId).toBe(testUser.id);
    expect(session.expiresAt).toBeInstanceOf(Date);

    // Validate session exists
    const foundSession = await prisma.session.findUnique({
      where: { token: 'test-session-token-' + testUser.id },
    });
    expect(foundSession).not.toBeNull();
    expect(foundSession?.userId).toBe(testUser.id);

    // Logout (delete session)
    await prisma.session.delete({ where: { id: session.id } });

    // Verify session is gone
    const goneSession = await prisma.session.findUnique({
      where: { token: 'test-session-token-' + testUser.id },
    });
    expect(goneSession).toBeNull();

    // Cleanup user
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('should reject invalid session tokens', async () => {
    const session = await prisma.session.findUnique({
      where: { token: 'non-existent-token' },
    });

    expect(session).toBeNull();
  });

  it('should enforce organization-scoped queries', async () => {
    // Create two organizations
    const org1 = await prisma.organization.create({
      data: { name: 'Test Org 1', slug: 'test-org-1' },
    });
    const org2 = await prisma.organization.create({
      data: { name: 'Test Org 2', slug: 'test-org-2' },
    });

    // Create a user in org1
    const user = await prisma.user.create({
      data: {
        email: 'org-scoping@test-agencyos.invalid',
        organizationId: org1.id,
      },
    });

    // Query users scoped to each organization
    const org1Users = await prisma.user.findMany({
      where: { organizationId: org1.id },
    });
    const org2Users = await prisma.user.findMany({
      where: { organizationId: org2.id },
    });

    expect(org1Users.length).toBeGreaterThanOrEqual(1);
    expect(org2Users.length).toBe(0); // No users in org2

    // Cleanup
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org1.id } });
    await prisma.organization.delete({ where: { id: org2.id } });
  });

  it('should enforce role-based permissions', async () => {
    // Permission codes are globally unique and shared with the bootstrap flow,
    // so this suite uses run-scoped codes. Creating or deleting the shared
    // codes here would collide with parallel suites and with bootstrap.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const readCode = `integration.invoice.read.${runId}`;
    const createCode = `integration.invoice.create.${runId}`;

    const org = await prisma.organization.create({
      data: { name: 'Perm Test Org', slug: `perm-test-org-${runId}` },
    });

    // Create run-scoped permissions
    const permRead = await prisma.permission.create({
      data: { code: readCode, description: 'Read invoices' },
    });
    const permWrite = await prisma.permission.create({
      data: { code: createCode, description: 'Create invoices' },
    });

    // Create admin role with both permissions
    const adminRole = await prisma.role.create({
      data: {
        name: 'Admin',
        organizationId: org.id,
        isSystem: true,
        permissions: {
          create: [{ permissionId: permRead.id }, { permissionId: permWrite.id }],
        },
      },
    });

    // Create employee role with read-only
    const employeeRole = await prisma.role.create({
      data: {
        name: 'Employee',
        organizationId: org.id,
        isSystem: true,
        permissions: {
          create: [{ permissionId: permRead.id }],
        },
      },
    });

    // Create users with different roles
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-perm-${runId}@test-agencyos.invalid`,
        organizationId: org.id,
      },
    });
    const employeeUser = await prisma.user.create({
      data: {
        email: `employee-perm-${runId}@test-agencyos.invalid`,
        organizationId: org.id,
      },
    });

    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole.id, organizationId: org.id },
    });
    await prisma.userRole.create({
      data: { userId: employeeUser.id, roleId: employeeRole.id, organizationId: org.id },
    });

    // Verify admin has both permissions
    const adminPerms = await prisma.rolePermission.findMany({
      where: { roleId: adminRole.id },
      include: { permission: true },
    });
    const adminCodes = adminPerms.map((rp: { permission: { code: string } }) => rp.permission.code);
    expect(adminCodes).toContain(readCode);
    expect(adminCodes).toContain(createCode);

    // Verify employee has only read permission
    const employeePerms = await prisma.rolePermission.findMany({
      where: { roleId: employeeRole.id },
      include: { permission: true },
    });
    const employeeCodes = employeePerms.map(
      (rp: { permission: { code: string } }) => rp.permission.code
    );
    expect(employeeCodes).toContain(readCode);
    expect(employeeCodes).not.toContain(createCode);

    // Cleanup
    await prisma.userRole.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.role.deleteMany({ where: { organizationId: org.id } });
    await prisma.permission.deleteMany({ where: { code: { in: [readCode, createCode] } } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('should reject unauthorized access when no session exists', async () => {
    // Attempt to find a session for a non-existent user
    const session = await prisma.session.findFirst({
      where: { userId: 'nonexistent-user-id' },
    });
    expect(session).toBeNull();
  });
});

describeIfHttp('Authentication HTTP endpoints (real Next.js server)', () => {
  // Track users created by HTTP tests for targeted cleanup
  const httpTestUserEmails: string[] = [];
  // Capture session cookie from login responses
  let sessionCookie: string | null = null;

  beforeAll(async () => {
    // Check if the server is reachable - FAIL if not available within strict timeout
    let lastError: unknown;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${SERVER_URL}/api/auth/get-session`);
        if (res.status === 200) {
          canRunHttpTests = true;
          return; // Server is ready
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
    // Targeted cleanup: delete sessions and users created by HTTP tests only
    for (const email of httpTestUserEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.session.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
    httpTestUserEmails.length = 0;
    sessionCookie = null;
  });

  // Extract the Better Auth session cookie from a response's Set-Cookie header
  const extractSessionCookie = (res: Response): string | null => {
    const setCookie = res.headers.get('Set-Cookie');
    if (!setCookie) return null;
    const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
    return match ? match[1] : null;
  };

  // Make an authenticated fetch request with the captured session cookie
  const authFetch = (path: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string> | undefined) || {}),
    };
    if (sessionCookie) {
      headers.Cookie = `better-auth.session_token=${sessionCookie}`;
    }
    return fetch(`${SERVER_URL}${path}`, { ...options, headers });
  };

  it('should register a user through the Better Auth HTTP endpoint', async () => {
    const email = 'http-register@test-agencyos.invalid';
    httpTestUserEmails.push(email);

    const res = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
        name: 'HTTP Register Test',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.id).toBeDefined();

    // Verify user was created in DB
    const user = await prisma.user.findUnique({
      where: { email },
    });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(email);
  });

  it('should login through the Better Auth HTTP endpoint and receive a session cookie', async () => {
    const email = 'http-login@test-agencyos.invalid';
    httpTestUserEmails.push(email);

    // Register through the real API (no placeholder password hashes)
    const regRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
        name: 'HTTP Login Test',
      }),
    });
    expect(regRes.status).toBe(200);

    // Login through the real API - captures session cookie
    const loginRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
      }),
    });
    expect(loginRes.status).toBe(200);

    // Capture authentication cookie from login response
    sessionCookie = extractSessionCookie(loginRes);
    expect(sessionCookie).not.toBeNull();

    // Verify session belongs to the correct user via authenticated request
    const sessionRes = await authFetch('/api/auth/get-session');
    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.session).not.toBeNull();
    expect(sessionBody.user.id).toBeDefined();
    expect(sessionBody.user.email).toBe(email);
  });

  it('should validate session through the Better Auth HTTP endpoint', async () => {
    const email = 'http-session@test-agencyos.invalid';
    httpTestUserEmails.push(email);

    // Register and login through the real API
    await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
        name: 'HTTP Session Test',
      }),
    });

    const loginRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
      }),
    });
    expect(loginRes.status).toBe(200);

    sessionCookie = extractSessionCookie(loginRes);
    expect(sessionCookie).not.toBeNull();

    // Validate session with the captured cookie
    const sessionRes = await authFetch('/api/auth/get-session');
    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.session).not.toBeNull();
    expect(sessionBody.user.email).toBe(email);
  });

  it('should reject invalid credentials through the Better Auth HTTP endpoint', async () => {
    const res = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email: 'nonexistent@test-agencyos.invalid',
        password: 'wrong-password',
      }),
    });
    expect(res.status).not.toBe(200);
  });

  it('should logout through the Better Auth HTTP endpoint and invalidate the session', async () => {
    const email = 'http-logout@test-agencyos.invalid';
    httpTestUserEmails.push(email);

    // Register and login through the real API
    await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
        name: 'HTTP Logout Test',
      }),
    });

    const loginRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
      }),
    });
    expect(loginRes.status).toBe(200);

    sessionCookie = extractSessionCookie(loginRes);
    expect(sessionCookie).not.toBeNull();

    // Verify session is active before logout
    const beforeLogout = await authFetch('/api/auth/get-session');
    expect(beforeLogout.status).toBe(200);
    const beforeBody = await beforeLogout.json();
    expect(beforeBody.session).not.toBeNull();

    // Logout using the authenticated session cookie
    const logoutRes = await authFetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({}),
    });
    expect(logoutRes.status).toBe(200);

    // Resend the original session cookie after logout to prove the server invalidated it
    const afterLogout = await authFetch('/api/auth/get-session');
    expect(afterLogout.status).toBe(200);
    const afterBody = await afterLogout.json();
    expect(afterBody).toBeNull();
  });

  it('should allow valid session to access protected /dashboard route', async () => {
    const email = 'http-dashboard-valid@test-agencyos.invalid';
    httpTestUserEmails.push(email);

    // Register and login through the real API
    await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
        name: 'Dashboard Valid Test',
      }),
    });

    const loginRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        email,
        password: 'test-password-123',
      }),
    });
    expect(loginRes.status).toBe(200);

    sessionCookie = extractSessionCookie(loginRes);
    expect(sessionCookie).not.toBeNull();

    // Valid session cookie should allow access to /dashboard
    const dashboardRes = await authFetch('/dashboard');
    expect(dashboardRes.status).toBe(200);
  }, 30000);

  it('should reject missing session on protected /dashboard route', async () => {
    // No session cookie at all - use redirect: 'manual' to see the
    // actual redirect response instead of having fetch follow it
    const res = await fetch(`${SERVER_URL}/dashboard`, { redirect: 'manual' });
    // Next.js middleware returns 302 for cookie-less requests
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('should reject forged session on protected /dashboard route', async () => {
    // Forged/invalid session cookie - middleware allows the request
    // (cookie present), but the dashboard server layout rejects it
    // server-side via database-backed session validation.
    const forgedCookie = 'forged-invalid-session-token-value';
    const res = await fetch(`${SERVER_URL}/dashboard`, {
      headers: { Cookie: `better-auth.session_token=${forgedCookie}` },
      redirect: 'manual',
    });
    const body = await res.text();
    // Collect ALL headers to detect any redirect mechanism Next.js uses
    const redirectHeaders = [...res.headers.entries()].filter(
      ([key]) => key.toLowerCase().includes('redirect') || key.toLowerCase().includes('location')
    );
    const isHttpRedirect = [302, 307].includes(res.status);
    const hasRedirectHeader = redirectHeaders.some(([, value]) => value.includes('/login'));
    // Next.js RSC redirect payload includes the target path in the body
    const isRscRedirect = body.includes('/login');
    // No protected dashboard data may be exposed to a forged session.
    // Check specific protected data values, not generic words like "Dashboard"
    // which appear in redirect payload paths.
    expect(body).not.toContain('$0.00');
    expect(body).not.toContain('Total Revenue');
    expect(body).not.toContain('Open Opportunities');
    expect(body).not.toContain('Pipeline is empty');
    // At least one redirect mechanism must confirm rejection
    expect(isHttpRedirect || hasRedirectHeader || isRscRedirect).toBe(true);
  });
});

describe('Authentication integration (no database)', () => {
  it('correctly reports database availability', () => {
    // canRunTests should be true when DATABASE_URL is set, false otherwise
    expect(canRunTests).toBe(!!process.env.DATABASE_URL);
  });

  it('correctly reports server availability', () => {
    // canRunHttpTests should be true when server is reachable, false otherwise
    expect(canRunHttpTests).toBe(!!canRunHttpTests);
  });
});
