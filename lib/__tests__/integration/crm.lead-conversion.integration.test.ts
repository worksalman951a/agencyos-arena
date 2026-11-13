/**
 * Integration tests for Lead-to-Opportunity Conversion API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * Each test creates its own lead fixture to remain independent of test
 * ordering. Cleanup is safe against undefined IDs.
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET environment variables.
 * Requires a running Next.js server (TEST_SERVER_URL / BETTER_AUTH_URL, default http://localhost:3001).
 * Skips gracefully if no database is available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

const describeIfDb = canRunTests ? describe : describe.skip;

const TEST_EMAIL_SUFFIX = '@crm-conversion-test.invalid';
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

/** Create a test lead in the given org with pipeline, stage, contact, account. */
async function createTestLead(orgId: string, userId: string) {
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: orgId, name: 'Test Pipeline', isDefault: true },
  });
  const stage = await prisma.pipelineStage.create({
    data: {
      pipelineId: pipeline.id,
      name: 'Qualified',
      order: 1,
      probability: 50,
      isWon: false,
      isLost: false,
    },
  });
  const account = await prisma.agencyAccount.create({
    data: { organizationId: orgId, name: 'Test Client Account', status: 'active' },
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId: orgId,
      accountId: account.id,
      firstName: 'Jane',
      lastName: 'ConvContact',
      email: 'jane.conv@example.com',
      phone: '5551234567',
      status: 'active',
      createdBy: userId,
      updatedBy: userId,
    },
  });
  const lead = await prisma.lead.create({
    data: {
      organizationId: orgId,
      contactId: contact.id,
      accountId: account.id,
      source: 'website',
      status: 'qualified',
      priority: 'high',
      expectedValue: 75000,
      ownerId: userId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      notes: 'Test lead for conversion',
    },
  });
  return { lead, pipeline, stage, account, contact };
}

