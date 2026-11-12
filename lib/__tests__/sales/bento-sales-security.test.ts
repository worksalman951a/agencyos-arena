import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    proposal: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    quotation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    proposalVersion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    documentVersion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    agencyAccount: {
      findFirst: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    opportunity: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((fn: (client: unknown) => unknown) => fn(prisma)),
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
  cookies: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { listProposals, getProposal } from '@/lib/services/crm/proposal-service';
import { listQuotations, getQuotation } from '@/lib/services/crm/quotation-service';
import { listProposalVersions } from '@/lib/services/documents/version-service';

const mockCookieStore = { toString: () => 'mock-session-cookie' };

function setupSession(orgId: string, userId = 'user-test') {
  vi.mocked(cookies).mockResolvedValue(
    mockCookieStore as unknown as Awaited<ReturnType<typeof cookies>>
  );
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {
      id: 'session-id',
      createdAt: new Date(),
      updatedAt: new Date(),
      userId,
      expiresAt: new Date(),
      token: 'tok',
    },
    user: {
      id: userId,
      email: `${userId}@tenant.com`,
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: true,
      name: userId,
    },
  });
  vi.mocked(requireOrganization).mockResolvedValue({ organizationId: orgId });
  vi.mocked(requirePermission).mockResolvedValue(undefined);
}

describe('Bento Sales Phase 4A Security & Tenant Isolation Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Proposal Tenant Isolation', () => {
    it('scopes listProposals to organizationId from server session', async () => {
      setupSession('org-tenant-a', 'user-tenant-a');

      vi.mocked(prisma.proposal.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.proposal.count).mockResolvedValueOnce(0);

      await listProposals({
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      });

      expect(prisma.proposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-tenant-a',
            deletedAt: null,
          }),
        })
      );
    });

    it('rejects cross-tenant access when getProposal targets another organization', async () => {
      setupSession('org-tenant-a', 'user-tenant-a');

      vi.mocked(prisma.proposal.findFirst).mockResolvedValueOnce(null);

      await expect(getProposal('prop-tenant-b')).rejects.toThrow();

      expect(prisma.proposal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'prop-tenant-b',
            organizationId: 'org-tenant-a',
          }),
        })
      );
    });
  });

  describe('Quotation Tenant Isolation', () => {
    it('scopes listQuotations to organizationId from server session', async () => {
      setupSession('org-tenant-b', 'user-tenant-b');

      vi.mocked(prisma.quotation.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.quotation.count).mockResolvedValueOnce(0);

      await listQuotations({
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      });

      expect(prisma.quotation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-tenant-b',
            deletedAt: null,
          }),
        })
      );
    });

    it('rejects cross-tenant access when getQuotation targets another organization', async () => {
      setupSession('org-tenant-b', 'user-tenant-b');

      vi.mocked(prisma.quotation.findFirst).mockResolvedValueOnce(null);

      await expect(getQuotation('quot-tenant-a')).rejects.toThrow();

      expect(prisma.quotation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'quot-tenant-a',
            organizationId: 'org-tenant-b',
          }),
        })
      );
    });
  });

  describe('Document Version Scoping', () => {
    it('scopes listProposalVersions to organizationId', async () => {
      setupSession('org-tenant-a', 'user-tenant-a');

      vi.mocked(prisma.proposal.findFirst).mockResolvedValueOnce({
        id: 'prop-1',
        organizationId: 'org-tenant-a',
        deletedAt: null,
      } as unknown as Awaited<ReturnType<typeof prisma.proposal.findFirst>>);

      vi.mocked(prisma.proposalVersion.findMany).mockResolvedValueOnce([]);

      await listProposalVersions('prop-1');

      expect(prisma.proposal.findFirst).toHaveBeenCalledWith({
        where: { id: 'prop-1', organizationId: 'org-tenant-a' },
      });
      expect(prisma.proposalVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { proposalId: 'prop-1' },
        })
      );
    });
  });
});
