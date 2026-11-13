/**
 * Integration tests for Organization Bootstrap API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Successful organization bootstrap after registration
 * - Idempotent behavior on repeated bootstrap requests (409)
 * - Concurrent bootstrap attempts (only one succeeds)
 * - Database-backed session validation (401 when missing)
 * - CRM permissions assigned to the admin role
 * - User linked to the organization
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET environment variables.
 * Requires a running Next.js server (TEST_SERVER_URL / BETTER_AUTH_URL, default http://localhost:3001).
 * Skips gracefully if no database is available.
 * Fails if the HTTP server is unavailable when the database is available.
 *
 * Session tokens are obtained via real HTTP sign-up/sign-in flows (Better Auth
 * manages session cookies as JWT tokens; manually inserted Prisma Session
 * records do not produce valid cookies).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

const describeIfDb = canRunTests ? describe : describe.skip;

const TEST_EMAIL_SUFFIX = '@bootstrap-test.invalid';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

/** Register a user via HTTP and sign in, returning the Better Auth session token and user record */
async function createAuthenticatedUser(email: string, name: string) {
  const signUpRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: TEST_PASSWORD, name }),
  });
  expect(signUpRes.status).toBe(200);

  const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  expect(signInRes.status).toBe(200);

  const setCookie = signInRes.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/better-auth.session_token=([^;]+)/);
  const token = cookieMatch ? cookieMatch[1] : null;

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeDefined();

  return { user: user!, token, signInRes };
}

describeIfDb('Organization Bootstrap integration (real PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.$connect();

    try {
      await fetch(`${SERVER_URL}/api/auth/session`, {
        method: 'GET',
        headers: { Accept: 'application/json', Origin: SERVER_URL },
      });
    } catch {
      throw new Error(`HTTP server unavailable at ${SERVER_URL}`);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/auth/bootstrap-organization', () => {
    let bootstrapUserId: string | null;
    let bootstrapOrgId: string | null;

    beforeEach(async () => {
      bootstrapUserId = null;
      bootstrapOrgId = null;
    });

    afterEach(async () => {
      if (bootstrapOrgId) {
        await prisma.userRole
          .deleteMany({ where: { organizationId: bootstrapOrgId } })
          .catch(() => {});
        await prisma.role.deleteMany({ where: { organizationId: bootstrapOrgId } }).catch(() => {});
        await prisma.organizationAccount
          .deleteMany({ where: { organizationId: bootstrapOrgId } })
          .catch(() => {});
        await prisma.agencyAccount
          .deleteMany({ where: { organizationId: bootstrapOrgId } })
          .catch(() => {});
        await prisma.organization.delete({ where: { id: bootstrapOrgId } }).catch(() => {});
      }
      if (bootstrapUserId) {
        await prisma.session.deleteMany({ where: { userId: bootstrapUserId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: bootstrapUserId } }).catch(() => {});
      }
    });

    it('returns 401 without a valid session', async () => {
      const res = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ organizationName: 'Test Org' }),
      });
      expect(res.status).toBe(401);
    });

    it('creates an organization, assigns admin role with CRM permissions, and links user', async () => {
      const email = `bootstrap-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
      const { user, token } = await createAuthenticatedUser(email, 'Bootstrap Test User');
      bootstrapUserId = user?.id ?? null;

      expect(token).toBeTruthy();
      expect(user).toBeDefined();

      const res = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ organizationName: 'Bootstrap Test Org' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.organization.id).toBeDefined();
      expect(body.organization.name).toBe('Bootstrap Test Org');
      expect(body.organization.slug).toBeDefined();
      expect(body.user.organizationId).toBe(body.organization.id);
      bootstrapOrgId = body.organization.id;

      const updatedUser = await prisma.user.findUnique({
        where: { id: user!.id },
        select: { organizationId: true },
      });
      expect(updatedUser?.organizationId).toBe(body.organization.id);

      const role = await prisma.role.findFirst({
        where: { organizationId: body.organization.id, isSystem: true },
        include: {
          permissions: { include: { permission: true } },
        },
      });
      expect(role).toBeDefined();
      const permissionCodes = role?.permissions.map(
        (rp: { permission: { code: string } }) => rp.permission.code
      );
      expect(permissionCodes).toContain('contact.create');
      expect(permissionCodes).toContain('contact.read');
      expect(permissionCodes).toContain('contact.update');
      expect(permissionCodes).toContain('contact.delete');
      expect(permissionCodes).toContain('account.create');
      expect(permissionCodes).toContain('account.read');
      expect(permissionCodes).toContain('account.update');
      expect(permissionCodes).toContain('account.delete');

      const userRole = await prisma.userRole.findFirst({
        where: { userId: user!.id, organizationId: body.organization.id },
      });
      expect(userRole).toBeDefined();
      expect(userRole?.roleId).toBe(role?.id);
    });

    it('returns 409 on repeated bootstrap (idempotent)', async () => {
      const email = `bootstrap-idempotent-${Date.now()}${TEST_EMAIL_SUFFIX}`;
      const { user, token } = await createAuthenticatedUser(email, 'Idempotent Bootstrap User');
      bootstrapUserId = user?.id ?? null;

      const firstRes = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ organizationName: 'Idempotent Org' }),
      });
      expect(firstRes.status).toBe(200);
      const firstBody = await firstRes.json();
      bootstrapOrgId = firstBody.organization.id;

      const secondRes = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ organizationName: 'Another Org' }),
      });
      expect(secondRes.status).toBe(409);
    });

    it('allows only one concurrent bootstrap to succeed', async () => {
      const email = `bootstrap-concurrent-${Date.now()}${TEST_EMAIL_SUFFIX}`;
      const { user, token } = await createAuthenticatedUser(email, 'Concurrent Bootstrap User');
      bootstrapUserId = user?.id ?? null;

      const results = await Promise.all([
        fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ organizationName: 'Concurrent Org A' }),
        }),
        fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ organizationName: 'Concurrent Org B' }),
        }),
      ]);

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(1);

      const orgs = await prisma.organization.findMany({
        where: {
          userRoles: { some: { userId: user!.id } },
        },
      });
      if (orgs.length > 0) {
        bootstrapOrgId = orgs[0].id;
      }

      await prisma.session.deleteMany({ where: { userId: user!.id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: user!.id } }).catch(() => {});
    });

    it('returns 400 for invalid request body', async () => {
      const email = `bootstrap-invalid-${Date.now()}${TEST_EMAIL_SUFFIX}`;
      const { user, token } = await createAuthenticatedUser(email, 'Invalid Bootstrap User');
      bootstrapUserId = user?.id ?? null;

      const res = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ organizationName: '' }),
      });

      expect(res.status).toBe(400);

      await prisma.session.deleteMany({ where: { userId: user!.id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: user!.id } }).catch(() => {});
    });
  });
});