/** Convert a lead via the HTTP API. */
async function convertLead(token: string | null, leadId: string, body: unknown) {
  return fetch(`${SERVER_URL}/api/v1/crm/leads/${leadId}/convert`, {
    method: 'POST',
    headers: {
      ...(token ? { Cookie: `better-auth.session_token=${token}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describeIfDb('CRM Lead-to-Opportunity Conversion integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let foreignSessionToken: string;
  let foreignOrgId: string;

  // Track all created IDs for safe cleanup
  const createdLeads: string[] = [];
  const createdOpps: string[] = [];
  const createdContacts: string[] = [];
  const createdAccounts: string[] = [];
  const createdPipelines: string[] = [];
  const createdStages: string[] = [];

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
    const email = `crm-conv-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Conv User',
      'CRM Conv Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Foreign user + org (for IDOR tests)
    const foreignEmail = `crm-conv-foreign-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { token: foreignToken, org: foreignOrg } = await createAuthenticatedUserWithOrg(
      foreignEmail,
      'CRM Conv Foreign User',
      'CRM Conv Foreign Org'
    );
    foreignSessionToken = foreignToken!;
    foreignOrgId = foreignOrg!.id;
  });

  afterAll(async () => {
    // Safe cleanup of all created records
    for (const id of createdOpps) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdLeads) {
      await prisma.lead.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdContacts) {
      await prisma.contact.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdAccounts) {
      await prisma.agencyAccount.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdStages) {
      await prisma.pipelineStage.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdPipelines) {
      await prisma.pipeline.delete({ where: { id } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.opportunity.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.lead.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.pipelineStage
        .deleteMany({ where: { pipelineId: { in: createdPipelines } } })
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

  describe('POST /api/v1/crm/leads/[id]/convert - Convert lead to opportunity', () => {
    it('returns 401 without session', async () => {
      const { lead } = await createTestLead(testOrgId, testUserId);
      createdLeads.push(lead.id);

      const res = await convertLead(null, lead.id, { title: 'Converted Deal' });
      expect(res.status).toBe(401);
    });

    it('successfully converts a lead to an opportunity', async () => {
      const { lead, pipeline, stage } = await createTestLead(testOrgId, testUserId);
      createdLeads.push(lead.id);
      createdPipelines.push(pipeline.id);
      createdStages.push(stage.id);

      const res = await convertLead(testSessionToken, lead.id, {
        title: 'Enterprise Deal',
        value: '75000.00',
        currency: 'USD',
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: testUserId,
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.alreadyConverted).toBe(false);
      expect(body.opportunity.id).toBeDefined();
      expect(body.opportunity.title).toBe('Enterprise Deal');
      expect(body.opportunity.status).toBe('open');
      expect(body.opportunity.value).toBe('75000');
      expect(body.opportunity.currency).toBe('USD');
      expect(body.opportunity.leadId).toBe(lead.id);
      expect(body.opportunity.contactId).toBeDefined();
      expect(body.opportunity.accountId).toBeDefined();
      expect(body.opportunity.pipelineId).toBe(pipeline.id);
      expect(body.opportunity.stageId).toBe(stage.id);
      expect(body.opportunity.ownerId).toBe(testUserId);
      expect(body.lead.status).toBe('converted');
      createdOpps.push(body.opportunity.id);
    });

    it('prevents duplicate conversion of an already-converted lead', async () => {
      const { lead } = await createTestLead(testOrgId, testUserId);
      createdLeads.push(lead.id);

      // First conversion
      const firstRes = await convertLead(testSessionToken, lead.id, {
        title: 'First Deal',
      });
      expect(firstRes.status).toBe(201);
      const firstBody = await firstRes.json();
      createdOpps.push(firstBody.opportunity.id);

      // Second conversion attempt - should return already converted
      const secondRes = await convertLead(testSessionToken, lead.id, {
        title: 'Duplicate Deal',
      });
      expect(secondRes.status).toBe(200);
      const secondBody = await secondRes.json();
      expect(secondBody.alreadyConverted).toBe(true);
      expect(secondBody.opportunity.id).toBe(firstBody.opportunity.id);
      expect(secondBody.opportunity.title).toBe('First Deal');
    });

    it('returns 404 for cross-org lead (IDOR protection)', async () => {
      // Create a lead in the foreign org
      const foreignLead = await prisma.lead.create({
        data: {
          organizationId: foreignOrgId,
          source: 'website',
          status: 'new',
        },
      });
      createdLeads.push(foreignLead.id);

      const res = await convertLead(testSessionToken, foreignLead.id, {
        title: 'Hacked Deal',
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid input', async () => {
      const { lead } = await createTestLead(testOrgId, testUserId);
      createdLeads.push(lead.id);

      const res = await convertLead(testSessionToken, lead.id, {});
      expect(res.status).toBe(400);
    });

    it('returns 404 for invalid pipeline', async () => {
      const { lead } = await createTestLead(testOrgId, testUserId);
      createdLeads.push(lead.id);

      const foreignPipeline = await prisma.pipeline.create({
        data: {
          organizationId: foreignOrgId,
          name: 'Foreign Pipeline',
        },
      });
      createdPipelines.push(foreignPipeline.id);

      const res = await convertLead(testSessionToken, lead.id, {
        title: 'Test Deal',
        pipelineId: foreignPipeline.id,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Lead detail page shows conversion status', () => {
    it('shows converted opportunity link after conversion', async () => {
      const { lead, pipeline, stage } = await createTestLead(testOrgId, testUserId);
      createdLeads.push(lead.id);
      createdPipelines.push(pipeline.id);
      createdStages.push(stage.id);

      // Convert the lead first
      const convertRes = await convertLead(testSessionToken, lead.id, {
        title: 'Converted Deal',
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: testUserId,
      });
      expect(convertRes.status).toBe(201);
      const convertBody = await convertRes.json();
      createdOpps.push(convertBody.opportunity.id);

      // Then fetch the lead detail
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('converted');
      expect(body.convertedOpportunity).toBeDefined();
      expect(body.convertedOpportunity.id).toBe(convertBody.opportunity.id);
    });
  });

  describe('Org isolation (IDOR)', () => {
    it('foreign org cannot convert primary org lead', async () => {
      const { lead } = await createTestLead(testOrgId, testUserId);
      createdLeads.push(lead.id);

      const res = await convertLead(foreignSessionToken, lead.id, {
        title: 'Foreign Convert',
      });
      expect(res.status).toBe(404);
    });
  });
});
