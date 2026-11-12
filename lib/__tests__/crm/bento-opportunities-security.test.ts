import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    opportunity: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    pipeline: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    pipelineStage: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    agencyAccount: {
      findFirst: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
    },
    userRole: {
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
import {
  listOpportunities,
  getOpportunity,
  createOpportunity,
} from '@/lib/services/crm/opportunity-service';
import { listPipelines } from '@/lib/services/crm/pipeline-service';
import { listPipelineStages } from '@/lib/services/crm/pipeline-stage-service';

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

describe('Bento CRM Phase 3D Security & Tenant Isolation Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Opportunity Tenant Isolation', () => {
    it('scopes listOpportunities to organizationId from server session', async () => {
      setupSession('org-tenant-a', 'user-tenant-a');

      vi.mocked(prisma.opportunity.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.opportunity.count).mockResolvedValueOnce(0);

      await listOpportunities({
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      });

      expect(prisma.opportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-tenant-a',
            deletedAt: null,
          }),
        })
      );
    });

    it('rejects cross-tenant access when getOpportunity targets another organization', async () => {
      setupSession('org-tenant-a', 'user-tenant-a');

      vi.mocked(prisma.opportunity.findFirst).mockResolvedValueOnce(null);

      await expect(getOpportunity('opp-tenant-b')).rejects.toThrow();

      expect(prisma.opportunity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'opp-tenant-b',
            organizationId: 'org-tenant-a',
          }),
        })
      );
    });

    it('enforces Decimal precision without floating point truncation in createOpportunity', async () => {
      setupSession('org-tenant-a', 'user-tenant-a');

      vi.mocked(prisma.pipeline.findFirst).mockResolvedValueOnce({
        id: 'pipe-1',
        organizationId: 'org-tenant-a',
        name: 'Sales Pipeline',
        description: null,
        isDefault: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.pipelineStage.findFirst).mockResolvedValueOnce({
        id: 'stg-1',
        pipelineId: 'pipe-1',
        name: 'Lead In',
        order: 1,
        color: null,
        probability: null,
        isWon: false,
        isLost: false,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.opportunity.create).mockResolvedValueOnce({
        id: 'opp-100',
        organizationId: 'org-tenant-a',
        title: 'Precision Deal',
        description: null,
        value: '1234567.89' as unknown as Awaited<
          ReturnType<typeof prisma.opportunity.create>
        >['value'],
        currency: 'USD',
        closeDate: null,
        ownerId: null,
        status: 'open',
        probability: null,
        lossReason: null,
        pipelineId: 'pipe-1',
        stageId: 'stg-1',
        contactId: null,
        accountId: null,
        leadId: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await createOpportunity({
        title: 'Precision Deal',
        value: '1234567.89',
        currency: 'USD',
        status: 'open',
        pipelineId: 'pipe-1',
        stageId: 'stg-1',
      });

      expect(prisma.opportunity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-tenant-a',
            title: 'Precision Deal',
            value: 1234567.89,
          }),
        })
      );
    });
  });

  describe('Pipeline and Stage Tenant Isolation', () => {
    it('scopes listPipelines to caller organizationId', async () => {
      setupSession('org-tenant-b', 'user-tenant-b');

      vi.mocked(prisma.pipeline.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.pipeline.count).mockResolvedValueOnce(0);

      await listPipelines({
        page: 1,
        pageSize: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      });

      expect(prisma.pipeline.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-tenant-b',
            deletedAt: null,
          }),
        })
      );
    });

    it('scopes listPipelineStages through pipeline organizationId', async () => {
      setupSession('org-tenant-b', 'user-tenant-b');

      vi.mocked(prisma.pipeline.findFirst).mockResolvedValueOnce({
        id: 'pipe-b',
        organizationId: 'org-tenant-b',
        name: 'Sales',
        description: null,
        isDefault: false,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.pipelineStage.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.pipelineStage.count).mockResolvedValueOnce(0);

      await listPipelineStages('pipe-b', {
        page: 1,
        pageSize: 20,
        sortBy: 'order',
        sortOrder: 'asc',
        includeDeleted: false,
      });

      expect(prisma.pipeline.findFirst).toHaveBeenCalledWith({
        where: { id: 'pipe-b', organizationId: 'org-tenant-b' },
      });
      expect(prisma.pipelineStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pipelineId: 'pipe-b',
          }),
        })
      );
    });
  });
});
