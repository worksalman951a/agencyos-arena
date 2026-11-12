import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { getExpense, searchExpenses, deleteExpense } from '@/lib/services/crm/expense-service';

vi.mock('@/lib/db', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    expenseItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
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
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    id: organizationId,
    settings: { currency: 'USD' },
  } as unknown as Awaited<ReturnType<typeof prisma.organization.findUnique>>);
}

describe('Bento Phase 5B Security: Expenses & Reports Multi-Tenant Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restricts single expense retrieval strictly to authenticated organizationId', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.expenseItem.findFirst).mockResolvedValueOnce(null);

    await expect(getExpense('exp-cross-tenant')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.expenseItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'exp-cross-tenant', organizationId: 'org-tenant-a' },
    });
  });

  it('restricts searchExpenses queries strictly to authenticated organizationId', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.expenseItem.findMany).mockResolvedValue([]);
    vi.mocked(prisma.expenseItem.count).mockResolvedValue(0);

    const result = await searchExpenses({ q: 'travel' });

    expect(result.rows).toEqual([]);
    expect(prisma.expenseItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-tenant-a',
        }),
      })
    );
  });

  it('prevents deleting an expense belonging to another organization', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.expenseItem.findFirst).mockResolvedValueOnce(null);

    await expect(deleteExpense('exp-cross-tenant')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.expenseItem.delete).not.toHaveBeenCalled();
  });
});
