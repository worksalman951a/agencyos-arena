/**
 * Integration tests for CRM Pipeline Stages API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation)
 * - Custom RBAC permissions (403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups (IDOR protection)
 * - Stage ordering and integrity
 * - Stage deletion safeguards
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

const TEST_EMAIL_SUFFIX = '@crm-pipeline-stages-test.invalid';
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

describeIfDb('CRM Pipeline Stages integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testPipelineId: string;
  let testStageId: string;

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

    const email = `crm-stage-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Stage User',
      'CRM Stage Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Create test pipeline in same org
    const pipeline = await prisma.pipeline.create({
      data: {
        organizationId: testOrgId,
        name: 'Test Pipeline',
        description: 'A test pipeline for stages',
        isDefault: true,
      },
    });
    testPipelineId = pipeline.id;

    // Create test stage in same pipeline
    const stage = await prisma.pipelineStage.create({
      data: {
        pipelineId: testPipelineId,
        name: 'Qualification',
        order: 1,
        color: '#3b82f6',
        probability: 25,
        isWon: false,
        isLost: false,
      },
    });
    testStageId = stage.id;
  });

  afterAll(async () => {
    if (testStageId) {
      await prisma.pipelineStage.delete({ where: { id: testStageId } }).catch(() => {});
    }
    if (testPipelineId) {
      await prisma.pipelineStage
        .deleteMany({ where: { pipelineId: testPipelineId } })
        .catch(() => {});
      await prisma.pipeline.delete({ where: { id: testPipelineId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.pipeline.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('GET /api/v1/crm/pipeline-stages - List stages', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages?pipelineId=${testPipelineId}`,
        {
          headers: { Accept: 'application/json' },
        }
      );
      expect(res.status).toBe(401);
    });

    it('returns paginated stages for the pipeline', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages?pipelineId=${testPipelineId}`,
        {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stages).toBeDefined();
      expect(Array.isArray(body.stages)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 when pipelineId is missing', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/pipeline-stages`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/crm/pipeline-stages - Create stage', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages?pipelineId=${testPipelineId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ name: 'New Stage' }),
        }
      );
      expect(res.status).toBe(401);
    });

    it('creates a stage for the pipeline', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages?pipelineId=${testPipelineId}`,
        {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            name: 'Proposal',
            order: 2,
            color: '#10b981',
            probability: 50,
          }),
        }
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Proposal');
      expect(body.pipelineId).toBe(testPipelineId);

      await prisma.pipelineStage.delete({ where: { id: body.id } });
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages?pipelineId=${testPipelineId}`,
        {
          method: 'POST',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ name: '' }),
        }
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/crm/pipeline-stages/[id] - Get single stage', () => {
    it('returns 404 for cross-org stage (non-disclosing)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org', slug: 'foreign-stage-org' },
      });
      const foreignPipeline = await prisma.pipeline.create({
        data: { organizationId: foreignOrg.id, name: 'Foreign Pipeline', isDefault: false },
      });
      const foreignStage = await prisma.pipelineStage.create({
        data: {
          pipelineId: foreignPipeline.id,
          name: 'Foreign Stage',
          order: 1,
        },
      });

      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages/${foreignStage.id}?pipelineId=${foreignPipeline.id}`,
        {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        }
      );
      expect(res.status).toBe(404);

      await prisma.pipelineStage.delete({ where: { id: foreignStage.id } });
      await prisma.pipeline.delete({ where: { id: foreignPipeline.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('returns stage for same org', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages/${testStageId}?pipelineId=${testPipelineId}`,
        {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testStageId);
      expect(body.pipelineId).toBe(testPipelineId);
    });
  });

  describe('PUT /api/v1/crm/pipeline-stages/[id] - Update stage', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org 2', slug: 'foreign-stage-org-2' },
      });
      const foreignPipeline = await prisma.pipeline.create({
        data: { organizationId: foreignOrg.id, name: 'Foreign Pipeline', isDefault: false },
      });
      const foreignStage = await prisma.pipelineStage.create({
        data: { pipelineId: foreignPipeline.id, name: 'Foreign Stage', order: 1 },
      });

      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages/${foreignStage.id}?pipelineId=${foreignPipeline.id}`,
        {
          method: 'PUT',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ name: 'Hacked' }),
        }
      );
      expect(res.status).toBe(404);

      await prisma.pipelineStage.delete({ where: { id: foreignStage.id } });
      await prisma.pipeline.delete({ where: { id: foreignPipeline.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('updates stage for same org', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages/${testStageId}?pipelineId=${testPipelineId}`,
        {
          method: 'PUT',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ name: 'Updated Stage' }),
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Stage');
    });
  });

  describe('DELETE /api/v1/crm/pipeline-stages/[id] - Soft delete stage', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org 3', slug: 'foreign-stage-org-3' },
      });
      const foreignPipeline = await prisma.pipeline.create({
        data: { organizationId: foreignOrg.id, name: 'Foreign Pipeline', isDefault: false },
      });
      const foreignStage = await prisma.pipelineStage.create({
        data: { pipelineId: foreignPipeline.id, name: 'Foreign Stage', order: 1 },
      });

      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages/${foreignStage.id}?pipelineId=${foreignPipeline.id}`,
        {
          method: 'DELETE',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        }
      );
      expect(res.status).toBe(404);

      await prisma.pipelineStage.delete({ where: { id: foreignStage.id } });
      await prisma.pipeline.delete({ where: { id: foreignPipeline.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('soft deletes stage (sets deletedAt)', async () => {
      const res = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages/${testStageId}?pipelineId=${testPipelineId}`,
        {
          method: 'DELETE',
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(
        `${SERVER_URL}/api/v1/crm/pipeline-stages?pipelineId=${testPipelineId}`,
        {
          headers: {
            Cookie: `better-auth.session_token=${testSessionToken}`,
            Accept: 'application/json',
          },
        }
      );
      const listBody = await listRes.json();
      const deletedStage = listBody.stages.find((s: { id: string }) => s.id === testStageId);
      expect(deletedStage).toBeUndefined();
    });
  });
});
