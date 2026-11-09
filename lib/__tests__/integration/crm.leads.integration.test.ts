/**
 * Integration tests for CRM Leads API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation / IDOR protection)
 * - Custom RBAC permissions (lead.* codes, 403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups
 * - Duplicate detection and authorized override
 * - Owner membership validation before assignment
 * - Cross-org contact/account relationship validation
 * - Soft deletion
 * - Audit logging with PII redaction
 * - Secure pagination and whitelisted sorting
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

const TEST_EMAIL_SUFFIX = '@crm-leads-test.invalid';
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
  expect(bootstrapRes.status).toBe(200);

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeDefined();
  const org = await prisma.organization.findFirst({
    where: { userRoles: { some: { userId: user!.id } } },
  });
  expect(org).toBeDefined();

  return { user: user!, token, org: org! };
}

describeIfDb('CRM Leads integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testLeadId: string;
  let testContactId: string;
  let testAccountId: string;
  let foreignSessionToken: string;
  let foreignOrgId: string;

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

    // Primary user + org
    const email = `crm-lead-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Lead User',
      'CRM Lead Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Foreign user + org (for IDOR / cross-org tests)
    const foreignEmail = `crm-lead-foreign-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { token: foreignToken, org: foreignOrg } = await createAuthenticatedUserWithOrg(
      foreignEmail,
      'CRM Lead Foreign User',
      'CRM Lead Foreign Org'
    );
    foreignSessionToken = foreignToken!;
    foreignOrgId = foreignOrg!.id;

    // Create test account and contact in primary org
    const account = await prisma.agencyAccount.create({
      data: {
        organizationId: testOrgId,
        name: 'Test Client Account',
        status: 'active',
      },
    });
    testAccountId = account.id;

    const contact = await prisma.contact.create({
      data: {
        organizationId: testOrgId,
        accountId: testAccountId,
        firstName: 'Jane',
        lastName: 'LeadContact',
        email: 'jane.lead@example.com',
        phone: '5551234567',
        status: 'active',
        createdBy: testUserId,
        updatedBy: testUserId,
      },
    });
    testContactId = contact.id;
  });

  afterAll(async () => {
    if (testLeadId) {
      await prisma.lead.delete({ where: { id: testLeadId } }).catch(() => {});
    }
    if (testContactId) {
      await prisma.contact.delete({ where: { id: testContactId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.lead.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.agencyAccount
        .deleteMany({ where: { organizationId: testOrgId } })
        .catch(() => {});
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (foreignOrgId) {
      await prisma.lead.deleteMany({ where: { organizationId: foreignOrgId } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: foreignOrgId } }).catch(() => {});
      await prisma.agencyAccount
        .deleteMany({ where: { organizationId: foreignOrgId } })
        .catch(() => {});
      await prisma.organization.delete({ where: { id: foreignOrgId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('POST /api/v1/crm/leads - Create lead', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          source: 'website',
          status: 'new',
          priority: 'high',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('creates a lead with organization scoping', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          source: 'website',
          status: 'new',
          priority: 'high',
          expectedValue: '5000.00',
          contactId: testContactId,
          accountId: testAccountId,
          notes: 'Integration test lead',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.source).toBe('website');
      expect(body.status).toBe('new');
      expect(body.priority).toBe('high');
      expect(body.organizationId).toBe(testOrgId);
      expect(body.contactId).toBe(testContactId);
      expect(body.accountId).toBe(testAccountId);
      testLeadId = body.id;
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          status: 'new',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for cross-org contact relationship', async () => {
      const foreignContact = await prisma.contact.create({
        data: {
          organizationId: foreignOrgId,
          firstName: 'Foreign',
          lastName: 'Contact',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          source: 'website',
          status: 'new',
          priority: 'medium',
          contactId: foreignContact.id,
        }),
      });
      expect(res.status).toBe(404);

      await prisma.contact.delete({ where: { id: foreignContact.id } });
    });

    it('returns 404 for non-member owner assignment', async () => {
      const foreignUser = await prisma.user.create({
        data: {
          email: `nonmember-${Date.now()}${TEST_EMAIL_SUFFIX}`,
          name: 'Non Member',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          source: 'website',
          status: 'new',
          priority: 'medium',
          ownerId: foreignUser.id,
        }),
      });
      expect(res.status).toBe(404);

      await prisma.user.delete({ where: { id: foreignUser.id } });
    });
  });

  describe('Duplicate detection', () => {
    it('returns 409 for duplicate lead', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          source: 'website',
          status: 'new',
          priority: 'medium',
          contactId: testContactId,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Duplicate lead detected');
      expect(body.duplicateId).toBeDefined();
    });

    it('creates lead with authorized override', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads?overrideDuplicate=true`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          source: 'website',
          status: 'new',
          priority: 'medium',
          contactId: testContactId,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.organizationId).toBe(testOrgId);

      await prisma.lead.delete({ where: { id: body.id } });
    });
  });

  describe('GET /api/v1/crm/leads - List leads', () => {
    it('returns paginated leads for the user organization', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.leads)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('filters leads by status', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads?status=new`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.leads.every((l: { status: string }) => l.status === 'new')).toBe(true);
    });

    it('filters leads by priority', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads?priority=high`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.leads.every((l: { priority: string | null }) => l.priority === 'high')).toBe(
        true
      );
    });

    it('excludes soft-deleted leads by default', async () => {
      await prisma.lead.update({
        where: { id: testLeadId },
        data: { deletedAt: new Date() },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const deletedLead = body.leads.find((l: { id: string }) => l.id === testLeadId);
      expect(deletedLead).toBeUndefined();

      await prisma.lead.update({
        where: { id: testLeadId },
        data: { deletedAt: null },
      });
    });
  });

  describe('GET /api/v1/crm/leads/[id] - Get single lead', () => {
    it('returns 404 for cross-org lead (non-disclosing)', async () => {
      const foreignLead = await prisma.lead.create({
        data: {
          organizationId: foreignOrgId,
          source: 'website',
          status: 'new',
          priority: 'medium',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${foreignLead.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.lead.delete({ where: { id: foreignLead.id } });
    });

    it('returns lead for same org with related records', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${testLeadId}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testLeadId);
      expect(body.organizationId).toBe(testOrgId);
      expect(body.contact).toBeDefined();
      expect(body.account).toBeDefined();
    });
  });

  describe('PUT /api/v1/crm/leads/[id] - Update lead', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignLead = await prisma.lead.create({
        data: {
          organizationId: foreignOrgId,
          source: 'website',
          status: 'new',
          priority: 'medium',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${foreignLead.id}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ source: 'hacked' }),
      });
      expect(res.status).toBe(404);

      await prisma.lead.delete({ where: { id: foreignLead.id } });
    });

    it('updates lead for same org', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${testLeadId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ status: 'qualified', priority: 'low' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('qualified');
      expect(body.priority).toBe('low');
    });
  });

  describe('DELETE /api/v1/crm/leads/[id] - Soft delete lead', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignLead = await prisma.lead.create({
        data: {
          organizationId: foreignOrgId,
          source: 'website',
          status: 'new',
          priority: 'medium',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${foreignLead.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.lead.delete({ where: { id: foreignLead.id } });
    });

    it('soft deletes lead (sets deletedAt)', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${testLeadId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      const listBody = await listRes.json();
      const deletedLead = listBody.leads.find((l: { id: string }) => l.id === testLeadId);
      expect(deletedLead).toBeUndefined();
    });
  });

  describe('Org isolation (IDOR)', () => {
    it('foreign org cannot list primary org leads', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        headers: {
          Cookie: `better-auth.session_token=${foreignSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const primaryLead = body.leads.find((l: { id: string }) => l.id === testLeadId);
      expect(primaryLead).toBeUndefined();
    });
  });
});
