import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import {
  createContract,
  getContract,
  signContract,
  updateContract,
} from '@/lib/services/documents/contract-service';
import { verifyDocumentLink } from '@/lib/services/documents/link-service';

vi.mock('@/lib/db', () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    signature: {
      create: vi.fn(),
    },
    proposal: {
      findFirst: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
    document: {
      create: vi.fn(),
    },
    documentVersion: {
      create: vi.fn(),
    },
    documentLink: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
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

describe('Bento Phase 4B Security: Contracts & Document Sharing Tenant Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects cross-tenant proposal linking when creating contract', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    // Proposal belongs to another organization (or is not found under org-tenant-a)
    vi.mocked(prisma.proposal.findFirst).mockResolvedValueOnce(null);

    await expect(
      createContract({
        title: 'Master Services Agreement',
        proposalId: 'prop-from-org-b',
        status: 'draft',
      })
    ).rejects.toMatchObject({
      message: 'Proposal not found',
      statusCode: 404,
    });

    expect(prisma.proposal.findFirst).toHaveBeenCalledWith({
      where: { id: 'prop-from-org-b', organizationId: 'org-tenant-a' },
    });
  });

  it('restricts contract fetching strictly to user organizationId', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.contract.findFirst).mockResolvedValueOnce(null);

    await expect(getContract('cnt-cross-tenant')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });

    expect(prisma.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cnt-cross-tenant', organizationId: 'org-tenant-a' },
      })
    );
  });

  it('prohibits signing a voided contract', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.contract.findFirst).mockResolvedValueOnce({
      id: 'cnt-1',
      organizationId: 'org-tenant-a',
      title: 'Voided Contract',
      status: 'voided',
    } as unknown as Awaited<ReturnType<typeof prisma.contract.findFirst>>);

    await expect(
      signContract('cnt-1', {
        signerName: 'Test Signer',
        signerEmail: 'test@signer.com',
      })
    ).rejects.toMatchObject({
      message: 'Cannot sign a voided contract',
      statusCode: 400,
    });
  });

  it('prohibits updating an executed signed contract (immutability)', async () => {
    setupSession('org-tenant-a', 'usr-tenant-a');

    vi.mocked(prisma.contract.findFirst).mockResolvedValueOnce({
      id: 'cnt-1',
      organizationId: 'org-tenant-a',
      title: 'Executed Contract',
      status: 'signed',
    } as unknown as Awaited<ReturnType<typeof prisma.contract.findFirst>>);

    await expect(
      updateContract('cnt-1', {
        title: 'Tampered Title',
      })
    ).rejects.toMatchObject({
      message: 'Cannot modify a signed contract',
      statusCode: 400,
    });
  });

  it('enforces link expiration and view limits in verifyDocumentLink', async () => {
    // Expired link scenario
    vi.mocked(prisma.documentLink.findFirst).mockResolvedValueOnce({
      id: 'lnk-1',
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      accessCount: 0,
      maxAccess: 10,
      document: {
        versions: [{ snapshot: { title: 'Test' } }],
      },
    } as unknown as Awaited<ReturnType<typeof prisma.documentLink.findFirst>>);

    await expect(verifyDocumentLink('expired-token')).rejects.toMatchObject({
      message: 'Link expired',
      statusCode: 410,
    });

    // Access limit reached scenario
    vi.mocked(prisma.documentLink.findFirst).mockResolvedValueOnce({
      id: 'lnk-2',
      token: 'exhausted-token',
      expiresAt: new Date(Date.now() + 3600000),
      accessCount: 5,
      maxAccess: 5,
      document: {
        versions: [{ snapshot: { title: 'Test' } }],
      },
    } as unknown as Awaited<ReturnType<typeof prisma.documentLink.findFirst>>);

    await expect(verifyDocumentLink('exhausted-token')).rejects.toMatchObject({
      message: 'Link access limit reached',
      statusCode: 403,
    });
  });
});
