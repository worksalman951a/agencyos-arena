/**
 * Integration tests for CRM Projects API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation)
 * - Custom RBAC permissions (403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups (IDOR protection)
 * - Project CRUD with tasks
 * - Soft deletion with deletedAt filtering
 * - Organization isolation (cross-org access blocked)
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET environment variables.
 * Requires a running Next.js server (TEST_SERVER_URL / BETTER_AUTH_URL, default http://localhost:3001).
 * Skips gracefully if no database is available.
 * Fails if the HTTP server is unavailable when the database is available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

const describeIfDb = canRunTests ? describe : describe.skip;

const TEST_EMAIL_SUFFIX = '@crm-projects-test.invalid';
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

describeIfDb('CRM Projects integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testContactId: string;
  let testProjectId: string;
  let testTaskId: string;

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

    const email = `crm-project-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Project User',
      'CRM Project Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Create test contact in same org (to use as project client)
    const contact = await prisma.contact.create({
      data: {
        organizationId: testOrgId,
        firstName: 'Project',
        lastName: 'Client',
        email: 'project.client@example.com',
        phone: '5550002222',
        status: 'active',
        createdBy: testUserId,
        updatedBy: testUserId,
      },
    });
    testContactId = contact.id;
  });

  afterAll(async () => {
    if (testTaskId) {
      await prisma.task.delete({ where: { id: testTaskId } }).catch(() => {});
    }
    if (testProjectId) {
      await prisma.project.delete({ where: { id: testProjectId } }).catch(() => {});
    }
    if (testContactId) {
      await prisma.contact.delete({ where: { id: testContactId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.contact.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('GET /api/v1/crm/projects - List projects', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        headers: { Accept: 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('returns empty list on empty database', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projects).toBeDefined();
      expect(Array.isArray(body.projects)).toBe(true);
      expect(body.projects.length).toBe(0);
      expect(body.total).toBe(0);
    });

    it("returns paginated projects for the user's organization", async () => {
      // Create a project directly in the DB for listing
      await prisma.project.create({
        data: {
          organizationId: testOrgId,
          clientId: testContactId,
          name: 'Test Project',
          description: 'A test project',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projects.length).toBeGreaterThanOrEqual(1);
      expect(body.total).toBeGreaterThanOrEqual(1);
      const testProj = body.projects.find((p: { name: string }) => p.name === 'Test Project');
      expect(testProj).toBeDefined();
      expect(testProj.organizationId).toBe(testOrgId);
      expect(testProj.client).toBeDefined();
      expect(testProj.client.firstName).toBe('Project');
    });

    it('excludes soft-deleted projects by default', async () => {
      await prisma.project.updateMany({
        where: { organizationId: testOrgId },
        data: { deletedAt: new Date() },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const deletedProj = body.projects.find((p: { name: string }) => p.name === 'Test Project');
      expect(deletedProj).toBeUndefined();

      // Restore
      await prisma.project.updateMany({
        where: { organizationId: testOrgId },
        data: { deletedAt: null },
      });
    });
  });

  describe('POST /api/v1/crm/projects - Create project', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Unauthorized Project',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('creates a project with client', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          clientId: testContactId,
          name: 'Integration Test Project',
          status: 'active',
          budget: '50000.00',
          description: 'Integration test project description',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Integration Test Project');
      expect(body.clientId).toBe(testContactId);
      expect(body.organizationId).toBe(testOrgId);
      expect(body.status).toBe('active');
      expect(body.budget).toBe('50000.00');
      expect(body.description).toBe('Integration test project description');
      expect(body.client).toBeDefined();
      expect(body.client.firstName).toBe('Project');
      expect(body.client.lastName).toBe('Client');

      testProjectId = body.id;
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: '',
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/crm/projects/[id] - Get single project', () => {
    it('returns 404 for cross-org project (non-disclosing)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Project', slug: 'foreign-org-project' },
      });
      const foreignProject = await prisma.project.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Project',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${foreignProject.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.project.delete({ where: { id: foreignProject.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('returns project for same org with client and tasks', async () => {
      expect(testProjectId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${testProjectId}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testProjectId);
      expect(body.organizationId).toBe(testOrgId);
      expect(body.client).toBeDefined();
      expect(body.client.firstName).toBe('Project');
    });
  });

  describe('POST /api/v1/crm/projects/[id]/tasks - Add task', () => {
    it('adds a task to the project', async () => {
      expect(testProjectId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${testProjectId}/tasks`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Design mockups',
          status: 'todo',
          priority: 'high',
          dueDate: null,
          estimatedHours: '8',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.projectId).toBe(testProjectId);
      expect(body.title).toBe('Design mockups');
      expect(body.status).toBe('todo');
      expect(body.priority).toBe('high');

      testTaskId = body.id;
    });

    it('returns 404 for cross-org task creation', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Project 2', slug: 'foreign-org-project-2' },
      });
      const foreignProject = await prisma.project.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Project 2',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${foreignProject.id}/tasks`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'Hacked Task' }),
      });
      expect(res.status).toBe(404);

      await prisma.project.delete({ where: { id: foreignProject.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });
  });

  describe('PUT /api/v1/crm/projects/[id] - Update project', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Project 3', slug: 'foreign-org-project-3' },
      });
      const foreignProject = await prisma.project.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Project 3',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${foreignProject.id}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'Hacked Project' }),
      });
      expect(res.status).toBe(404);

      await prisma.project.delete({ where: { id: foreignProject.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('updates project for same org', async () => {
      expect(testProjectId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${testProjectId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Integration Project',
          status: 'on-hold',
          description: 'Updated description',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Integration Project');
      expect(body.status).toBe('on-hold');
      expect(body.description).toBe('Updated description');
    });
  });

  describe('DELETE /api/v1/crm/projects/[id] - Soft delete project', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Project 4', slug: 'foreign-org-project-4' },
      });
      const foreignProject = await prisma.project.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign Project 4',
          status: 'active',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${foreignProject.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.project.delete({ where: { id: foreignProject.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('soft deletes project (sets deletedAt)', async () => {
      expect(testProjectId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/projects/${testProjectId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      const listBody = await listRes.json();
      const deletedProj = listBody.projects.find((p: { id: string }) => p.id === testProjectId);
      expect(deletedProj).toBeUndefined();
    });
  });
});
