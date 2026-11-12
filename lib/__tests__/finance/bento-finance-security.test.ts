import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { getInvoice, recordPayment, updateInvoice } from '@/lib/services/crm/invoice-service';
import { getEstimate, updateEstimate } from '@/lib/services/crm/estimate-service';

vi.mock('@/lib/db', () => ({
  prisma: {
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    invoicePayment: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    estimate: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({
        ...prisma,
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      })
    ),
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

describe('Bento Phase 5A Security: Finance Invoices & Estimates Tenant Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restricts invoice retrieval strictly to authenticated organizationId', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(null);

    await expect(getInvoice('inv-cross-tenant')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-cross-tenant', organizationId: 'org-tenant-a' },
      })
    );
  });

  it('prevents modifying a paid or voided invoice (financial immutability)', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({
      id: 'inv-1',
      organizationId: 'org-tenant-a',
      status: 'paid',
    } as unknown as Awaited<ReturnType<typeof prisma.invoice.findFirst>>);

    await expect(
      updateInvoice('inv-1', {
        title: 'Tampered Title',
      })
    ).rejects.toMatchObject({
      message: 'Cannot modify an invoice that is not in draft or sent status',
      statusCode: 400,
    });
  });

  it('prevents recording payment exceeding invoice total (overpayment safeguard)', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({
      id: 'inv-1',
      organizationId: 'org-tenant-a',
      status: 'sent',
      total: '1000.00',
      payments: [
        {
          id: 'p-1',
          invoiceId: 'inv-1',
          amount: '800.00',
          method: 'wire',
          reference: null,
          paidAt: new Date(),
          recordedBy: 'system',
          createdAt: new Date(),
        },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.invoice.findFirst>>);

    await expect(
      recordPayment('inv-1', {
        amount: '300.00', // 800 + 300 = 1100 > 1000
        method: 'card',
      })
    ).rejects.toMatchObject({
      message: 'Payment exceeds the outstanding balance of 200.00',
      statusCode: 400,
    });
  });

  it('restricts estimate retrieval strictly to authenticated organizationId', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.estimate.findFirst).mockResolvedValueOnce(null);

    await expect(getEstimate('est-cross-tenant')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.estimate.findFirst).toHaveBeenCalledWith({
      where: { id: 'est-cross-tenant', organizationId: 'org-tenant-a' },
    });
  });

  it('prevents updating an accepted estimate directly (immutability)', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.estimate.findFirst).mockResolvedValueOnce({
      id: 'est-1',
      organizationId: 'org-tenant-a',
      status: 'accepted',
    } as unknown as Awaited<ReturnType<typeof prisma.estimate.findFirst>>);

    await expect(
      updateEstimate('est-1', {
        notes: 'Tampered note',
      })
    ).rejects.toMatchObject({
      message: 'Cannot modify an estimate in accepted status',
      statusCode: 400,
    });
  });
});
