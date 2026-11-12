import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import {
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from '@/lib/services/crm/project-service';

vi.mock('@/lib/db', () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    projectTemplate: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    toString: () => 'mock-cookie',
  }),
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

function setupSession(organizationId = 'org-tenant-a', userId = 'usr-tenant-a', role = 'owner') {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {
      id: 'sess-1',
      userId,
      token: 'tok-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    },
    user: {
      id: userId,
      email: 'user@tenant-a.com',
      name: 'Tenant User',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role,
      organizationId,
    },
  } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

  vi.mocked(requireOrganization).mockResolvedValue({ organizationId });
  vi.mocked(requirePermission).mockResolvedValue(true as unknown as void);
}

describe('Bento Phase 6A Security: Projects, Tasks & Milestones Multi-Tenant Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restricts single project retrieval strictly to authenticated organizationId', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

    await expect(getProject('proj-cross-tenant')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proj-cross-tenant', organizationId: 'org-tenant-a' },
      })
    );
  });

  it('restricts listProjects query filters strictly to authenticated organizationId', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.project.findMany).mockResolvedValue([]);
    vi.mocked(prisma.project.count).mockResolvedValue(0);

    const result = await listProjects({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      includeDeleted: false,
    });

    expect(result.projects).toEqual([]);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-tenant-a',
        }),
      })
    );
  });

  it('rejects updating a project belonging to another organization (non-disclosing 404)', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

    await expect(
      updateProject('proj-cross-tenant', {
        name: 'Unauthorized Title',
      })
    ).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('rejects deleting a project belonging to another organization', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

    await expect(deleteProject('proj-cross-tenant')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
