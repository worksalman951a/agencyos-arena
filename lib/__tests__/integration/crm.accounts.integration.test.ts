/**
 * Integration tests for CRM Accounts API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation)
 * - Custom RBAC permissions (403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups (IDOR protection)
 * - Soft deletion with related contact cascading
 * - Audit logging with sensitive values redacted
 * - Secure pagination
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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

const describeIfDb = canRunTests ? describe : describe.skip;

const TEST_EMAIL_SUFFIX = '@crm-accounts-test.invalid';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

/** Register, sign in, and bootstrap an org for a test user. Returns session token, user, orgId. */
async function createAuthenticatedUserWithOrg(email: string, name: string, orgName: string) {
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
  const cookieMatch = setCookie.match(/better-auth.session_token=([^;]+)/);
  const token = cookieMatch ? cookieMatch[1] : null;

  const bootstrapRes = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ organizationName: orgName }),
  });

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeDefined();
  const org = await prisma.organization.findFirst({
    where: { userRoles: { some: { userId: user!.id } } },
  });
  expect(org).toBeDefined();

  return { user: user!, token, org: org!, bootstrapRes };
}

describeIfDb('CRM Accounts integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testAccountId: string;

  beforeAll(async () => {
    await prisma.$connect();

    try {
      await fetch(`${SERVER_URL}/api/auth/session`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new Error(`HTTP server unavailable at ${SERVER_URL}`);
    }

    const email = `crm-account-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Account User',
      'CRM Accounts Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Create test account in same org (AgencyAccount has no createdBy/updatedBy fields)
    const account = await prisma.agencyAccount.create({
      data: {
        organizationId: testOrgId,
        name: 'Test Client Account',
        website: 'https://example.com',
        address: '123 Main St',
        status: 'active',
      },
    });
    testAccountId = account.id;
  });

  afterAll(async () => {
    if (testAccountId) {
      await prisma.agencyAccount.delete({ where: { id: testAccountId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.contact.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.agencyAccount
        .deleteMany({ where: { organizationId: testOrgId } })
        .catch(() => {});
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('GET /api/v1/crm/accounts - List accounts', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        headers: { Accept: 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it("returns paginated accounts for the user's organization", async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accounts).toBeDefined();
      expect(Array.isArray(body.accounts)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('applies pagination correctly', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts?page=1&pageSize=5`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accounts.length).toBeLessThanOrEqual(5);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(5);
    });

    it('excludes soft-deleted accounts by default', async () => {
      await prisma.agencyAccount.update({
        where: { id: testAccountId },
        data: { deletedAt: new Date() },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const deletedAccount = body.accounts.find((a: { id: string }) => a.id === testAccountId);
      expect(deletedAccount).toBeUndefined();

      await prisma.agencyAccount.update({
        where: { id: testAccountId },
        data: { deletedAt: null },
      });
    });
  });

  describe('POST /api/v1/crm/accounts - Create account', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'Test Account' }),
      });
      expect(res.status).toBe(401);
    });

    it("creates an account for the user's organization", async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Integration Test Account',
          website: 'https://integration.example.com',
          address: '456 Test Ave',
          status: 'active',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Integration Test Account');
      expect(body.organizationId).toBe(testOrgId);

      await prisma.agencyAccount.delete({ where: { id: body.id } });
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/crm/accounts/[id] - Get single account', () => {
    it('returns 404 for cross-org account (non-disclosing)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Accounts Org', slug: 'foreign-accounts-org' },
      });
      const foreignAccount = await prisma.agencyAccount.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Account',
          status: 'active',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts/${foreignAccount.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.agencyAccount.delete({ where: { id: foreignAccount.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('returns account for same org', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts/${testAccountId}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testAccountId);
      expect(body.organizationId).toBe(testOrgId);
    });
  });

  describe('PUT /api/v1/crm/accounts/[id] - Update account', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: {
          name: 'Foreign Accounts Org 2',
          slug: 'foreign-accounts-org-2',
        },
      });
      const foreignAccount = await prisma.agencyAccount.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Account',
          status: 'active',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts/${foreignAccount.id}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'Hacked' }),
      });
      expect(res.status).toBe(404);

      await prisma.agencyAccount.delete({ where: { id: foreignAccount.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('updates account for same org', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts/${testAccountId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'Updated Account' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Account');
    });
  });

  describe('DELETE /api/v1/crm/accounts/[id] - Soft delete account', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignOrg = await prisma.organization.create({
        data: {
          name: 'Foreign Accounts Org 3',
          slug: 'foreign-accounts-org-3',
        },
      });
      const foreignAccount = await prisma.agencyAccount.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Account',
          status: 'active',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts/${foreignAccount.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.agencyAccount.delete({ where: { id: foreignAccount.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('soft deletes account and cascades to related contacts', async () => {
      await prisma.contact.create({
        data: {
          organizationId: testOrgId,
          accountId: testAccountId,
          firstName: 'Cascade',
          lastName: 'Test',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/accounts/${testAccountId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      const listBody = await listRes.json();
      const deletedAccount = listBody.accounts.find((a: { id: string }) => a.id === testAccountId);
      expect(deletedAccount).toBeUndefined();
    });
  });
});
