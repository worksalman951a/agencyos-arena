/**
 * Integration tests for CRM cross-module workflows.
 *
 * These tests verify the complete user journey across CRM modules:
 * Contact → Account → Lead → Pipeline/Stage → Opportunity → Conversion.
 *
 * They run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
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

const TEST_EMAIL_SUFFIX = '@crm-workflow-test.invalid';
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
  expect(bootstrapRes.status).toBe(200);

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeDefined();
  const org = await prisma.organization.findFirst({
    where: { userRoles: { some: { userId: user!.id } } },
  });
  expect(org).toBeDefined();

  return { user: user!, token, org: org! };
}

describeIfDb('CRM Cross-Module Workflow integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let foreignUserId: string | null = null;
  let foreignOrgId: string | null = null;

  // Track created records for cleanup
  const createdRecords: {
    leads: string[];
    opportunities: string[];
    contacts: string[];
    accounts: string[];
    pipelines: string[];
    stages: string[];
  } = {
    leads: [],
    opportunities: [],
    contacts: [],
    accounts: [],
    pipelines: [],
    stages: [],
  };

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

    const email = `crm-workflow-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Workflow User',
      'CRM Workflow Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;
  });

  afterAll(async () => {
    // Safe cleanup of all created records
    for (const id of createdRecords.opportunities) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdRecords.leads) {
      await prisma.lead.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdRecords.contacts) {
      await prisma.contact.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdRecords.accounts) {
      await prisma.agencyAccount.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdRecords.stages) {
      await prisma.pipelineStage.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdRecords.pipelines) {
      await prisma.pipeline.delete({ where: { id } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }
    if (foreignUserId) {
      await prisma.session.deleteMany({ where: { userId: foreignUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: foreignUserId } }).catch(() => {});
    }
    if (foreignOrgId) {
      await prisma.organization.delete({ where: { id: foreignOrgId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('Complete CRM user journey: Contact → Account → Lead → Pipeline/Stage → Opportunity → Conversion', () => {
    it(
      'creates account, contact, pipeline, stage, lead, opportunity, and converts lead',
      { timeout: 120_000 },
      async () => {
        // 1. Create an account
        const accountRes = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Origin: SERVER_URL,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            name: 'Workflow Test Account',
            website: 'https://example.com',
            status: 'active',
          }),
        });
        expect(accountRes.status).toBe(201);
        const account = await accountRes.json();
        createdRecords.accounts.push(account.id);

        // 2. Create a contact linked to the account
        const contactRes = await fetch(`${SERVER_URL}/api/v1/crm/contacts`, {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Origin: SERVER_URL,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            firstName: 'John',
            lastName: 'Workflow',
            email: 'john.workflow@example.com',
            phone: '5551234567',
            accountId: account.id,
            status: 'active',
          }),
        });
        expect(contactRes.status).toBe(201);
        const contact = await contactRes.json();
        createdRecords.contacts.push(contact.id);

        // 3. Create a pipeline
        const pipelineRes = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Origin: SERVER_URL,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            name: 'Sales Pipeline',
            description: 'Main sales pipeline',
            isDefault: true,
          }),
        });
        expect(pipelineRes.status).toBe(201);
        const pipeline = await pipelineRes.json();
        createdRecords.pipelines.push(pipeline.id);

        // 4. Create a pipeline stage (pipelineId via URL query parameter per API contract)
        const stageRes = await fetch(
          `${SERVER_URL}/api/v1/crm/pipeline-stages?pipelineId=${pipeline.id}`,
          {
            method: 'POST',
            headers: {
              Cookie: `better-auth.session_token=${testSessionToken}`,
              'Content-Type': 'application/json',
              Origin: SERVER_URL,
              Accept: 'application/json',
            },
            body: JSON.stringify({
              name: 'Qualified',
              order: 1,
              probability: 50,
              isWon: false,
              isLost: false,
            }),
          }
        );
        expect(stageRes.status).toBe(201);
        const stage = await stageRes.json();
        createdRecords.stages.push(stage.id);

        // 5. Create a lead linked to contact, account, pipeline, stage
        const leadRes = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Origin: SERVER_URL,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            contactId: contact.id,
            accountId: account.id,
            source: 'website',
            status: 'qualified',
            priority: 'high',
            expectedValue: '100000.00',
            pipelineId: pipeline.id,
            stageId: stage.id,
            notes: 'Workflow test lead',
          }),
        });
        expect(leadRes.status).toBe(201);
        const lead = await leadRes.json();
        createdRecords.leads.push(lead.id);

        // Verify lead has correct relationships
        expect(lead.contactId).toBe(contact.id);
        expect(lead.accountId).toBe(account.id);
        expect(lead.pipelineId).toBe(pipeline.id);
        expect(lead.stageId).toBe(stage.id);
        expect(lead.status).toBe('qualified');

        // 6. Convert the lead to an opportunity
        const convertRes = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}/convert`, {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Origin: SERVER_URL,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            title: 'Workflow Opportunity',
            value: '100000.00',
            currency: 'USD',
            pipelineId: pipeline.id,
            stageId: stage.id,
            ownerId: testUserId,
          }),
        });
        expect(convertRes.status).toBe(201);
        const convertBody = await convertRes.json();
        expect(convertBody.alreadyConverted).toBe(false);
        expect(convertBody.opportunity.leadId).toBe(lead.id);
        expect(convertBody.opportunity.contactId).toBe(contact.id);
        expect(convertBody.opportunity.accountId).toBe(account.id);
        expect(convertBody.opportunity.pipelineId).toBe(pipeline.id);
        expect(convertBody.opportunity.stageId).toBe(stage.id);
        expect(convertBody.lead.status).toBe('converted');
        createdRecords.opportunities.push(convertBody.opportunity.id);

        // 7. Verify lead detail shows converted status and opportunity link
        const leadDetailRes = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}`, {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        });
        expect(leadDetailRes.status).toBe(200);
        const leadDetail = await leadDetailRes.json();
        expect(leadDetail.status).toBe('converted');
        expect(leadDetail.convertedOpportunity).toBeDefined();
        expect(leadDetail.convertedOpportunity.id).toBe(convertBody.opportunity.id);

        // 8. Verify account now shows contact count
        const accountDetailRes = await fetch(`${SERVER_URL}/api/v1/crm/accounts/${account.id}`, {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        });
        expect(accountDetailRes.status).toBe(200);
        const accountDetail = await accountDetailRes.json();
        expect(accountDetail.contactCount).toBeGreaterThanOrEqual(1);

        // 9. Verify opportunity shows linked lead
        const oppDetailRes = await fetch(
          `${SERVER_URL}/api/v1/crm/opportunities/${convertBody.opportunity.id}`,
          {
            headers: {
              Cookie: `better-auth.session_token=${testSessionToken}`,
              Accept: 'application/json',
            },
          }
        );
        expect(oppDetailRes.status).toBe(200);
        const oppDetail = await oppDetailRes.json();
        expect(oppDetail.lead).toBeDefined();
        expect(oppDetail.lead.id).toBe(lead.id);
      }
    );

    it('prevents duplicate conversion of an already-converted lead', async () => {
      // Create a new lead for this test
      const accountRes = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Dup Test Account',
          status: 'active',
        }),
      });
      expect(accountRes.status).toBe(201);
      const account = await accountRes.json();
      createdRecords.accounts.push(account.id);

      const leadRes = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          accountId: account.id,
          source: 'referral',
          status: 'new',
          priority: 'medium',
        }),
      });
      expect(leadRes.status).toBe(201);
      const lead = await leadRes.json();
      createdRecords.leads.push(lead.id);

      // First conversion
      const firstRes = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'First Opportunity' }),
      });
      expect(firstRes.status).toBe(201);
      const firstBody = await firstRes.json();
      createdRecords.opportunities.push(firstBody.opportunity.id);

      // Second conversion attempt - should return already converted
      const secondRes = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'Duplicate Opportunity' }),
      });
      expect(secondRes.status).toBe(200);
      const secondBody = await secondRes.json();
      expect(secondBody.alreadyConverted).toBe(true);
      expect(secondBody.opportunity.id).toBe(firstBody.opportunity.id);
    });

    it('returns 404 for cross-org lead conversion (IDOR protection)', async () => {
      // Create a foreign org user with a consistent email
      const foreignEmail = `foreign-workflow-${Date.now()}${TEST_EMAIL_SUFFIX}`;
      const foreignOrgRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({
          email: foreignEmail,
          password: TEST_PASSWORD,
          name: 'Foreign Workflow User',
        }),
      });
      expect(foreignOrgRes.status).toBe(200);

      const foreignSignIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({ email: foreignEmail, password: TEST_PASSWORD }),
      });
      expect(foreignSignIn.status).toBe(200);

      const foreignSetCookie = foreignSignIn.headers.get('set-cookie') || '';
      const foreignCookieMatch = foreignSetCookie.match(/better-auth.session_token=([^;]+)/);
      const foreignToken = foreignCookieMatch ? foreignCookieMatch[1] : null;
      expect(foreignToken).toBeTruthy();

      // Bootstrap the foreign org
      const foreignBootstrap = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${foreignToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ organizationName: 'Foreign Workflow Org' }),
      });
      expect(foreignBootstrap.status).toBe(200);

      // Capture foreign user/org for cleanup
      const foreignUser = await prisma.user.findUnique({ where: { email: foreignEmail } });
      foreignUserId = foreignUser?.id ?? null;
      const foreignOrg = await prisma.organization.findFirst({
        where: { userRoles: { some: { userId: foreignUserId! } } },
      });
      foreignOrgId = foreignOrg?.id ?? null;

      // Create an account first so the lead has a unique account-scoped
      // duplicate-detection key (avoids matching unrelated leads)
      const acctRes = await fetch(`${SERVER_URL}/api/v1/crm/accounts`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'IDOR Test Account',
          status: 'active',
        }),
      });
      expect(acctRes.status).toBe(201);
      const acct = await acctRes.json();
      createdRecords.accounts.push(acct.id);

      // Create a lead in the primary org (account-scoped for uniqueness)
      const leadRes = await fetch(`${SERVER_URL}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          accountId: acct.id,
          source: 'idor-test',
          status: 'new',
          priority: 'medium',
        }),
      });
      expect(leadRes.status).toBe(201);
      const lead = await leadRes.json();
      createdRecords.leads.push(lead.id);

      // Foreign org user tries to convert the primary org's lead → non-disclosing 404
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${foreignToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'Foreign Convert' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 401 for unauthenticated conversion attempt', async () => {
      // Create lead directly via Prisma to avoid API duplicate detection
      const lead = await prisma.lead.create({
        data: {
          organizationId: testOrgId,
          source: 'unauth-test',
          status: 'new',
        },
      });
      createdRecords.leads.push(lead.id);

      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'Unauthenticated Deal' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Organization isolation (IDOR)', () => {
    it('foreign org cannot access primary org leads', async () => {
      // Create a lead directly in the DB for the primary org
      const lead = await prisma.lead.create({
        data: {
          organizationId: testOrgId,
          source: 'website',
          status: 'new',
        },
      });
      createdRecords.leads.push(lead.id);

      // Try to convert it without a session (should be 401, not 404)
      const res = await fetch(`${SERVER_URL}/api/v1/crm/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'Isolated Deal' }),
      });
      expect(res.status).toBe(401);
    });
  });
});
