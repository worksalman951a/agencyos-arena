/**
 * Unit tests for the Project service.
 *
 * Verifies:
 * - Organization scoping on read/write queries
 * - Permission checks on create/update
 * - Client cross-organization validation
 * - Serialized responses stay complete even when optional relations are absent
 *
 * Regression note: createProject/updateProject used to serialize `tasks` and
 * `_count.milestones` without including them in the query, so every create and
 * update returned 500 with a TypeError. These tests pin both the defensive
 * serializer behaviour and the include contract.
 *
 * Prisma, auth, and permissions are mocked so these tests run without a database.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  emitWorkflowEvent: vi.fn(async () => ({})),
  emitWorkflowEvents: vi.fn(async () => []),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { createProject, getProject, updateProject } from '@/lib/services/crm/project-service';

const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockProjectFindFirst = prisma.project.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockProjectCreate = prisma.project.create as unknown as ReturnType<typeof vi.fn>;
const mockProjectUpdate = prisma.project.update as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;

const baseProject = {
  id: 'proj-1',
  organizationId: 'org-1',
  clientId: 'contact-1',
  name: 'Website Redesign',
  status: 'active',
  budget: '50000.00',
  startDate: null,
  endDate: null,
  description: 'Project description',
  deletedAt: null,
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  client: { id: 'contact-1', firstName: 'Jane', lastName: 'Doe' },
  tasks: [],
  _count: { milestones: 0 },
};

function setupAuth() {
  mockGetSession.mockResolvedValue({
    session: { id: 'session-1' },
    user: { id: 'user-1', email: 'user@agency.com' },
  });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue(undefined);
  mockCookies.mockReturnValue({ toString: () => '' } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth();
});

describe('createProject', () => {
  const input = {
    clientId: 'contact-1',
    name: 'Integration Test Project',
    status: 'active',
    budget: '50000.00',
    description: 'Integration test project description',
  };

  it('creates a project scoped to the caller organization', async () => {
    mockProjectCreate.mockResolvedValue({ ...baseProject, id: 'proj-new' });
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });

    const result = await createProject(input);

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'project.create');
    expect(mockProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          clientId: 'contact-1',
          name: 'Integration Test Project',
          createdBy: 'user-1',
          updatedBy: 'user-1',
        }),
      })
    );
    expect(result.id).toBe('proj-new');
  });

  it('requests the relations the response serializer needs', async () => {
    mockProjectCreate.mockResolvedValue(baseProject);
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });

    await createProject(input);

    expect(mockProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          client: expect.anything(),
          tasks: expect.anything(),
          _count: expect.anything(),
        }),
      })
    );
  });

  it('serializes a project row without optional relations instead of throwing', async () => {
    // Regression: this exact shape used to raise "Cannot read properties of
    // undefined (reading 'map')" and turn POST into a 500 response.
    const withoutRelations: Record<string, unknown> = { ...baseProject };
    delete withoutRelations.tasks;
    delete withoutRelations.client;
    delete withoutRelations._count;

    mockProjectCreate.mockResolvedValue(withoutRelations);
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });

    const result = await createProject(input);

    expect(result.tasks).toEqual([]);
    expect(result.client).toBeNull();
    expect(result.milestoneCount).toBe(0);
  });

  it('returns 404 when the client belongs to another organization', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(createProject(input)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockProjectCreate).not.toHaveBeenCalled();
  });
});

describe('updateProject', () => {
  it('includes response relations and scopes lookups to the organization', async () => {
    mockProjectFindFirst.mockResolvedValue(baseProject);
    mockProjectUpdate.mockResolvedValue({ ...baseProject, name: 'Renamed' });

    const result = await updateProject('proj-1', { name: 'Renamed' });

    expect(mockProjectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'proj-1', organizationId: 'org-1' } })
    );
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          client: expect.anything(),
          tasks: expect.anything(),
          _count: expect.anything(),
        }),
      })
    );
    expect(result.name).toBe('Renamed');
  });

  it('returns 404 for a project in another organization', async () => {
    mockProjectFindFirst.mockResolvedValue(null);

    await expect(updateProject('proj-x', { name: 'Nope' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('getProject', () => {
  it('returns 404 for a cross-organization project', async () => {
    mockProjectFindFirst.mockResolvedValue(null);

    await expect(getProject('proj-x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('requires the project.read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(getProject('proj-1')).rejects.toMatchObject({ statusCode: 403 });
  });
});
