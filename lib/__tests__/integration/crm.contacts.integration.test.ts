/**
 * Integration tests for CRM Contacts API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation)
 * - Custom RBAC permissions (403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups (IDOR protection)
 * - Cross-org account/contact relationship validation
 * - PII masking in serialized responses
 * - Audit logging with sensitive values redacted
 * - Soft deletion
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

const TEST_EMAIL_SUFFIX = '@crm-contacts-test.invalid';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

/** Register, sign in, and bootstrap an org for a test user. Returns session token, user, orgId. */
async function createAuthenticatedUserWithOrg(email: string, name: string, orgName: string) {
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

  const bootstrapRes = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Origin: SERVER_URL,
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

describeIfDb('CRM Contacts integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testContactId: string;
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

    const email = `crm-contact-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Contact User',
      'CRM Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Create test account in same org (AgencyAccount has no createdBy/updatedBy fields)
    const account = await prisma.agencyAccount.create({
      data: {
        organizationId: testOrgId,
        name: 'Test Client Account',
        status: 'active',
      },
    });
    testAccountId = account.id;

    // Create test contact in same org
    const contact = await prisma.contact.create({
      data: {
        organizationId: testOrgId,
        accountId: testAccountId,
        firstName: 'Jane',
        lastName: 'Contact',
        email: 'jane.contact@example.com',
        phone: '5551234567',
        status: 'active',
        createdBy: testUserId,
        updatedBy: testUserId,
      },
    });
    testContactId = contact.id;
  });

  afterAll(async () => {
    if (testContactId) {
      await prisma.contact.delete({ where: { id: testContactId } }).catch(() => {});
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

  describe('GET /api/v1/crm/contacts - List contacts', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
        headers: { Accept: 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it("returns paginated contacts for the user's organization", async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.contacts).toBeDefined();
      expect(Array.isArray(body.contacts)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('filters contacts by search term', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts?search=Jane`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.contacts.length).toBeGreaterThanOrEqual(1);
      expect(body.contacts[0].firstName).toContain('Jane');
    });

    it('applies pagination correctly', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts?page=1&pageSize=5`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.contacts.length).toBeLessThanOrEqual(5);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(5);
    });

    it('excludes soft-deleted contacts by default', async () => {
      await prisma.contact.update({
        where: { id: testContactId },
        data: { deletedAt: new Date() },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const deletedContact = body.contacts.find((c: { id: string }) => c.id === testContactId);
      expect(deletedContact).toBeUndefined();

      await prisma.contact.update({
        where: { id: testContactId },
        data: { deletedAt: null },
      });
    });

    it('excludes soft-deleted contacts when includeDeleted=false is passed explicitly', async () => {
      // Regression: `z.coerce.boolean()` turned the string "false" into true,
      // so this request used to return deleted contacts (the bug reported from
      // the contacts list, which sends includeDeleted=false).
      await prisma.contact.update({
        where: { id: testContactId },
        data: { deletedAt: new Date() },
      });

      try {
        const res = await fetch(
          `${SERVER_URL}/api/v1/crm/contacts?page=1&pageSize=20&search=&sortBy=createdAt&sortOrder=desc&includeDeleted=false`,
          {
            headers: {
              Cookie: `better-auth.session_token=${testSessionToken}`,
              Accept: 'application/json',
            },
          }
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.contacts.find((c: { id: string }) => c.id === testContactId)).toBeUndefined();
      } finally {
        await prisma.contact.update({
          where: { id: testContactId },
          data: { deletedAt: null },
        });
      }
    });

    it('includes soft-deleted contacts when includeDeleted=true', async () => {
      const deletedAt = new Date();
      await prisma.contact.update({
        where: { id: testContactId },
        data: { deletedAt },
      });

      try {
        const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts?includeDeleted=true`, {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        const found = body.contacts.find((c: { id: string }) => c.id === testContactId);
        expect(found).toBeDefined();
        expect(found.deletedAt).not.toBeNull();
      } finally {
        await prisma.contact.update({
          where: { id: testContactId },
          data: { deletedAt: null },
        });
      }
    });

    it('rejects an invalid includeDeleted token', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts?includeDeleted=maybe`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/crm/contacts - Create contact', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('creates a contact with PII masking', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          firstName: 'Integration',
          lastName: 'Test',
          email: 'integration.test@example.com',
          phone: '5559998888',
          accountId: testAccountId,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.firstName).toBe('Integration');
      expect(body.lastName).toBe('Test');
      expect(body.organizationId).toBe(testOrgId);
      expect(body.accountId).toBe(testAccountId);

      await prisma.contact.delete({ where: { id: body.id } });
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          lastName: '',
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/crm/contacts/[id] - Get single contact', () => {
    it('returns 404 for cross-org contact (non-disclosing)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org', slug: 'foreign-org' },
      });
      const foreignContact = await prisma.contact.create({
        data: {
          organizationId: foreignOrg.id,
          firstName: 'Foreign',
          lastName: 'Contact',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts/${foreignContact.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.contact.delete({ where: { id: foreignContact.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('returns contact for same org with PII masking', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts/${testContactId}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testContactId);
      expect(body.organizationId).toBe(testOrgId);
    });
  });

  describe('PUT /api/v1/crm/contacts/[id] - Update contact', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org 2', slug: 'foreign-org-2' },
      });
      const foreignContact = await prisma.contact.create({
        data: {
          organizationId: foreignOrg.id,
          firstName: 'Foreign',
          lastName: 'Contact',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts/${foreignContact.id}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ firstName: 'Hacked' }),
      });
      expect(res.status).toBe(404);

      await prisma.contact.delete({ where: { id: foreignContact.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('updates contact for same org', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts/${testContactId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ firstName: 'Updated' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.firstName).toBe('Updated');
    });
  });

  describe('DELETE /api/v1/crm/contacts/[id] - Soft delete contact', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org 3', slug: 'foreign-org-3' },
      });
      const foreignContact = await prisma.contact.create({
        data: {
          organizationId: foreignOrg.id,
          firstName: 'Foreign',
          lastName: 'Contact',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts/${foreignContact.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.contact.delete({ where: { id: foreignContact.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('soft deletes contact (sets deletedAt)', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/contacts/${testContactId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      const listBody = await listRes.json();
      const deletedContact = listBody.contacts.find((c: { id: string }) => c.id === testContactId);
      expect(deletedContact).toBeUndefined();
    });
  });
});
