/** Unit tests for Opportunity service layer.
 *
 * Prisma is mocked so these tests run without a live database.
 * Tests cover:
 * - Organization-scoped queries (org isolation)
 * - Soft-delete filtering
 * - Permission enforcement (401, 403)
 * - Cross-org non-disclosing 404
 * - Cross-org contact/account/lead/pipeline/stage relationship validation
 * - Owner membership validation (opportunity.assign)
 * - Stage/status transition validation
 * - Audit logging
 * - Summary metrics
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    opportunity: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    agencyAccount: {
      findFirst: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
    },
    pipeline: {
      findFirst: vi.fn(),
    },
    pipelineStage: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    userRole: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
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

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  emitWorkflowEvent: vi.fn(async () => ({})),
  emitWorkflowEvents: vi.fn(async () => []),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import {
  listOpportunities,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  getOpportunitySummary,
} from '@/lib/services/crm/opportunity-service';
import type {
  OpportunityCreateInput,
  OpportunityUpdateInput,
  OpportunityQueryInput,
} from '@/lib/schemas/crm/opportunity.schema';

const mockOppFindMany = prisma.opportunity.findMany as unknown as ReturnType<typeof vi.fn>;
const mockOppFindFirst = prisma.opportunity.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockOppCreate = prisma.opportunity.create as unknown as ReturnType<typeof vi.fn>;
const mockOppUpdate = prisma.opportunity.update as unknown as ReturnType<typeof vi.fn>;
const mockOppCount = prisma.opportunity.count as unknown as ReturnType<typeof vi.fn>;
const mockOppAggregate = prisma.opportunity.aggregate as unknown as ReturnType<typeof vi.fn>;
const mockOppGroupBy = prisma.opportunity.groupBy as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockPipelineFindFirst = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockStageFindFirst = prisma.pipelineStage.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockStageFindMany = prisma.pipelineStage.findMany as unknown as ReturnType<typeof vi.fn>;
const mockUserRoleFindFirst = prisma.userRole.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;

const orgId = 'org_123';
const userId = 'user_123';
const oppId = 'opp_123';

const mockSession = {
  session: { id: 'session_123', userId, expiresAt: new Date(Date.now() + 86400000) },
  user: {
    id: userId,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    organizationId: orgId,
  },
};

function mockAuth(user = mockSession.user) {
  mockGetSession.mockResolvedValue({ session: mockSession.session, user });
  mockCookies.mockReturnValue({
    toString: () => 'better-auth.session_token=test',
  });
}

function mockNoAuth() {
  mockGetSession.mockResolvedValue({ session: null, user: null });
  mockCookies.mockReturnValue({
    toString: () => '',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth();
  mockRequireOrganization.mockResolvedValue({ organizationId: orgId });
  mockRequirePermission.mockResolvedValue(undefined);
  mockTransaction.mockImplementation((promises) => Promise.all(promises));
});

describe('Opportunity service - listOpportunities', () => {
  it('returns org-scoped opportunities with pagination', async () => {
    mockOppFindMany.mockResolvedValue([
      {
        id: oppId,
        organizationId: orgId,
        contactId: null,
        accountId: null,
        leadId: null,
        pipelineId: null,
        stageId: null,
        title: 'Test Deal',
        description: null,
        value: 5000,
        currency: 'USD',
        closeDate: null,
        ownerId: null,
        status: 'open',
        probability: null,
        lossReason: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contact: null,
        account: null,
        lead: null,
        pipeline: null,
        stage: null,
        owner: null,
      },
    ]);
    mockOppCount.mockResolvedValue(1);

    const result = await listOpportunities({ page: 1, pageSize: 20 } as OpportunityQueryInput);

    expect(mockOppFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: orgId, deletedAt: null }),
      })
    );
    expect(result.opportunities).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('filters out soft-deleted opportunities by default', async () => {
    mockOppFindMany.mockResolvedValue([]);
    mockOppCount.mockResolvedValue(0);

    await listOpportunities({ page: 1, pageSize: 20 } as OpportunityQueryInput);

    expect(mockOppFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(
      listOpportunities({ page: 1, pageSize: 20 } as OpportunityQueryInput)
    ).rejects.toThrow('Unauthenticated');
  });

  it('throws 403 when user lacks opportunity.read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(
      listOpportunities({ page: 1, pageSize: 20 } as OpportunityQueryInput)
    ).rejects.toThrow('Forbidden');
  });
});

describe('Opportunity service - getOpportunity', () => {
  it('returns opportunity for same org', async () => {
    mockOppFindFirst.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      leadId: null,
      pipelineId: null,
      stageId: null,
      title: 'Test Deal',
      description: null,
      value: 5000,
      currency: 'USD',
      closeDate: null,
      ownerId: null,
      status: 'open',
      probability: null,
      lossReason: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contact: null,
      account: null,
      lead: null,
      pipeline: null,
      stage: null,
      owner: null,
    });

    const result = await getOpportunity(oppId);
    expect(result.id).toBe(oppId);
    expect(mockOppFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: oppId, organizationId: orgId },
      })
    );
  });

  it('throws non-disclosing 404 for cross-org opportunity', async () => {
    mockOppFindFirst.mockResolvedValue(null);

    await expect(getOpportunity(oppId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Opportunity service - createOpportunity', () => {
  const createInput = {
    title: 'Test Deal',
    status: 'open',
    currency: 'USD',
    value: '5000.00',
    contactId: null,
    accountId: null,
    leadId: null,
    pipelineId: null,
    stageId: null,
    ownerId: null,
    description: null,
    closeDate: null,
    probability: null,
    lossReason: null,
  } as OpportunityCreateInput;

  it('creates opportunity with organization scoping and audit logging', async () => {
    mockOppCreate.mockResolvedValue({
      id: 'new_opp',
      organizationId: orgId,
      contactId: null,
      accountId: null,
      leadId: null,
      pipelineId: null,
      stageId: null,
      title: 'Test Deal',
      description: null,
      value: 5000,
      currency: 'USD',
      closeDate: null,
      ownerId: null,
      status: 'open',
      probability: null,
      lossReason: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await createOpportunity(createInput);

    expect(mockOppCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: orgId,
          title: 'Test Deal',
          status: 'open',
          currency: 'USD',
          value: 5000,
        }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
    expect(result.title).toBe('Test Deal');
  });

  it('validates owner membership when ownerId is provided', async () => {
    mockUserRoleFindFirst.mockResolvedValue(null);

    await expect(
      createOpportunity({ ...createInput, ownerId: 'foreign_owner' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates cross-org contact relationship', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(
      createOpportunity({ ...createInput, contactId: 'foreign_contact' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates cross-org pipeline relationship', async () => {
    mockPipelineFindFirst.mockResolvedValue(null);

    await expect(
      createOpportunity({ ...createInput, pipelineId: 'foreign_pipeline' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates stage belongs to same pipeline', async () => {
    mockPipelineFindFirst.mockResolvedValue({ id: 'pipeline_1', organizationId: orgId });
    mockStageFindFirst.mockResolvedValue({ id: 'stage_1', pipelineId: 'different_pipeline' });

    await expect(
      createOpportunity({ ...createInput, pipelineId: 'pipeline_1', stageId: 'stage_1' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects stage from different org when no pipelineId is provided', async () => {
    mockStageFindFirst.mockResolvedValue(null);

    await expect(
      createOpportunity({ ...createInput, stageId: 'foreign_stage' })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockStageFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign_stage',
        pipeline: { organizationId: orgId },
      },
      include: { pipeline: true },
    });
  });

  it('allows stage from same org pipeline when no pipelineId is provided', async () => {
    mockStageFindFirst.mockResolvedValue({
      id: 'stage_1',
      pipelineId: 'pipeline_1',
      pipeline: { id: 'pipeline_1', organizationId: orgId },
    });
    mockOppCreate.mockResolvedValue({
      id: 'new_opp',
      organizationId: orgId,
      title: 'Test Deal',
      status: 'open',
      pipelineId: null,
      stageId: 'stage_1',
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await createOpportunity({ ...createInput, stageId: 'stage_1' });
    expect(result.id).toBe('new_opp');
    expect(mockStageFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'stage_1',
        pipeline: { organizationId: orgId },
      },
      include: { pipeline: true },
    });
  });

  it.each([
    {
      status: 'open',
      stageLabel: 'won',
      stage: { id: 'won-stage', pipelineId: 'pipeline_1', isWon: true, isLost: false },
      message: 'Cannot move to a won stage without setting status to won',
    },
    {
      status: 'open',
      stageLabel: 'lost',
      stage: { id: 'lost-stage', pipelineId: 'pipeline_1', isWon: false, isLost: true },
      message: 'Cannot move to a lost stage without setting status to lost',
    },
  ])(
    'rejects creating an opportunity with a mismatched $stageLabel stage and status',
    async ({ status, stage, message }) => {
      mockStageFindFirst.mockResolvedValue(stage);

      await expect(
        createOpportunity({ ...createInput, stageId: stage.id, status })
      ).rejects.toMatchObject({ statusCode: 400, message });

      expect(mockOppCreate).not.toHaveBeenCalled();
    }
  );

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(createOpportunity(createInput)).rejects.toThrow('Unauthenticated');
  });

  it('throws 403 when user lacks opportunity.create permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(createOpportunity(createInput)).rejects.toThrow('Forbidden');
  });
});

describe('Opportunity service - updateOpportunity', () => {
  it('updates opportunity for same org', async () => {
    mockOppFindFirst.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      leadId: null,
      pipelineId: null,
      stageId: null,
      title: 'Test Deal',
      description: null,
      value: 5000,
      currency: 'USD',
      closeDate: null,
      ownerId: null,
      status: 'open',
      probability: null,
      lossReason: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      stage: null,
    });
    mockOppUpdate.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      leadId: null,
      pipelineId: null,
      stageId: null,
      title: 'Updated Deal',
      description: null,
      value: 5000,
      currency: 'USD',
      closeDate: null,
      ownerId: null,
      status: 'open',
      probability: null,
      lossReason: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await updateOpportunity(oppId, {
      title: 'Updated Deal',
    } as OpportunityUpdateInput);
    expect(result.title).toBe('Updated Deal');
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org update', async () => {
    mockOppFindFirst.mockResolvedValue(null);

    await expect(
      updateOpportunity(oppId, { title: 'Hacked' } as OpportunityUpdateInput)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 403 when user lacks opportunity.update permission', async () => {
    mockOppFindFirst.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      leadId: null,
      pipelineId: null,
      stageId: null,
      title: 'Test Deal',
      description: null,
      value: 5000,
      currency: 'USD',
      closeDate: null,
      ownerId: null,
      status: 'open',
      probability: null,
      lossReason: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      stage: null,
    });
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(
      updateOpportunity(oppId, { title: 'Updated' } as OpportunityUpdateInput)
    ).rejects.toThrow('Forbidden');
  });

  it('rejects stage from different org when updating stageId without pipelineId', async () => {
    const existing = {
      id: oppId,
      organizationId: orgId,
      pipelineId: null,
      stageId: null,
      title: 'Test Deal',
      status: 'open',
    };
    mockOppFindFirst.mockResolvedValue(existing);
    mockStageFindFirst.mockResolvedValue(null);

    await expect(
      updateOpportunity(oppId, { stageId: 'foreign_stage' } as OpportunityUpdateInput)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockStageFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign_stage',
        pipeline: { organizationId: orgId },
      },
      include: { pipeline: true },
    });
  });

  it('allows stage from same org pipeline when updating stageId', async () => {
    const existing = {
      id: oppId,
      organizationId: orgId,
      pipelineId: 'pipeline_1',
      stageId: null,
      title: 'Test Deal',
      status: 'open',
      stage: { pipelineId: 'pipeline_1' },
    };
    mockOppFindFirst.mockResolvedValue(existing);
    mockStageFindFirst.mockResolvedValue({
      id: 'stage_1',
      pipelineId: 'pipeline_1',
    });
    mockOppUpdate.mockResolvedValue({ ...existing, stageId: 'stage_1' });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await updateOpportunity(oppId, { stageId: 'stage_1' } as OpportunityUpdateInput);
    expect(result.stageId).toBe('stage_1');
    expect(mockStageFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'stage_1',
        pipelineId: 'pipeline_1',
      },
      include: { pipeline: true },
    });
  });

  it.each([
    {
      stageLabel: 'won',
      stage: { id: 'won-stage', pipelineId: 'pipeline_1', isWon: true, isLost: false },
      message: 'Cannot move to a won stage without setting status to won',
    },
    {
      stageLabel: 'lost',
      stage: { id: 'lost-stage', pipelineId: 'pipeline_1', isWon: false, isLost: true },
      message: 'Cannot move to a lost stage without setting status to lost',
    },
  ])(
    'rejects moving an open opportunity to a $stageLabel stage without a matching status',
    async ({ stage, message }) => {
      mockOppFindFirst.mockResolvedValue({
        id: oppId,
        organizationId: orgId,
        pipelineId: 'pipeline_1',
        stageId: null,
        title: 'Test Deal',
        status: 'open',
      });
      mockStageFindFirst.mockResolvedValue(stage);

      await expect(
        updateOpportunity(oppId, { stageId: stage.id } as OpportunityUpdateInput)
      ).rejects.toMatchObject({ statusCode: 400, message });

      expect(mockOppUpdate).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      stageLabel: 'won',
      currentStatus: 'won',
      stage: { id: 'won-stage', isWon: true, isLost: false },
      message: 'Cannot move to a won stage without setting status to won',
    },
    {
      stageLabel: 'lost',
      currentStatus: 'lost',
      stage: { id: 'lost-stage', isWon: false, isLost: true },
      message: 'Cannot move to a lost stage without setting status to lost',
    },
  ])(
    'rejects changing status away from the current $stageLabel stage',
    async ({ currentStatus, stage, message }) => {
      mockOppFindFirst.mockResolvedValue({
        id: oppId,
        organizationId: orgId,
        pipelineId: 'pipeline_1',
        stageId: stage.id,
        title: 'Test Deal',
        status: currentStatus,
        stage,
      });

      await expect(
        updateOpportunity(oppId, { status: 'open' } as OpportunityUpdateInput)
      ).rejects.toMatchObject({ statusCode: 400, message });

      expect(mockOppUpdate).not.toHaveBeenCalled();
    }
  );
});

describe('Opportunity service - deleteOpportunity', () => {
  it('soft deletes opportunity for same org', async () => {
    mockOppFindFirst.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      leadId: null,
      pipelineId: null,
      stageId: null,
      title: 'Test Deal',
      description: null,
      value: 5000,
      currency: 'USD',
      closeDate: null,
      ownerId: null,
      status: 'open',
      probability: null,
      lossReason: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockOppUpdate.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      deletedAt: new Date(),
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await deleteOpportunity(oppId);
    expect(result.deletedAt).toBeDefined();
    expect(mockOppUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: oppId },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org delete', async () => {
    mockOppFindFirst.mockResolvedValue(null);

    await expect(deleteOpportunity(oppId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 403 when user lacks opportunity.delete permission', async () => {
    mockOppFindFirst.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      leadId: null,
      pipelineId: null,
      stageId: null,
      title: 'Test Deal',
      description: null,
      value: 5000,
      currency: 'USD',
      closeDate: null,
      ownerId: null,
      status: 'open',
      probability: null,
      lossReason: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(deleteOpportunity(oppId)).rejects.toThrow('Forbidden');
  });
});

describe('Opportunity service - getOpportunitySummary', () => {
  it('returns summary metrics', async () => {
    mockOppCount.mockResolvedValue(5);
    mockOppAggregate.mockResolvedValue({ _sum: { value: 10000 } });
    mockOppGroupBy.mockResolvedValue([
      { stageId: 'stage_1', _count: { id: 3 }, _sum: { value: 6000 } },
    ]);
    mockStageFindMany.mockResolvedValue([{ id: 'stage_1', name: 'Qualified' }]);

    const result = await getOpportunitySummary();
    expect(result.openCount).toBe(5);
    expect(result.openValue).toBe('10000');
    expect(result.byStage).toHaveLength(1);
    expect(result.byStage[0].stageName).toBe('Qualified');
  });
});
