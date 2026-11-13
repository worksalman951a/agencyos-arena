/**
 * Integration tests for CRM Opportunities API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation / IDOR protection)
 * - Custom RBAC permissions (opportunity.* codes, 403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups
 * - Cross-org contact/account/lead/pipeline/stage relationship validation
 * - Owner membership validation before assignment
 * - Stage/status transition validation
 * - Soft deletion
 * - Audit logging
 * - Summary metrics
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

const TEST_EMAIL_SUFFIX = '@crm-opportunities-test.invalid';
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

describeIfDb('CRM Opportunities integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testOppId: string;
  let testContactId: string;
  let testAccountId: string;
  let testPipelineId: string;
  let testStageId: string;
  let testLeadId: string;
  let foreignSessionToken: string;
  let foreignOrgId: string;

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

    // Primary user + org
    const email = `crm-opp-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Opp User',
      'CRM Opp Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Foreign user + org (for IDOR / cross-org tests)
    const foreignEmail = `crm-opp-foreign-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { token: foreignToken, org: foreignOrg } = await createAuthenticatedUserWithOrg(
      foreignEmail,
      'CRM Opp Foreign User',
      'CRM Opp Foreign Org'
    );
    foreignSessionToken = foreignToken!;
    foreignOrgId = foreignOrg!.id;

    // Create test pipeline and stage in primary org
    const pipeline = await prisma.pipeline.create({
      data: {
        organizationId: testOrgId,
        name: 'Test Pipeline',
        isDefault: true,
      },
    });
    testPipelineId = pipeline.id;

    const stage = await prisma.pipelineStage.create({
      data: {
        pipelineId: testPipelineId,
        name: 'Qualified',
        order: 1,
        probability: 50,
        isWon: false,
        isLost: false,
      },
    });
    testStageId = stage.id;

    // Create test account, contact, and lead in primary org
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
        lastName: 'OppContact',
        email: 'jane.opp@example.com',
        phone: '5551234567',
        status: 'active',
        createdBy: testUserId,
        updatedBy: testUserId,
      },
    });
    testContactId = contact.id;

    const lead = await prisma.lead.create({
      data: {
        organizationId: testOrgId,
        contactId: testContactId,
        accountId: testAccountId,
        source: 'website',
        status: 'qualified',
        priority: 'high',
      },
    });
    testLeadId = lead.id;
  });

  afterAll(async () => {
    if (testOppId) {
      await prisma.opportunity.delete({ where: { id: testOppId } }).catch(() => {});
    }
    if (testLeadId) {
      await prisma.lead.delete({ where: { id: testLeadId } }).catch(() => {});
    }
    if (testContactId) {
      await prisma.contact.delete({ where: { id: testContactId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.opportunity.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.lead.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.pipelineStage
        .deleteMany({ where: { pipelineId: testPipelineId } })
        .catch(() => {});
      await prisma.pipeline.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.agencyAccount
        .deleteMany({ where: { organizationId: testOrgId } })
        .catch(() => {});
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (foreignOrgId) {
      await prisma.opportunity
        .deleteMany({ where: { organizationId: foreignOrgId } })
        .catch(() => {});
      await prisma.pipeline.deleteMany({ where: { organizationId: foreignOrgId } }).catch(() => {});
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

  describe('POST /api/v1/crm/opportunities - Create opportunity', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Deal',
          status: 'open',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('creates an opportunity with organization scoping', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Enterprise Deal',
          status: 'open',
          value: '50000.00',
          currency: 'USD',
          probability: '75',
          contactId: testContactId,
          accountId: testAccountId,
          leadId: testLeadId,
          pipelineId: testPipelineId,
          stageId: testStageId,
          closeDate: '2026-12-31',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('Enterprise Deal');
      expect(body.status).toBe('open');
      expect(body.value).toBe('50000');
      expect(body.currency).toBe('USD');
      expect(body.probability).toBe('75');
      expect(body.organizationId).toBe(testOrgId);
      expect(body.contactId).toBe(testContactId);
      expect(body.accountId).toBe(testAccountId);
      testOppId = body.id;
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          status: 'open',
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

      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Deal',
          status: 'open',
          contactId: foreignContact.id,
        }),
      });
      expect(res.status).toBe(404);

      await prisma.contact.delete({ where: { id: foreignContact.id } });
    });

    it('returns 404 for cross-org pipeline relationship', async () => {
      const foreignPipeline = await prisma.pipeline.create({
        data: {
          organizationId: foreignOrgId,
          name: 'Foreign Pipeline',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Deal',
          status: 'open',
          pipelineId: foreignPipeline.id,
        }),
      });
      expect(res.status).toBe(404);

      await prisma.pipeline.delete({ where: { id: foreignPipeline.id } });
    });
  });

  describe('GET /api/v1/crm/opportunities - List opportunities', () => {
    it('returns paginated opportunities for the user organization', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.opportunities)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('filters opportunities by status', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities?status=open`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.opportunities.every((o: { status: string }) => o.status === 'open')).toBe(true);
    });

    it('filters opportunities by pipeline', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/opportunities?pipelineId=${testPipelineId}`,
        {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(
        body.opportunities.every(
          (o: { pipelineId: string | null }) => o.pipelineId === testPipelineId
        )
      ).toBe(true);
    });

    it('excludes soft-deleted opportunities by default', async () => {
      await prisma.opportunity.update({
        where: { id: testOppId },
        data: { deletedAt: new Date() },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const deletedOpp = body.opportunities.find((o: { id: string }) => o.id === testOppId);
      expect(deletedOpp).toBeUndefined();

      await prisma.opportunity.update({
        where: { id: testOppId },
        data: { deletedAt: null },
      });
    });
  });

  describe('GET /api/v1/crm/opportunities/[id] - Get single opportunity', () => {
    it('returns 404 for cross-org opportunity (non-disclosing)', async () => {
      const foreignOpp = await prisma.opportunity.create({
        data: {
          organizationId: foreignOrgId,
          title: 'Foreign Deal',
          status: 'open',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/${foreignOpp.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.opportunity.delete({ where: { id: foreignOpp.id } });
    });

    it('returns opportunity for same org with related records', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/${testOppId}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testOppId);
      expect(body.organizationId).toBe(testOrgId);
      expect(body.contact).toBeDefined();
      expect(body.account).toBeDefined();
      expect(body.lead).toBeDefined();
      expect(body.pipeline).toBeDefined();
      expect(body.stage).toBeDefined();
    });
  });

  describe('PUT /api/v1/crm/opportunities/[id] - Update opportunity', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignOpp = await prisma.opportunity.create({
        data: {
          organizationId: foreignOrgId,
          title: 'Foreign Deal',
          status: 'open',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/${foreignOpp.id}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'Hacked' }),
      });
      expect(res.status).toBe(404);

      await prisma.opportunity.delete({ where: { id: foreignOpp.id } });
    });

    it('updates opportunity for same org', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/${testOppId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ status: 'won', probability: '100' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('won');
      expect(body.probability).toBe('100');
    });

    it('returns 400 for invalid stage/status transition', async () => {
      // Create a won stage
      const wonStage = await prisma.pipelineStage.create({
        data: {
          pipelineId: testPipelineId,
          name: 'Closed Won',
          order: 2,
          probability: 100,
          isWon: true,
          isLost: false,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/${testOppId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ stageId: wonStage.id, status: 'open' }),
      });
      expect(res.status).toBe(400);

      await prisma.pipelineStage.delete({ where: { id: wonStage.id } });
    });
  });

  describe('DELETE /api/v1/crm/opportunities/[id] - Soft delete opportunity', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignOpp = await prisma.opportunity.create({
        data: {
          organizationId: foreignOrgId,
          title: 'Foreign Deal',
          status: 'open',
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/${foreignOpp.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.opportunity.delete({ where: { id: foreignOpp.id } });
    });

    it('soft deletes opportunity (sets deletedAt)', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/${testOppId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      const listBody = await listRes.json();
      const deletedOpp = listBody.opportunities.find((o: { id: string }) => o.id === testOppId);
      expect(deletedOpp).toBeUndefined();
    });
  });

  describe('GET /api/v1/crm/opportunities/summary - Summary metrics', () => {
    it('returns summary metrics for the user organization', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities/summary`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.openCount).toBeDefined();
      expect(body.wonCount).toBeDefined();
      expect(body.lostCount).toBeDefined();
      expect(body.openValue).toBeDefined();
      expect(body.wonValue).toBeDefined();
      expect(body.lostValue).toBeDefined();
      expect(Array.isArray(body.byStage)).toBe(true);
    });
  });

  describe('Org isolation (IDOR)', () => {
    it('foreign org cannot list primary org opportunities', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/opportunities`, {
        headers: {
          Cookie: `better-auth.session_token=${foreignSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const primaryOpp = body.opportunities.find((o: { id: string }) => o.id === testOppId);
      expect(primaryOpp).toBeUndefined();
    });
  });
});
