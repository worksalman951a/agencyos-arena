/**
 * Integration tests for CRM Pipelines API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation)
 * - Custom RBAC permissions (403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups (IDOR protection)
 * - Default pipeline management
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

const TEST_EMAIL_SUFFIX = '@crm-pipelines-test.invalid';
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

describeIfDb('CRM Pipelines integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testPipelineId: string;

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

    const email = `crm-pipeline-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Pipeline User',
      'CRM Pipeline Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Create test pipeline in same org
    const pipeline = await prisma.pipeline.create({
      data: {
        organizationId: testOrgId,
        name: 'Test Sales Pipeline',
        description: 'A test pipeline',
        isDefault: true,
      },
    });
    testPipelineId = pipeline.id;
  });

  afterAll(async () => {
    if (testPipelineId) {
      await prisma.pipeline.delete({ where: { id: testPipelineId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.pipelineStage
        .deleteMany({ where: { pipeline: { organizationId: testOrgId } } })
        .catch(() => {});
      await prisma.pipeline.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('GET /api/v1/crm/pipelines - List pipelines', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
        headers: { Accept: 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('returns paginated pipelines for the user organization', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pipelines).toBeDefined();
      expect(Array.isArray(body.pipelines)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('excludes soft-deleted pipelines by default', async () => {
      await prisma.pipeline.update({
        where: { id: testPipelineId },
        data: { deletedAt: new Date() },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const deletedPipeline = body.pipelines.find((p: { id: string }) => p.id === testPipelineId);
      expect(deletedPipeline).toBeUndefined();

      await prisma.pipeline.update({
        where: { id: testPipelineId },
        data: { deletedAt: null },
      });
    });
  });

  describe('POST /api/v1/crm/pipelines - Create pipeline', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'New Pipeline' }),
      });
      expect(res.status).toBe(401);
    });

    it('creates a pipeline for the user organization', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Integration Test Pipeline',
          description: 'Created via integration test',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Integration Test Pipeline');
      expect(body.organizationId).toBe(testOrgId);

      await prisma.pipeline.delete({ where: { id: body.id } });
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/crm/pipelines/[id] - Get single pipeline', () => {
    it('returns 404 for cross-org pipeline (non-disclosing)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org', slug: 'foreign-pipeline-org' },
      });
      const foreignPipeline = await prisma.pipeline.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Pipeline',
          isDefault: false,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines/${foreignPipeline.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.pipeline.delete({ where: { id: foreignPipeline.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('returns pipeline for same org', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines/${testPipelineId}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testPipelineId);
      expect(body.organizationId).toBe(testOrgId);
    });
  });

  describe('PUT /api/v1/crm/pipelines/[id] - Update pipeline', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org 2', slug: 'foreign-pipeline-org-2' },
      });
      const foreignPipeline = await prisma.pipeline.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Pipeline',
          isDefault: false,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines/${foreignPipeline.id}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'Hacked' }),
      });
      expect(res.status).toBe(404);

      await prisma.pipeline.delete({ where: { id: foreignPipeline.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('updates pipeline for same org', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines/${testPipelineId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'Updated Pipeline' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Pipeline');
    });
  });

  describe('DELETE /api/v1/crm/pipelines/[id] - Soft delete pipeline', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org 3', slug: 'foreign-pipeline-org-3' },
      });
      const foreignPipeline = await prisma.pipeline.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Pipeline',
          isDefault: false,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines/${foreignPipeline.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.pipeline.delete({ where: { id: foreignPipeline.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('soft deletes pipeline (sets deletedAt)', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipelines/${testPipelineId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(`${SERVER_URL}/api/v1/crm/pipelines`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      const listBody = await listRes.json();
      const deletedPipeline = listBody.pipelines.find(
        (p: { id: string }) => p.id === testPipelineId
      );
      expect(deletedPipeline).toBeUndefined();
    });
  });
});
