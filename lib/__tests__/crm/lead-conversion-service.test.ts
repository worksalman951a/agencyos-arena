/** Unit tests for Lead-to-Opportunity conversion service.
 *
 * Prisma is mocked so these tests run without a live database.
 * Tests cover:
 * - Successful conversion with relationship preservation
 * - Already converted lead handling
 * - Cross-org non-disclosing 404
 * - Permission enforcement (401, 403)
 * - Pipeline/stage/owner validation
 * - Duplicate conversion prevention
 * - Audit logging
 * - Lead lifecycle status update
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    opportunity: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    pipeline: {
      findFirst: vi.fn(),
    },
    pipelineStage: {
      findFirst: vi.fn(),
    },
    userRole: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
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
  emitWorkflowEvent,
  emitWorkflowEvents,
} from '@/lib/services/automation/run-workflow-service';
import { convertLead } from '@/lib/services/crm/lead-conversion-service';

const mockLeadFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockLeadUpdate = prisma.lead.update as unknown as ReturnType<typeof vi.fn>;
const mockOppFindFirst = prisma.opportunity.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockOppCreate = prisma.opportunity.create as unknown as ReturnType<typeof vi.fn>;
const mockPipelineFindFirst = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockStageFindFirst = prisma.pipelineStage.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockUserRoleFindFirst = prisma.userRole.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockEmitWorkflowEvent = emitWorkflowEvent as unknown as ReturnType<typeof vi.fn>;
const mockEmitWorkflowEvents = emitWorkflowEvents as unknown as ReturnType<typeof vi.fn>;

const orgId = 'org_123';
const userId = 'user_123';
const leadId = 'lead_123';
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
  mockTransaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => {
    return callback(prisma);
  });
  mockQueryRawUnsafe.mockResolvedValue([]);
});

describe('Lead conversion - convertLead', () => {
  it('successfully converts a lead to an opportunity', async () => {
    const existingLead = {
      id: leadId,
      organizationId: orgId,
      contactId: 'contact_1',
      accountId: 'account_1',
      pipelineId: 'pipeline_1',
      stageId: 'stage_1',
      ownerId: 'owner_1',
      expectedValue: 5000,
      status: 'new',
    };

    mockLeadFindUnique.mockResolvedValue(existingLead);
    mockOppFindFirst.mockResolvedValue(null);
    mockPipelineFindFirst.mockResolvedValue({ id: 'pipeline_1', organizationId: orgId });
    mockStageFindFirst.mockResolvedValue({ id: 'stage_1', pipelineId: 'pipeline_1' });
    mockUserRoleFindFirst.mockResolvedValue({
      id: 'ur_1',
      userId: 'owner_1',
      organizationId: orgId,
    });
    mockOppCreate.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      leadId,
      title: 'Converted Deal',
      status: 'open',
      value: 5000,
      currency: 'USD',
      pipelineId: 'pipeline_1',
      stageId: 'stage_1',
      ownerId: 'owner_1',
      contactId: 'contact_1',
      accountId: 'account_1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockLeadUpdate.mockResolvedValue({ id: leadId, status: 'converted' });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await convertLead(leadId, {
      title: 'Converted Deal',
      pipelineId: 'pipeline_1',
      stageId: 'stage_1',
      ownerId: 'owner_1',
    });

    expect(result.alreadyConverted).toBe(false);
    expect(result).not.toHaveProperty('previousLeadStatus');
    expect(result.opportunity.id).toBe(oppId);
    expect(result.opportunity.title).toBe('Converted Deal');
    expect(result.opportunity.leadId).toBe(leadId);
    expect(result.lead.status).toBe('converted');
    expect(mockOppCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: orgId,
          leadId,
          title: 'Converted Deal',
          status: 'open',
        }),
      })
    );
    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: leadId },
      data: { status: 'converted' },
    });
    expect(mockEmitWorkflowEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'record.created',
      recordType: 'Opportunity',
      recordId: oppId,
    });
    expect(mockEmitWorkflowEvents).toHaveBeenCalledExactlyOnceWith([
      { type: 'record.updated', recordType: 'Lead', recordId: leadId },
      {
        type: 'record.status_changed',
        recordType: 'Lead',
        recordId: leadId,
        previousStatus: 'new',
      },
    ]);
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
  });

  it('returns already converted when opportunity already exists', async () => {
    const existingLead = {
      id: leadId,
      organizationId: orgId,
      status: 'converted',
    };

    mockLeadFindUnique.mockResolvedValue(existingLead);
    mockOppFindFirst.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      leadId,
      title: 'Existing Deal',
      status: 'won',
      value: 10000,
      currency: 'USD',
      pipelineId: null,
      stageId: null,
      ownerId: null,
      contactId: null,
      accountId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await convertLead(leadId, {
      title: 'Converted Deal',
    });

    expect(result.alreadyConverted).toBe(true);
    expect(result.opportunity.id).toBe(oppId);
    expect(result.opportunity.title).toBe('Existing Deal');
    expect(mockOppCreate).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
    expect(mockEmitWorkflowEvent).not.toHaveBeenCalled();
    expect(mockEmitWorkflowEvents).not.toHaveBeenCalled();
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(convertLead(leadId, { title: 'Converted Deal' })).rejects.toThrow(
      'Unauthenticated'
    );
  });

  it('throws 403 when user lacks lead.convert permission', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      status: 'new',
    });
    mockOppFindFirst.mockResolvedValue(null);
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );

    await expect(convertLead(leadId, { title: 'Converted Deal' })).rejects.toThrow('Forbidden');
  });

  it('throws non-disclosing 404 for cross-org lead', async () => {
    mockLeadFindUnique.mockResolvedValue(null);

    await expect(convertLead(leadId, { title: 'Converted Deal' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 404 for invalid pipeline', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      status: 'new',
    });
    mockOppFindFirst.mockResolvedValue(null);
    mockPipelineFindFirst.mockResolvedValue(null);

    await expect(
      convertLead(leadId, { title: 'Converted Deal', pipelineId: 'foreign_pipeline' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 for invalid stage', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      status: 'new',
    });
    mockOppFindFirst.mockResolvedValue(null);
    mockPipelineFindFirst.mockResolvedValue({ id: 'pipeline_1', organizationId: orgId });
    mockStageFindFirst.mockResolvedValue(null);

    await expect(
      convertLead(leadId, {
        title: 'Converted Deal',
        pipelineId: 'pipeline_1',
        stageId: 'foreign_stage',
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 for invalid owner', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      status: 'new',
    });
    mockOppFindFirst.mockResolvedValue(null);
    mockUserRoleFindFirst.mockResolvedValue(null);

    await expect(
      convertLead(leadId, { title: 'Converted Deal', ownerId: 'foreign_owner' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('applies sensible defaults from lead when not overridden', async () => {
    const existingLead = {
      id: leadId,
      organizationId: orgId,
      contactId: 'contact_1',
      accountId: 'account_1',
      pipelineId: 'pipeline_1',
      stageId: 'stage_1',
      ownerId: 'owner_1',
      expectedValue: 5000,
      status: 'new',
    };

    mockLeadFindUnique.mockResolvedValue(existingLead);
    mockOppFindFirst.mockResolvedValue(null);
    mockUserRoleFindFirst.mockResolvedValue({
      id: 'ur_1',
      userId: 'owner_1',
      organizationId: orgId,
    });
    mockOppCreate.mockResolvedValue({
      id: oppId,
      organizationId: orgId,
      leadId,
      title: 'Converted Deal',
      status: 'open',
      value: 5000,
      currency: 'USD',
      pipelineId: 'pipeline_1',
      stageId: 'stage_1',
      ownerId: 'owner_1',
      contactId: 'contact_1',
      accountId: 'account_1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockLeadUpdate.mockResolvedValue({ id: leadId, status: 'converted' });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    await convertLead(leadId, { title: 'Converted Deal' });

    expect(mockOppCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: 'contact_1',
          accountId: 'account_1',
          pipelineId: 'pipeline_1',
          stageId: 'stage_1',
          ownerId: 'owner_1',
          value: 5000,
          currency: 'USD',
        }),
      })
    );
  });
});
